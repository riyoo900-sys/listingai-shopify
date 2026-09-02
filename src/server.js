import "dotenv/config";
import express from "express";
import compression from "compression";
import crypto from "node:crypto";
import fs from "node:fs";
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
  ensureMonthlyRow,
} from "./db.js";
import { generateListing, buildShopifyVariants } from "./ai/generateListing.js";
import {
  FREE_LIMIT,
  PLANS,
  resolvePlanId,
  planFromChargePrice,
  plansForClient,
} from "./plans.js";
import { app as pixelsApp } from "../pixels/src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = "0.0.0.0";
const APP_SECRET =
  process.env.SHOPIFY_API_SECRET?.trim() ||
  process.env.SHOPIFY_SECRET?.trim() ||
  "";

app.use(compression());
app.use("/pixels", pixelsApp);
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
  limit: "12mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks") || req.path.startsWith("/pixels")) return next();
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  const shop = String(req.query.shop || "")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .slice(0, 80);
  const ancestors = [
    "https://admin.shopify.com",
    "https://*.shopify.com",
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
  const fresh = ensureMonthlyRow(row.shop) || row;
  if (fresh.plan === "pro") return true;
  if (fresh.plan === "starter") {
    return (fresh.monthly_listings_used || 0) < PLANS.starter.limit;
  }
  return (fresh.listings_used || 0) < FREE_LIMIT;
}

function usagePayload(row) {
  const fresh = (row?.shop ? ensureMonthlyRow(row.shop) : null) || row;
  if (!fresh) return { plans: plansForClient() };

  const plans = plansForClient();

  if (fresh.plan === "pro") {
    return {
      plan: "pro",
      listings_used: fresh.listings_used || 0,
      free_limit: FREE_LIMIT,
      plan_limit: null,
      monthly_used: fresh.monthly_listings_used || 0,
      remaining: null,
      plans,
    };
  }

  if (fresh.plan === "starter") {
    const limit = PLANS.starter.limit;
    const used = fresh.monthly_listings_used || 0;
    return {
      plan: "starter",
      listings_used: fresh.listings_used || 0,
      free_limit: FREE_LIMIT,
      plan_limit: limit,
      monthly_used: used,
      remaining: Math.max(0, limit - used),
      plans,
    };
  }

  return {
    plan: "free",
    listings_used: fresh.listings_used || 0,
    free_limit: FREE_LIMIT,
    plan_limit: null,
    monthly_used: fresh.monthly_listings_used || 0,
    remaining: Math.max(0, FREE_LIMIT - (fresh.listings_used || 0)),
    plans,
  };
}

