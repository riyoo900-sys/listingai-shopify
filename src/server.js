import "dotenv/config";
import express from "express";
import compression from "compression";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shopify,
  sessionFromShop,
  shopifyRest,
  shopifyRestPost,
  shopifyRestPut,
  createRecurringCharge,
  activateCharge,
  getActiveCharge,
  cycleToExpiringToken,
  refreshOfflineToken,
  registerComplianceWebhooks,
} from "./shopify.js";
import {
  getShop,
  listShops,
  upsertShop,
  saveShopTokens,
  setShopPlan,
  incrementListingUsage,
  logPublished,
  deleteShop,
} from "./db.js";
import { generateListing } from "./ai/generateListing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = "0.0.0.0";
const FREE_LIMIT = Number(process.env.LISTINGAI_FREE_LISTINGS || 25);
const PRICE_USD = 7.99;
const APP_SECRET =
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
  limit: "4mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks")) return next();
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  const shop = String(req.query.shop || "")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .slice(0, 80);
  const ancestors = [
    "https://admin.shopify.com",
    "https://*.myshopify.com",
    shop ? `https://${shop}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  res.removeHeader("X-Frame-Options");
  next();
});
app.use(
  express.static(path.join(__dirname, "..", "web"), { index: false })
);

function requireEnv() {
  const missing = [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "OPENROUTER_API_KEY",
  ].filter((k) => !process.env[k]?.trim());
  if (missing.length) console.warn("⚠️  Missing env:", missing.join(", "));
}

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
  const needsCycle = !row.refresh_token;
  const needsRefresh =
    row.refresh_token &&
    (!row.token_expires_at || new Date(row.token_expires_at).getTime() < soon);
  try {
    if (needsCycle) {
      const tokens = await cycleToExpiringToken(shop, row.access_token);
      row = saveShopTokens(shop, tokens);
    } else if (needsRefresh) {
      const tokens = await refreshOfflineToken(shop, row.refresh_token);
      row = saveShopTokens(shop, tokens);
    }
  } catch (e) {
    console.error("token cycle/refresh:", e.message);
    throw new Error(
      "Shopify session expired. Reinstall via /auth?shop=" + shop
    );
  }
  return sessionFromShop(shop, getShop(shop).access_token);
}

function canGenerate(row) {
  if (!row) return false;
  if (row.plan === "pro") return true;
  return row.listings_used < FREE_LIMIT;
}

function usagePayload(row) {
  return {
    plan: row.plan,
    listings_used: row.listings_used,
    free_limit: FREE_LIMIT,
    remaining:
      row.plan === "pro" ? null : Math.max(0, FREE_LIMIT - row.listings_used),
    price_usd: PRICE_USD,
  };
}

function healthPayload() {
  return {
    ok: true,
    app: "ListingAI SEO",
    version: "3.0.4",
    price_usd: PRICE_USD,
    public_url: process.env.SHOPIFY_APP_URL || null,
  };
}
app.get("/health", (_req, res) => res.json(healthPayload()));
app.get("/healthz", (_req, res) => res.json(healthPayload()));
app.get("/ready", (_req, res) => res.json(healthPayload()));

app.get("/privacy", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "privacy.html"));
});

app.get("/support", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "support.html"));
});

app.get("/auth", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    if (!shop) return res.status(400).send("Missing shop");
    const embedded = String(req.query.embedded || "") === "1";
    if (embedded) {
      const q = new URLSearchParams({ shop });
      if (req.query.host) q.set("host", String(req.query.host));
      return res
        .status(200)
        .type("html")
        .send(
          `<!doctype html><meta charset="utf-8"><script>window.top.location.href=${JSON.stringify(`/auth?${q.toString()}`)};</script>`
        );
    }
    await shopify.auth.begin({
      shop,
      callbackPath: "/auth/callback",
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
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    const { session } = callback;
    upsertShop(session.shop, session.accessToken);
    try {
      const tokens = await cycleToExpiringToken(
        session.shop,
        session.accessToken
      );
      saveShopTokens(session.shop, tokens);
    } catch (e) {
      console.error("cycle to expiring token:", e.message);
    }
    try {
      await registerComplianceWebhooks(session);
    } catch (e) {
      console.warn("register webhooks:", e.message);
    }
    res.redirect(
      `/?shop=${encodeURIComponent(session.shop)}&host=${encodeURIComponent(req.query.host || "")}`
    );
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/", (req, res) => {
  const shop = req.query.shop ? normalizeShop(req.query.shop) : "";
  const hmac = req.query.hmac || req.query.id_token;
  if (shop) {
    const row = getShop(shop);
    if (!row?.access_token) {
      const q = new URLSearchParams({ shop });
      if (req.query.host) q.set("host", String(req.query.host));
      if (hmac) q.set("hmac", String(req.query.hmac));
      if (String(req.query.embedded || "") === "1") q.set("embedded", "1");
      return res.redirect(302, `/auth?${q.toString()}`);
    }
  }
  res.sendFile(path.join(__dirname, "..", "web", "index.html"));
});

app.get("/api/me", async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  const row = getShop(shop);
  if (!row) return res.status(401).json({ error: "Not installed" });

  let billing = null;
  let session = null;
  try {
    session = await getValidSession(shop);
    billing = session ? await getActiveCharge(session) : null;
    if (billing && row.plan !== "pro") setShopPlan(shop, "pro", String(billing.id));
  } catch {
    /* ignore */
  }

  res.json({
    shop,
    usage: usagePayload(getShop(shop)),
    billing_active: Boolean(billing),
  });
});

app.get("/api/products", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).json({ error: "Not installed" });
    const session = await getValidSession(shop);
    if (!session) {
      return res.status(401).json({ error: "Shopify session expired. Reinstall the app." });
    }
    const body = await shopifyRest(session, "products", {
      query: { limit: 50 },
    });
    const products = (body.products || []).map((p) => ({
      id: p.id,
      title: p.title,
      tags: p.tags || "",
      vendor: p.vendor || "",
      product_type: p.product_type || "",
      price: p.variants?.[0]?.price || "",
      image: p.image?.src || p.images?.[0]?.src || "",
      image_id: p.image?.id || p.images?.[0]?.id || null,
      body_preview: String(p.body_html || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280),
    }));
    res.json({ products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to load products" });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop || req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).json({ error: "Not installed" });
    if (!canGenerate(row)) {
      return res.status(402).json({
        error: "Free limit reached",
        usage: usagePayload(row),
        upgrade_url: `/billing/start?shop=${encodeURIComponent(shop)}`,
      });
    }

    let {
      productHint,
      niche,
      price,
      tone,
      language,
      imageUrl,
      brandVoice,
      productId,
    } = req.body;

    if (productId) {
      const session = await getValidSession(shop);
      const body = await shopifyRest(session, `products/${productId}`);
      const p = body.product;
      if (!p) return res.status(404).json({ error: "Product not found" });
      const img = p.image?.src || p.images?.[0]?.src || "";
      const plain = String(p.body_html || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      productHint = [
        `Title: ${p.title}`,
        p.product_type ? `Type: ${p.product_type}` : "",
        p.vendor ? `Vendor: ${p.vendor}` : "",
        p.tags ? `Tags: ${p.tags}` : "",
        p.variants?.[0]?.price ? `Price: $${p.variants[0].price}` : "",
        plain ? `Current description: ${plain.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      imageUrl = img || imageUrl;
      if (!price) price = p.variants?.[0]?.price || price;
    }

    if (!productHint?.trim()) {
      return res.status(400).json({ error: "productHint or productId required" });
    }

    const result = await generateListing({
      hint: productHint.trim(),
      productHint: productHint.trim(),
      niche,
      price,
      tone,
      language,
      imageUrl: imageUrl?.trim() || "",
      brandVoice: brandVoice?.trim() || "",
    });
    incrementListingUsage(shop);
    res.json({
      variations: result.variations,
      listing: result.listing,
      productId: productId || null,
      imageUrl: imageUrl?.trim() || "",
      usage: usagePayload(getShop(shop)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Generate failed" });
  }
});

app.post("/api/publish", async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop || req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).json({ error: "Not installed" });

    const { listing, vendor, product_type, price, imageUrl, productId } =
      req.body;
    if (!listing?.title)
      return res.status(400).json({ error: "listing.title required" });

    const session = await getValidSession(shop);
    const bodyHtml = [listing.body_html || "", listing.faq_html || ""]
      .filter(Boolean)
      .join("\n");

    if (productId) {
      let images;
      try {
        const existing = await shopifyRest(session, `products/${productId}`);
        const img =
          existing.product?.image || existing.product?.images?.[0];
        if (img?.id) {
          images = [
            { id: img.id, alt: listing.image_alt || listing.title },
          ];
        }
      } catch {
        /* alt update is optional */
      }
      const payload = {
        product: {
          id: Number(productId),
          title: listing.title,
          body_html: bodyHtml,
          tags: listing.tags || "",
          metafields_global_title_tag: listing.metafields_global_title_tag,
          metafields_global_description_tag:
            listing.metafields_global_description_tag,
          ...(images ? { images } : {}),
        },
      };
      const updated = await shopifyRestPut(
        session,
        `products/${productId}`,
        payload
      );
      logPublished(shop, String(productId), "update");
      return res.json({
        product: updated.product,
        updated: true,
        usage: usagePayload(getShop(shop)),
      });
    }

    const product = {
      product: {
        title: listing.title,
        body_html: bodyHtml,
        tags: listing.tags || "",
        vendor: vendor || "ListingAI",
        product_type: product_type || "",
        metafields_global_title_tag: listing.metafields_global_title_tag,
        metafields_global_description_tag:
          listing.metafields_global_description_tag,
        variants: [
          {
            price: String(price || "19.99"),
            inventory_management: null,
          },
        ],
        images: imageUrl?.startsWith("http")
          ? [{ src: imageUrl, alt: listing.image_alt || listing.title }]
          : undefined,
      },
    };

    const created = await shopifyRestPost(session, "products", product);
    logPublished(shop, String(created.product?.id || ""), "publish");
    res.json({ product: created.product, usage: usagePayload(getShop(shop)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Publish failed" });
  }
});

app.post("/api/bulk", async (req, res) => {
  try {
    const shop = normalizeShop(req.body.shop || req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).json({ error: "Not installed" });

    const lines = String(req.body.lines || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (!lines.length) return res.status(400).json({ error: "lines required" });

    const results = [];
    for (const line of lines) {
      if (!canGenerate(getShop(shop))) {
        results.push({ input: line, error: "Free limit reached" });
        break;
      }
      try {
        const result = await generateListing({
          productHint: line,
          tone: req.body.tone,
          language: req.body.language,
          brandVoice: req.body.brandVoice,
        });
        incrementListingUsage(shop);
        results.push({
          input: line,
          listing: result.listing,
          variations: result.variations,
        });
      } catch (e) {
        results.push({ input: line, error: e.message });
      }
    }

    res.json({ results, usage: usagePayload(getShop(shop)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Bulk failed" });
  }
});

app.get("/billing/start", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).send("Not installed");
    const session = await getValidSession(shop);
    const charge = await createRecurringCharge(session);
    setShopPlan(shop, "pending", String(charge.id));
    res.redirect(charge.confirmation_url);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/billing/callback", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    const chargeId = req.query.charge_id;
    const row = getShop(shop);
    if (!row) return res.status(401).send("Not installed");
    const session = await getValidSession(shop);
    await activateCharge(session, chargeId);
    setShopPlan(shop, "pro", String(chargeId));
    res.redirect(`/?shop=${encodeURIComponent(shop)}&billing=ok`);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

function verifyWebhook(req, res, next) {
  const secret = APP_SECRET;
  if (!secret) return res.sendStatus(401);
  const hmac = req.get("x-shopify-hmac-sha256") || "";
  const body = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}));
  const digest = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  if (!hmac || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.sendStatus(401);
  }
  next();
}

function okWebhook(_req, res) {
  res.sendStatus(200);
}

app.get(
  [
    "/webhooks/customers/data_request",
    "/webhooks/customers/redact",
    "/webhooks/shop/redact",
    "/webhooks/app/uninstalled",
    "/webhooks/compliance",
  ],
  (_req, res) => res.status(200).send("ok")
);
app.post("/webhooks/customers/data_request", verifyWebhook, okWebhook);
app.post("/webhooks/customers/redact", verifyWebhook, okWebhook);
app.post("/webhooks/compliance", verifyWebhook, (req, res) => {
  const topic = String(req.get("x-shopify-topic") || "");
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop && (topic === "shop/redact" || topic === "app/uninstalled")) {
    deleteShop(shop);
  }
  res.sendStatus(200);
});
app.post("/webhooks/shop/redact", verifyWebhook, (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop) deleteShop(shop);
  res.sendStatus(200);
});
app.post("/webhooks/app/uninstalled", verifyWebhook, (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop) deleteShop(shop);
  res.sendStatus(200);
});

async function cycleStoredTokens() {
  for (const row of listShops()) {
    if (!row?.shop || !row.access_token) continue;
    try {
      await getValidSession(row.shop);
      console.log("token ok", row.shop);
    } catch (e) {
      console.error("token cycle", row.shop, e.message);
    }
  }
}

requireEnv();
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(
    `ListingAI SEO v3.0.4 → ${process.env.SHOPIFY_APP_URL || `http://${BIND_HOST}:${PORT}`} · $${PRICE_USD}/mo`
  );
  cycleStoredTokens();
});
server.on("error", (err) => {
  console.error("Listen failed:", err.message);
  process.exit(1);
});
