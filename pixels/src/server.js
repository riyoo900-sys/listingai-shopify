import "dotenv/config";
import express from "express";
import compression from "compression";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shopify,
  APP_URL,
  AUTH_CALLBACK_PATH,
  sessionFromShop,
  cycleToExpiringToken,
  refreshOfflineToken,
  registerComplianceWebhooks,
  ensureStorefrontScript,
} from "./shopify.js";
import {
  createSubscription,
  getActiveSubscription,
  TRIAL_DAYS,
  PRICE_MONTHLY,
  PRICE_YEARLY,
} from "./billing.js";
import {
  getShop,
  listShops,
  upsertShop,
  saveShopTokens,
  setShopPlan,
  listPixels,
  addPixel,
  updatePixel,
  removePixel,
  publicPixels,
  bumpEvents,
  deleteShop,
} from "./db.js";
import { sendCapi } from "./capi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3010);
const BIND_HOST = "0.0.0.0";
const PRICE_USD = PRICE_MONTHLY;
function pixelsApiKey() {
  if (process.env.PIXELS_APP_URL?.trim()) {
    return process.env.PIXELS_SHOPIFY_API_KEY?.trim() || "";
  }
  return process.env.SHOPIFY_API_KEY?.trim() || "";
}

const APP_SECRET = process.env.PIXELS_APP_URL?.trim()
  ? process.env.PIXELS_SHOPIFY_API_SECRET?.trim() || ""
  : process.env.PIXELS_SHOPIFY_API_SECRET?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim() ||
    process.env.SHOPIFY_SECRET?.trim() ||
    "";