function healthPayload() {
  return {
    ok: true,
    app: "ListingAI SEO",
    version: "4.2.0",
    plans: plansForClient(),
    free_limit: FREE_LIMIT,
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
    const dest = String(req.get("sec-fetch-dest") || "");
    const inIframe =
      dest === "iframe" ||
      dest === "nested-document" ||
      String(req.query.embedded || "") === "1";
    if (inIframe) {
      const q = new URLSearchParams({ shop });
      if (req.query.host) q.set("host", String(req.query.host));
      const appUrl = String(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const abs = `${appUrl}/auth?${q.toString()}`;
      return res
        .status(200)
        .type("html")
        .send(
          `<!doctype html><meta charset="utf-8"><script>window.top.location.href=${JSON.stringify(abs)};</script>`
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
    const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "";
    res.redirect(`https://${session.shop}/admin/apps/${apiKey}`);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

function normalizePrice(raw) {
  const n = String(raw || "")
    .replace(/[^\d.,]/g, "")
    .replace(",", ".");
  const v = parseFloat(n);
  return Number.isFinite(v) && v > 0 ? v.toFixed(2) : "19.99";
}

function sendAppHtml(res) {
  const htmlPath = path.join(__dirname, "..", "web", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "";
  html = html.replaceAll("%%SHOPIFY_API_KEY%%", apiKey);
  html = html.replaceAll("%%APP_VERSION%%", "4.2.0");
  res.type("html").send(html);
}

app.get("/", (req, res) => {
  const shop = req.query.shop ? normalizeShop(req.query.shop) : "";
  const embedded =
    String(req.query.embedded || "") === "1" || Boolean(req.query.host);
  // Never bounce OAuth inside the Admin iframe — that leaves a white screen.
  if (shop && !embedded) {
    const row = getShop(shop);
    if (!row?.access_token) {
      const q = new URLSearchParams({ shop });
      if (req.query.host) q.set("host", String(req.query.host));
      return res.redirect(302, `/auth?${q.toString()}`);
    }
  }
  sendAppHtml(res);
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
    if (billing) {
      const detected = planFromChargePrice(billing.price);
      const current = getShop(shop);
      if (current && current.plan !== detected) {
        setShopPlan(shop, detected, String(billing.id));
      }
    }
  } catch {
    /* ignore */
  }

  res.json({
    shop,
    usage: usagePayload(getShop(shop)),
    billing_active: Boolean(billing),
  });
});

app.get("/api/categories", async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    const row = getShop(shop);
    if (!row) return res.status(401).json({ error: "Not installed" });
    const session = await getValidSession(shop);
    if (!session) {
      return res.status(401).json({ error: "Shopify session expired. Reinstall the app." });
    }

    const types = new Set();
    const collections = [];

    try {
      const body = await shopifyRest(session, "products", {
        query: { limit: 250, fields: "id,product_type" },
      });
      for (const p of body.products || []) {
        const t = String(p.product_type || "").trim();
        if (t) types.add(t);
      }
    } catch (e) {
      console.warn("categories products:", e.message);
    }

    try {
      const cc = await shopifyRest(session, "custom_collections", {
        query: { limit: 250 },
      });
      for (const c of cc.custom_collections || []) {
        collections.push({
          id: c.id,
          title: c.title,
          handle: c.handle || "",
        });
      }
    } catch (e) {
      console.warn("categories collections:", e.message);
    }

    const defaults = [
      "Fashion & Apparel",
      "Beauty & Skincare",
      "Jewelry & Watches",
      "Bags & Accessories",
      "Shoes & Footwear",
      "Home & Living",
      "Electronics & Gadgets",
      "Sports & Fitness",
      "Kids & Baby",
      "Health & Wellness",
      "Other",
    ];
    for (const d of defaults) types.add(d);

    res.json({
      product_types: [...types].sort((a, b) => a.localeCompare(b)),
      collections: collections.sort((a, b) => a.title.localeCompare(b.title)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to load categories" });
  }
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
      const fresh = getShop(shop);
      const usage = usagePayload(fresh);
      const msg =
        fresh?.plan === "starter"
          ? "Starter monthly limit reached (50 listings). Upgrade to Pro for unlimited."
          : "Free limit reached";
      return res.status(402).json({
        error: msg,
        usage,
        upgrade_url: `/billing/start?shop=${encodeURIComponent(shop)}&plan=pro`,
      });
    }

    let {
      productName,
      productHint,
      price,
      language,
      imageUrl,
      imageBase64,
      productId,
      category,
      collectionTitle,
    } = req.body;

    let existingHint = "";

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
      if (!productName?.trim()) productName = p.title;
      if (!price) price = p.variants?.[0]?.price || price;
      if (!imageUrl && !imageBase64) imageUrl = img;
      if (!category?.trim() && p.product_type) category = p.product_type;
      existingHint = [
        `Current title: ${p.title}`,
        p.product_type ? `Type: ${p.product_type}` : "",
        p.tags ? `Tags: ${p.tags}` : "",
        plain ? `Description: ${plain.slice(0, 600)}` : "",
        p.variants?.length > 1
          ? `Existing variants: ${p.variants.map((v) => [v.option1, v.option2].filter(Boolean).join("/")).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const name = String(productName || productHint || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Product name is required" });
    }

    const hasImage =
      Boolean(String(imageBase64 || "").trim()) ||
      Boolean(String(imageUrl || "").trim().startsWith("http"));

    if (!hasImage && !productId) {
      return res.status(400).json({
        error: "Upload a product photo so AI can analyze it.",
      });
    }

    const storeCategory = String(category || "").trim();

    const result = await generateListing({
      productName: name,
      productHint: name,
      price: normalizePrice(price),
      language,
      category: storeCategory || undefined,
      collectionTitle: String(collectionTitle || "").trim(),
      imageUrl: imageUrl?.trim() || "",
      imageBase64: imageBase64?.trim() || "",
      existingHint,
    });
    incrementListingUsage(shop);
    res.json({
      ...result,
      productId: productId || null,
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

    const {
      listing,
      options,
      price,
      imageUrl,
      imageBase64,
      productId,
      collectionId,
      category,
    } = req.body;
    if (!listing?.title)
      return res.status(400).json({ error: "listing.title required" });

    const session = await getValidSession(shop);
    const bodyHtml = [listing.body_html || "", listing.faq_html || ""]
      .filter(Boolean)
      .join("\n");

    const { options: shopifyOptions, variants } = buildShopifyVariants(
      options || {},
      normalizePrice(price)
    );

    function buildImages() {
      const alt = listing.image_alt || listing.title;
      const b64 = String(imageBase64 || "").trim();
      if (b64.startsWith("data:image")) {
        const attachment = b64.replace(/^data:image\/\w+;base64,/, "");
        return [{ attachment, alt }];
      }
      if (imageUrl?.startsWith("http")) {
        return [{ src: imageUrl, alt }];
      }
      return undefined;
    }

    const productType =
      String(category || listing.product_type || "").trim() ||
      listing.product_type ||
      "";

    if (productId) {
      let images;
      try {
        const existing = await shopifyRest(session, `products/${productId}`);
        const img =
          existing.product?.image || existing.product?.images?.[0];
        const newImages = buildImages();
        if (newImages?.length) {
          images = newImages;
        } else if (img?.id) {
          images = [{ id: img.id, alt: listing.image_alt || listing.title }];
        }
      } catch {
        /* optional */
      }
      const payload = {
        product: {
          id: Number(productId),
          title: listing.title,
          body_html: bodyHtml,
          tags: listing.tags || "",
          ...(productType ? { product_type: productType } : {}),
          vendor: listing.vendor || undefined,
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
      if (collectionId) {
        try {
          await shopifyRestPost(session, "collects", {
            collect: {
              product_id: Number(productId),
              collection_id: Number(collectionId),
            },
          });
        } catch (e) {
          console.warn("collect update:", e.message);
        }
      }
      logPublished(shop, String(productId), "update");
      return res.json({
        product: updated.product,
        updated: true,
        usage: usagePayload(getShop(shop)),
      });
    }

    const productPayload = {
      title: listing.title,
      body_html: bodyHtml,
      tags: listing.tags || "",
      vendor: listing.vendor || "ListingAI",
      product_type: productType,
      metafields_global_title_tag: listing.metafields_global_title_tag,
      metafields_global_description_tag:
        listing.metafields_global_description_tag,
      variants,
      ...(shopifyOptions.length ? { options: shopifyOptions } : {}),
    };
    const imgs = buildImages();
    if (imgs?.length) productPayload.images = imgs;

    const created = await shopifyRestPost(session, "products", {
      product: productPayload,
    });
    const newId = created.product?.id;
    if (collectionId && newId) {
      try {
        await shopifyRestPost(session, "collects", {
          collect: {
            product_id: Number(newId),
            collection_id: Number(collectionId),
          },
        });
      } catch (e) {
        console.warn("collect create:", e.message);
      }
    }
    logPublished(shop, String(newId || ""), "publish");
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
          productName: line,
          productHint: line,
          language: req.body.language,
          price: normalizePrice(req.body.price),
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
    const planId = resolvePlanId(req.query.plan);
    const plan = PLANS[planId] || PLANS.pro;
    const session = await getValidSession(shop);
    const charge = await createRecurringCharge(session, plan);
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
    const planId = resolvePlanId(req.query.plan);
    const row = getShop(shop);
    if (!row) return res.status(401).send("Not installed");
    const session = await getValidSession(shop);
    await activateCharge(session, chargeId);
    setShopPlan(shop, planId, String(chargeId));
    res.redirect(`/?shop=${encodeURIComponent(shop)}&billing=ok&plan=${planId}`);
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
    `ListingAI SEO v4.2.0 → ${process.env.SHOPIFY_APP_URL || `http://${BIND_HOST}:${PORT}`} · Starter $${PLANS.starter.price} · Pro $${PLANS.pro.price}`
  );
  cycleStoredTokens();
});
server.on("error", (err) => {
  console.error("Listen failed:", err.message);
  process.exit(1);
});
