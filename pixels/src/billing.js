import { shopify } from "./shopify.js";

export const TRIAL_DAYS = 15;
export const PRICE_MONTHLY = 4.99;
export const PRICE_YEARLY = 45;

const CREATE = `#graphql
  mutation CreateSub(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: $lineItems
    ) {
      confirmationUrl
      userErrors { field message }
      appSubscription { id }
    }
  }
`;

const ACTIVE = `#graphql
  query ActiveSubs {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
      }
    }
  }
`;

function isTestCharge() {
  const v = process.env.PIXELS_BILLING_TEST ?? process.env.SHOPIFY_BILLING_TEST;
  return v !== "false";
}

export async function createSubscription(session, plan) {
  const annual = plan === "annual";
  const appUrl = String(
    process.env.PIXELS_APP_URL || process.env.SHOPIFY_APP_URL || ""
  ).replace(/\/$/, "");
  const returnUrl = `${appUrl}/billing/callback?shop=${encodeURIComponent(session.shop)}&plan=${annual ? "annual" : "monthly"}`;
  const client = new shopify.clients.Graphql({ session });
  const lineItems = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: {
            amount: annual ? PRICE_YEARLY : PRICE_MONTHLY,
            currencyCode: "USD",
          },
          interval: annual ? "ANNUAL" : "EVERY_30_DAYS",
        },
      },
    },
  ];
  const { data, errors } = await client.request(CREATE, {
    variables: {
      name: annual ? "YAMSHI Pixels Yearly" : "YAMSHI Pixels Monthly",
      returnUrl,
      trialDays: TRIAL_DAYS,
      test: isTestCharge(),
      lineItems,
    },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const payload = data?.appSubscriptionCreate;
  const ue = payload?.userErrors || [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  if (!payload?.confirmationUrl) throw new Error("Shopify billing did not return a confirmation URL");
  return {
    confirmation_url: payload.confirmationUrl,
    id: payload.appSubscription?.id,
  };
}

export async function getActiveSubscription(session) {
  const client = new shopify.clients.Graphql({ session });
  const { data } = await client.request(ACTIVE);
  const list = data?.currentAppInstallation?.activeSubscriptions || [];
  return list.find((s) => s.status === "ACTIVE") || null;
}
