import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-07";

function resolveAppUrl() {
  const raw = String(process.env.SHOPIFY_APP_URL || "http://localhost:3000").trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return new URL("http://localhost:3000");
  }
}

const appUrl = resolveAppUrl();
const hostName = appUrl.host;

// Placeholders keep boot alive on Render if env vars are missing;
// auth/API routes still need real keys from the Environment tab.
const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "missing-api-key";
const apiSecretKey =
  process.env.SHOPIFY_API_SECRET?.trim() ||
  process.env.SHOPIFY_SECRET?.trim() ||
  "missing-api-secret";

if (
  apiKey === "missing-api-key" ||
  apiSecretKey === "missing-api-secret"
) {
  console.error(
    "⚠️  Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in Render → Environment"
  );
}

export const shopify = shopifyApi({
  apiKey,
  apiSecretKey,
  scopes: (process.env.SHOPIFY_API_SCOPES || "read_products,write_products")
    .split(",")
    .map((s) => s.trim()),
  hostName,
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
    throw new Error(
      data.error_description || data.error || `Token HTTP ${res.status}`
    );
  }
  return data;
}

/** Exchange a non-expiring offline token for an expiring pair. */
export async function cycleToExpiringToken(shop, offlineToken) {
  return oauthToken(shop, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: offlineToken,
    subject_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
}

export async function refreshOfflineToken(shop, refreshToken) {
  return oauthToken(shop, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
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

export async function shopifyRestPut(session, path, data) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.put({ path, data });
  return res.body;
}

export async function createRecurringCharge(session, plan) {
  const returnUrl = `${process.env.SHOPIFY_APP_URL}/billing/callback?shop=${encodeURIComponent(session.shop)}&plan=${encodeURIComponent(plan.id)}`;

  const client = new shopify.clients.Rest({ session });
  const res = await client.post({
    path: "recurring_application_charges",
    data: {
      recurring_application_charge: {
        name: plan.name,
        price: plan.price,
        return_url: returnUrl,
        trial_days: plan.trial_days ?? 7,
        test: process.env.SHOPIFY_BILLING_TEST === "true",
      },
    },
  });
  return res.body.recurring_application_charge;
}

export async function activateCharge(session, chargeId) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.post({
    path: `recurring_application_charges/${chargeId}/activate`,
  });
  return res.body.recurring_application_charge;
}

export async function registerComplianceWebhooks(session) {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const topics = [
    ["app/uninstalled", `${base}/webhooks/app/uninstalled`],
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

export async function getActiveCharge(session) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.get({ path: "recurring_application_charges" });
  const charges = res.body.recurring_application_charges || [];
  return charges.find((c) => c.status === "active") || null;
}
