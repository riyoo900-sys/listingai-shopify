import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "pixels-shops.json");
fs.mkdirSync(dataDir, { recursive: true });

function load() {
  if (!fs.existsSync(dbPath)) return { shops: {} };
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch {
    return { shops: {} };
  }
}
function save(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
}

export function getShop(shop) {
  return load().shops[shop] || null;
}
export function listShops() {
  return Object.values(load().shops || {});
}
export function upsertShop(shop, accessToken, extra = {}) {
  const data = load();
  const now = new Date().toISOString();
  data.shops[shop] = data.shops[shop] || {
    shop,
    plan: "free",
    pixels: [],
    events_today: 0,
    installed_at: now,
  };
  if (accessToken) data.shops[shop].access_token = accessToken;
  Object.assign(data.shops[shop], extra);
  data.shops[shop].updated_at = now;
  save(data);
  return getShop(shop);
}
export function saveShopTokens(shop, tokenPayload) {
  const expiresIn = Number(tokenPayload.expires_in || 3600);
  const refreshIn = Number(tokenPayload.refresh_token_expires_in || 7776000);
  return upsertShop(shop, tokenPayload.access_token, {
    refresh_token: tokenPayload.refresh_token,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + refreshIn * 1000).toISOString(),
  });
}
export function setShopPlan(shop, plan, chargeId = null) {
  const data = load();
  if (!data.shops[shop]) return;
  data.shops[shop].plan = plan;
  if (chargeId) data.shops[shop].charge_id = chargeId;
  save(data);
}
export function listPixels(shop) {
  return getShop(shop)?.pixels || [];
}
export function addPixel(shop, pixel) {
  const data = load();
  if (!data.shops[shop]) return null;
  const row = {
    id: crypto.randomUUID(),
    name: String(pixel.name || "Pixel").slice(0, 80),
    pixel_id: String(pixel.pixel_id || "").replace(/\D/g, ""),
    capi_token: String(pixel.capi_token || ""),
    test_code: String(pixel.test_code || ""),
    events: Array.isArray(pixel.events)
      ? pixel.events
      : ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    enabled: true,
    created_at: new Date().toISOString(),
  };
  if (!row.pixel_id) throw new Error("Pixel ID required");
  data.shops[shop].pixels = data.shops[shop].pixels || [];
  data.shops[shop].pixels.push(row);
  save(data);
  return row;
}
export function updatePixel(shop, id, patch) {
  const data = load();
  const list = data.shops[shop]?.pixels || [];
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  if (patch.name != null) list[i].name = String(patch.name).slice(0, 80);
  if (patch.pixel_id != null) list[i].pixel_id = String(patch.pixel_id).replace(/\D/g, "");
  if (patch.capi_token != null && patch.capi_token !== "") list[i].capi_token = String(patch.capi_token);
  if (patch.test_code != null) list[i].test_code = String(patch.test_code);
  if (patch.events) list[i].events = patch.events;
  if (patch.enabled != null) list[i].enabled = Boolean(patch.enabled);
  save(data);
  return list[i];
}
export function removePixel(shop, id) {
  const data = load();
  if (!data.shops[shop]) return;
  data.shops[shop].pixels = (data.shops[shop].pixels || []).filter((p) => p.id !== id);
  save(data);
}
export function publicPixels(shop) {
  return listPixels(shop)
    .filter((p) => p.enabled && p.pixel_id)
    .map((p) => ({
      id: p.id,
      pixel_id: p.pixel_id,
      events: p.events,
    }));
}
export function bumpEvents(shop) {
  const data = load();
  if (!data.shops[shop]) return;
  data.shops[shop].events_today = (data.shops[shop].events_today || 0) + 1;
  save(data);
}
export function deleteShop(shop) {
  const data = load();
  delete data.shops[shop];
  save(data);
}
