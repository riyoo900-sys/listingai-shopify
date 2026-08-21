import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "shops.json");

fs.mkdirSync(dataDir, { recursive: true });

function load() {
  if (!fs.existsSync(dbPath)) {
    return { shops: {}, logs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch {
    return { shops: {}, logs: [] };
  }
}

function save(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
}

export function getShop(shop) {
  const data = load();
  return data.shops[shop] || null;
}

export function upsertShop(shop, accessToken) {
  const data = load();
  const now = new Date().toISOString();
  data.shops[shop] = data.shops[shop] || {
    shop,
    plan: "free",
    listings_used: 0,
    charge_id: null,
    installed_at: now,
  };
  data.shops[shop].access_token = accessToken;
  data.shops[shop].updated_at = now;
  if (!data.shops[shop].installed_at) data.shops[shop].installed_at = now;
  save(data);
  return getShop(shop);
}

export function setShopPlan(shop, plan, chargeId = null) {
  const data = load();
  if (!data.shops[shop]) return;
  data.shops[shop].plan = plan;
  if (chargeId) data.shops[shop].charge_id = chargeId;
  data.shops[shop].updated_at = new Date().toISOString();
  save(data);
}

export function incrementListingUsage(shop) {
  const data = load();
  if (!data.shops[shop]) return;
  data.shops[shop].listings_used = (data.shops[shop].listings_used || 0) + 1;
  data.shops[shop].updated_at = new Date().toISOString();
  data.logs.push({
    shop,
    source: "generate",
    created_at: new Date().toISOString(),
  });
  save(data);
}

export function logPublished(shop, productId, source) {
  const data = load();
  data.logs.push({
    shop,
    source: source || "publish",
    product_id: productId || null,
    created_at: new Date().toISOString(),
  });
  save(data);
}

export function shopStats(shop) {
  const row = getShop(shop);
  if (!row) return null;
  const data = load();
  const total = data.logs.filter((l) => l.shop === shop).length;
  return { ...row, total_listings: total };
}