app.use(compression());
app.use(
  "/webhooks",
  express.raw({ type: "*/*", limit: "2mb" }),
  (req, _res, next) => {
    req.rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(String(req.body || ""), "utf8");
    try {
      req.body = JSON.parse(req.rawBody.toString("utf8") || "{}");
    } catch {
      req.body = {};
    }
    next();
  }
);
const jsonParser = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks")) return next();
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  const shop = String(req.query.shop || "").replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 80);
  const ancestors = [
    "https://admin.shopify.com",
    "https://*.shopify.com",
    "https://*.myshopify.com",
    shop ? `https://${shop}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(express.static(path.join(__dirname, "..", "web"), { index: false }));

function normalizeShop(raw) {
  let shop = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!shop.endsWith(".myshopify.com")) shop = `${shop}.myshopify.com`;
  return shop;
}

async function getValidSession(shop) {
  let row = getShop(shop);
  if (!row?.access_token) return null;
  const soon = Date.now() + 120000;
  try {
    if (!row.refresh_token) {
      row = saveShopTokens(shop, await cycleToExpiringToken(shop, row.access_token));
    } else if (!row.token_expires_at || new Date(row.token_expires_at).getTime() < soon) {
      row = saveShopTokens(shop, await refreshOfflineToken(shop, row.refresh_token));
    }
  } catch (e) {
    console.error("token", e.message);
    throw new Error("Shopify session expired. Reinstall via /auth?shop=" + shop);
  }
  return sessionFromShop(shop, getShop(shop).access_token);
}

function shopFromReq(req) {
  return normalizeShop(req.query.shop || req.body?.shop || req.shopFromToken || "");
}

async function attachSessionShop(req, _res, next) {
  const auth = req.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return next();
  try {
    const payload = await shopify.session.decodeSessionToken(token);
    req.shopFromToken = normalizeShop(String(payload.dest || "").replace(/^https?:\/\//, ""));
  } catch (_) {}
  next();
}

app.use("/api", attachSessionShop);

app.get("/health", (_req, res) =>
  res.json({ ok: true, app: "YAMSHI Pixels", version: "1.0.0", price_usd: PRICE_USD })
);

app.get("/privacy", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "web", "privacy.html"))
);
app.get("/support", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "web", "support.html"))
);

app.get("/auth", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) return res.status(400).send("Missing shop");
    const dest = String(req.get("sec-fetch-dest") || "");
    const inIframe =
      dest === "iframe" || dest === "nested-document" || String(req.query.embedded || "") === "1";
    if (inIframe) {
      const q = new URLSearchParams({ shop });
      if (req.query.host) q.set("host", String(req.query.host));
      const abs = `${APP_URL}/auth?${q.toString()}`;
      return res
        .type("html")
        .send(`<!doctype html><meta charset="utf-8"><script>window.top.location.href=${JSON.stringify(abs)};</script>`);
    }
    await shopify.auth.begin({
      shop,
      callbackPath: AUTH_CALLBACK_PATH,
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { session } = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    upsertShop(session.shop, session.accessToken);
    try {
      saveShopTokens(session.shop, await cycleToExpiringToken(session.shop, session.accessToken));
    } catch (e) {
      console.error("cycle", e.message);
    }
    try {
      await registerComplianceWebhooks(session);
      await ensureStorefrontScript(session, session.shop);
    } catch (e) {
      console.warn("post-install", e.message);
    }
    res.redirect(`https://${session.shop}/admin/apps/${pixelsApiKey()}`);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

function sendAppHtml(res) {
  let html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");
  html = html.replaceAll("%%SHOPIFY_API_KEY%%", pixelsApiKey());
  html = html.replaceAll("%%PRICE%%", String(PRICE_MONTHLY));
  html = html.replaceAll("%%PRICE_YEAR%%", String(PRICE_YEARLY));
  html = html.replaceAll("%%TRIAL%%", String(TRIAL_DAYS));
  res.type("html").send(html);
}

app.get("/", (req, res) => {
  const shop = req.query.shop ? normalizeShop(req.query.shop) : "";
  const embedded = String(req.query.embedded || "") === "1" || Boolean(req.query.host);
  if (shop && !embedded && !getShop(shop)?.access_token) {
    return res.redirect(302, `${APP_URL}/auth?shop=${encodeURIComponent(shop)}`);
  }
  sendAppHtml(res);
});

app.get("/storefront.js", (req, res) => {
  const shop = normalizeShop(req.query.shop);
  const pixels = publicPixels(shop);
  const ids = pixels.map((p) => p.pixel_id);
  res.type("js").send(`
(function(){
  var ids = ${JSON.stringify(ids)};
  if (!ids.length) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  ids.forEach(function(id){ fbq('init', id); });
  fbq('track', 'PageView');
  document.addEventListener('click', function(ev){
    var a = ev.target && ev.target.closest ? ev.target.closest('form[action*="/cart/add"], [name="add"], .product-form__submit, button[type="submit"]') : null;
    if (a) { try { fbq('track', 'AddToCart'); } catch(e){} }
  }, true);
})();`);
});

app.get("/api/me", async (req, res) => {
  const shop = shopFromReq(req);
  const row = getShop(shop);
  if (!row) return res.status(401).json({ error: "Not installed" });
  try {
    const session = await getValidSession(shop);
    const billing = session ? await getActiveSubscription(session) : null;
    if (billing && row.plan !== "pro") setShopPlan(shop, "pro", String(billing.id));
    if (session) await ensureStorefrontScript(session, shop);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
  const fresh = getShop(shop);
  const pixels = listPixels(shop).map((p) => ({
    ...p,
    capi_token: p.capi_token ? "••••" + String(p.capi_token).slice(-4) : "",
  }));
  res.json({
    shop,
    plan: fresh.plan,
    price_usd: PRICE_MONTHLY,
    price_yearly: PRICE_YEARLY,
    trial_days: TRIAL_DAYS,
    pixels,
    events_today: fresh.events_today || 0,
    capi_match: pixels.filter((p) => p.capi_token).length,
  });
});

app.post("/api/pixels", (req, res) => {
  const shop = shopFromReq(req);
  if (!getShop(shop)) return res.status(401).json({ error: "Not installed" });
  try {
    const row = addPixel(shop, req.body || {});
    res.json({ pixel: { ...row, capi_token: row.capi_token ? "saved" : "" } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/pixels/:id", (req, res) => {
  const shop = shopFromReq(req);
  const row = updatePixel(shop, req.params.id, req.body || {});
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

app.delete("/api/pixels/:id", (req, res) => {
  const shop = shopFromReq(req);
  removePixel(shop, req.params.id);
  res.json({ ok: true });
});

app.get("/billing/start", async (req, res) => {
  try {
    const shop = shopFromReq(req);
    const session = await getValidSession(shop);
    if (!session) return res.status(401).send("Not installed");
    const plan = String(req.query.plan || "monthly") === "annual" ? "annual" : "monthly";
    const charge = await createSubscription(session, plan);
    setShopPlan(shop, "pending", String(charge.id));
    res.redirect(charge.confirmation_url);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get("/billing/callback", async (req, res) => {
  try {
    const shop = shopFromReq(req);
    const session = await getValidSession(shop);
    const sub = await getActiveSubscription(session);
    if (!sub) return res.status(400).send("Subscription not active yet. Approve the Shopify charge first.");
    setShopPlan(shop, "pro", String(sub.id));
    res.redirect(`https://${shop}/admin/apps/${pixelsApiKey()}`);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

function verifyWebhook(req, res, next) {
  if (!APP_SECRET) return res.sendStatus(401);
  const hmac = req.get("x-shopify-hmac-sha256") || "";
  const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const digest = crypto.createHmac("sha256", APP_SECRET).update(body).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  if (!hmac || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  next();
}

app.post("/webhooks/orders/paid", verifyWebhook, async (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  const order = req.body || {};
  const pixels = listPixels(shop).filter((p) => p.enabled && p.capi_token);
  const email = order.email || order.customer?.email;
  const phone = order.phone || order.billing_address?.phone;
  const value = order.total_price;
  const currency = order.currency;
  const eventId = String(order.id || "") + "-purchase";
  const sourceUrl = order.order_status_url || order.landing_site;
  await Promise.all(
    pixels.map((p) =>
      sendCapi(p, "Purchase", {
        value,
        currency,
        eventId,
        email,
        phone,
        sourceUrl,
      }).catch((e) => console.warn("capi", e.message))
    )
  );
  bumpEvents(shop);
  res.sendStatus(200);
});
app.post("/webhooks/app/uninstalled", verifyWebhook, (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop) deleteShop(shop);
  res.sendStatus(200);
});
app.post("/webhooks/customers/data_request", verifyWebhook, (_req, res) => res.sendStatus(200));
app.post("/webhooks/customers/redact", verifyWebhook, (_req, res) => res.sendStatus(200));
app.post("/webhooks/shop/redact", verifyWebhook, (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop) deleteShop(shop);
  res.sendStatus(200);
});

export { app };

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, BIND_HOST, () => {
    console.log(
      `YAMSHI Pixels v1.0.0 → ${process.env.SHOPIFY_APP_URL || `http://${BIND_HOST}:${PORT}`} · $${PRICE_USD}/mo`
    );
  });
}
