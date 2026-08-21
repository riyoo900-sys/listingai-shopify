import "@shopify/shopify-api/adapters/node";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-01";

const hostName = new URL(process.env.SHOPIFY_APP_URL || "http://localhost:3000")
  .host;

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SHOPIFY_API_SCOPES || "read_products,write_products")
    .split(",")
    .map((s) => s.trim()),
  hostName,
  hostScheme: process.env.SHOPIFY_APP_URL?.startsWith("https") ? "https" : "http",
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  restResources,
});

export function sessionFromShop(shop, accessToken) {
  const session = shopify.session.customAppSession(shop);
  session.accessToken = accessToken;
  return session;
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

export async function createRecurringCharge(session) {
  const price = Number(process.env.LISTINGAI_PRICE_USD || 9);
  const planName = process.env.LISTINGAI_PLAN_NAME || "ListingAI Pro";
  const returnUrl = `${process.env.SHOPIFY_APP_URL}/billing/callback?shop=${encodeURIComponent(session.shop)}`;

  const client = new shopify.clients.Rest({ session });
  const res = await client.post({
    path: "recurring_application_charges",
    data: {
      recurring_application_charge: {
        name: planName,
        price,
        return_url: returnUrl,
        trial_days: 7,
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

export async function getActiveCharge(session) {
  const client = new shopify.clients.Rest({ session });
  const res = await client.get({ path: "recurring_application_charges" });
  const charges = res.body.recurring_application_charges || [];
  return charges.find((c) => c.status === "active") || null;
}
