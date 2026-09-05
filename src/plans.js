/**
 * Freemium: merchants convert + we stay profitable.
 *
 * AI cost ≈ $0.01 / listing (Gemini Flash via OpenRouter).
 * Free 5/mo     → max ~$0.05/shop (tight hook, low bleed)
 * Starter $4.99 / 50 → cost ~$0.50 → ~$4.50 margin
 * Pro $9.99 unlimited → under Descriva $14.99+; heavy users upgrade
 */
export const FREE_LIMIT = Number(process.env.LISTINGAI_FREE_LISTINGS || 5);
export const TRIAL_DAYS = Number(process.env.LISTINGAI_TRIAL_DAYS || 15);

/** Permanent free plan — resets every calendar month. */
export const FREE_PLAN = {
  id: "free",
  name: "ListingAI SEO Free",
  price: 0,
  limit: FREE_LIMIT,
  monthly: true,
};

export const PLANS = {
  starter: {
    id: "starter",
    name: process.env.LISTINGAI_STARTER_PLAN_NAME || "ListingAI SEO Starter",
    price: Number(process.env.LISTINGAI_STARTER_PRICE_USD || 4.99),
    limit: Number(process.env.LISTINGAI_STARTER_LISTINGS || 50),
    monthly: true,
    trial_days: TRIAL_DAYS,
  },
  pro: {
    id: "pro",
    name: process.env.LISTINGAI_PLAN_NAME || "ListingAI SEO Pro",
    price: Number(process.env.LISTINGAI_PRICE_USD || 9.99),
    limit: null,
    monthly: false,
    trial_days: TRIAL_DAYS,
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
  // Legacy charges from older prices
  if (Math.abs(p - 7.99) < 0.01 || Math.abs(p - 9) < 0.01) return "pro";
  if (p >= PLANS.pro.price - 0.01) return "pro";
  if (p >= PLANS.starter.price - 0.01) return "starter";
  return "pro";
}

export function plansForClient() {
  return {
    free: {
      price: 0,
      limit: FREE_PLAN.limit,
      name: FREE_PLAN.name,
      monthly: true,
    },
    starter: {
      price: PLANS.starter.price,
      limit: PLANS.starter.limit,
      name: PLANS.starter.name,
      trial_days: PLANS.starter.trial_days,
    },
    pro: {
      price: PLANS.pro.price,
      limit: null,
      name: PLANS.pro.name,
      trial_days: PLANS.pro.trial_days,
    },
    trial_days: TRIAL_DAYS,
    free_limit: FREE_LIMIT,
  };
}
