export const FREE_LIMIT = Number(process.env.LISTINGAI_FREE_LISTINGS || 25);

export const PLANS = {
  starter: {
    id: "starter",
    name: process.env.LISTINGAI_STARTER_PLAN_NAME || "ListingAI SEO Starter",
    price: Number(process.env.LISTINGAI_STARTER_PRICE_USD || 4.99),
    limit: Number(process.env.LISTINGAI_STARTER_LISTINGS || 50),
    monthly: true,
    trial_days: 7,
  },
  pro: {
    id: "pro",
    name: process.env.LISTINGAI_PLAN_NAME || "ListingAI SEO Pro",
    price: Number(process.env.LISTINGAI_PRICE_USD || 7.99),
    limit: null,
    monthly: false,
    trial_days: 7,
  },
};

export function resolvePlanId(raw) {
  const id = String(raw || "").toLowerCase();
  return id === "starter" ? "starter" : "pro";
}

export function planFromChargePrice(price) {
  const p = Number(price);
  if (Math.abs(p - PLANS.starter.price) < 0.01) return "starter";
  if (Math.abs(p - PLANS.pro.price) < 0.01) return "pro";
  if (p >= PLANS.pro.price - 0.01) return "pro";
  if (p >= PLANS.starter.price - 0.01) return "starter";
  return "pro";
}

export function plansForClient() {
  return {
    starter: {
      price: PLANS.starter.price,
      limit: PLANS.starter.limit,
      name: PLANS.starter.name,
    },
    pro: {
      price: PLANS.pro.price,
      limit: null,
      name: PLANS.pro.name,
    },
  };
}
