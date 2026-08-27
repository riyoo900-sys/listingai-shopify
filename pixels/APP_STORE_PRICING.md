# Pricing to paste in Shopify Partners (must match the app)

Use **exactly** this in the App Store listing. Mismatch = rejection.

- **Free trial:** 15 days  
- **Monthly:** $4.99 USD / month  
- **Yearly:** $45 USD / year  
- **Billing:** Shopify Billing API only (no Stripe/PayPal)  
- **What they get:** Unlimited Meta pixels + browser pixel + Conversion API  

Listing text (English):

> 15-day free trial. Then $4.99/month or $45/year. Unlimited Meta pixels. Adding a pixel never replaces existing ones. Browser events + Conversion API. Cancel anytime in Shopify.

Development stores: keep `SHOPIFY_BILLING_TEST=true`.  
Live App Store: set `SHOPIFY_BILLING_TEST=false` on the host.
