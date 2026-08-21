import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shopify,
  sessionFromShop,
  shopifyRestPost,
  createRecurringCharge,
  activateCharge,
  getActiveCharge,
} from "./shopify.js";
import {
  getShop,
  upsertShop,
  setShopPlan,
  incrementListingUsage,
  logPublished,
} from "./db.js";
import { generateListing } from "./ai/generateListing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const FREE_LIMIT = Number(process.env.LISTINGAI_FREE_LISTINGS || 15);

app.use(compression());
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "..", "web")));

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
    price_usd: Number(process.env.LISTINGAI_PRICE_USD || 9),
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "ListingAI", version: "2.0.0" });
});

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
    res.redirect(
      `/?shop=${encodeURIComponent(session.shop)}&host=${encodeURIComponent(req.query.host || "")}`
    );
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "index.html"));
});

app.get("/api/me", async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  const row = getShop(shop);
  if (!row) return res.status(401).json({ error: "Not installed" });

  const session = sessionFromShop(shop, row.access_token);
  let billing = null;
  try {
    billing = await getActiveCharge(session);
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

    const { productHint, niche, price, tone, language, imageUrl } = req.body;
    if (!productHint?.trim()) {
      return res.status(400).json({ error: "productHint required" });
    }

    const result = await generateListing({
      productHint: productHint.trim(),
      niche,
      price,
      tone,
      language,
      imageUrl: imageUrl?.trim() || "",
    });
    incrementListingUsage(shop);
    res.json({
      variations: result.variations,
      listing: result.listing,
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

    const { listing, vendor, product_type, price, imageUrl } = req.body;
    if (!listing?.title) return res.status(400).json({ error: "listing.title required" });

    const session = sessionFromShop(shop, row.access_token);
    const bodyHtml = [listing.body_html || "", listing.faq_html || ""]
      .filter(Boolean)
      .join("\n");

    const product = {
      product: {
        title: listing.title,
        body_html: bodyHtml,
        tags: listing.tags || "",
        vendor: vendor || "ListingAI",
        product_type: product_type || "",
        metafields_global_title_tag: listing.metafields_global_title_tag,
        metafields_global_description_tag: listing.metafields_global_description_tag,
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
      .slice(0, 20);

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
        });
        incrementListingUsage(shop);
        results.push({ input: line, listing: result.listing, variations: result.variations });
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
    const session = sessionFromShop(shop, row.access_token);
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
    const session = sessionFromShop(shop, row.access_token);
    await activateCharge(session, chargeId);
    setShopPlan(shop, "pro", String(chargeId));
    res.redirect(`/?shop=${encodeURIComponent(shop)}&billing=ok`);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.post("/webhooks/customers/data_request", (_req, res) => res.sendStatus(200));
app.post("/webhooks/customers/redact", (_req, res) => res.sendStatus(200));
app.post("/webhooks/shop/redact", (_req, res) => res.sendStatus(200));
app.post("/webhooks/app/uninstalled", (req, res) => {
  const shop = normalizeShop(req.get("x-shopify-shop-domain") || "");
  if (shop) setShopPlan(shop, "uninstalled");
  res.sendStatus(200);
});

requireEnv();
app.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`ListingAI v2 → ${process.env.SHOPIFY_APP_URL || `http://localhost:${PORT}`}`);
});
