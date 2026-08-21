# How we make money (honest)

Nothing guarantees revenue. This stack maximizes odds:

1. **Product** — ListingAI SEO ($7.99) undercuts $12–15 competitors with catalog rewrite + SEO/AEO.
2. **Host** — Render live: https://listingai-shopify.onrender.com
3. **Billing** — Shopify recurring charge (7-day trial). Set `SHOPIFY_BILLING_TEST=false` in production.
4. **Distribution** — Public App Store listing (see APP_STORE.md).
5. **Traffic** — Ads + reviews after approval. App Store alone is slow.

## Your checklist
- [ ] Render env: `LISTINGAI_PRICE_USD=7.99` and `LISTINGAI_FREE_LISTINGS=25`
- [ ] Manual Deploy latest commit (v3)
- [ ] Re-open app / re-auth if needed
- [ ] Screenshots → Partners → Public distribution → Submit
- [ ] Launch ad with App Store URL after approval

Net ≈ $7–8 per Pro subscriber after Shopify fees.
