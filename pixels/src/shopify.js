import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-07";

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return "";
}

function resolveAppUrl() {
  const raw = envFirst("PIXELS_APP_URL", "SHOPIFY_APP_URL") || "http://localhost:3010";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return new URL("http://localhost:3010");
  }
}
const appUrl = resolveAppUrl();
export const APP_URL = String(appUrl.origin + (appUrl.pathname === "/" ? "" : appUrl.pathname.replace(/\/$/, "")));
export const AUTH_CALLBACK_PATH = `${appUrl.pathname.replace(/\/$/, "")}/auth/callback`;
const usePixelsCreds = Boolean(envFirst("PIXELS_APP_URL", "PIXELS_SHOPIFY_API_KEY"));
const apiKey = usePixelsCreds
  ? envFirst("PIXELS_SHOPIFY_API_KEY") || "missing-api-key"
  : envFirst("SHOPIFY_API_KEY") || "missing-api-key";
const apiSecretKey = usePixelsCreds
  ? envFirst("PIXELS_SHOPIFY_API_SECRET") || "missing-api-secret"
  : envFirst("SHOPIFY_API_SECRET", "SHOPIFY_SECRET") || "missing-api-secret";

export const shopify = shopifyApi({
  apiKey,
  apiSecretKey,
  scopes: (
    process.env.PIXELS_SHOPIFY_API_SCOPES ||
    "read_orders,write_script_tags,read_script_tags,read_customers"
  )
    .split(",")
    .map((s) => s.trim()),
  hostName: appUrl.host,
  hostScheme: appUrl.protocol === "https:" ? "https" : "http",
  apiVersion: ApiVersion.October25,
  isEmbeddedApp: true,
  restResources,
});

export function sessionFromShop(shop, accessToken) {
  const session = shopify.session.customAppSession(shop);
  session.accessToken = accessToken;
  return session;
}

async function oauthToken(shop, params) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecretKey,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token HTTP ${res.status}`);
  }
  return data;
}

export async function cycleToExpiringToken(shop, offlineToken) {
  return oauthToken(shop, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: offlineToken,
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
}
export async function refreshOfflineToken(shop, refreshToken) {
  return oauthToken(shop, { grant_type: "refresh_token", refresh_token: refreshToken });
}
export async function shopifyRest(session, path, options = {}) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.get({ path, ...options });
  return res.body;
}
export async function shopifyRestPost(session, path, data) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.post({ path, data });
  return res.body;
}

export { createSubscription as createRecurringCharge } from "./billing.js";
export async function activateCharge(session, chargeId) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.post({
    path: `recurring_application_charges/${chargeId}/activate`,
  });
  return res.body.recurring_application_charge;
}
export async function getActiveCharge(session) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.get({ path: "recurring_application_charges" });
  const charges = res.body.recurring_application_charges || [];
  return charges.find((c) => c.status === "active") || null;
}
export async function registerComplianceWebhooks(session) {
  const base = APP_URL;
  const topics = [
    ["app/uninstalled", `${base}/webhooks/app/uninstalled`],
    ["orders/paid", `${base}/webhooks/orders/paid`],
    ["customers/data_request", `${base}/webhooks/customers/data_request`],
    ["customers/redact", `${base}/webhooks/customers/redact`],
    ["shop/redact", `${base}/webhooks/shop/redact`],
  ];
  for (const [topic, address] of topics) {
    try {
      await shopifyRestPost(session, "webhooks", {
        webhook: { topic, address, format: "json" },
      });
    } catch (e) {
      console.warn("webhook", topic, e.message);
    }
  }
}
export async function ensureStorefrontScript(session, shop) {
  const src = `${APP_URL}/storefront.js?shop=${encodeURIComponent(shop)}`;
  try {
    const body = await shopifyRest(session, "script_tags");
    const existing = (body.script_tags || []).find((t) => String(t.src || "").includes("/storefront.js"));
    if (existing) return existing;
    return (
      await shopifyRestPost(session, "script_tags", {
        script_tag: { event: "onload", src, display_scope: "online_store" },
      })
    ).script_tag;
  } catch (e) {
    console.warn("script_tag", e.message);
    return null;
  }
}
