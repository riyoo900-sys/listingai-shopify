# ListingAI — Launch checklist

## Phase 1 — Dev (today)

- [ ] Shopify Partner account  
- [ ] Dev store (free from Partner)  
- [ ] Create app → copy API key + secret  
- [ ] OpenRouter key → `.env`  
- [ ] `npm install` + `npm run dev`  
- [ ] ngrok → `SHOPIFY_APP_URL`  
- [ ] Install: `/auth?shop=STORE.myshopify.com`  
- [ ] Test: generate listing + publish product  

## Phase 2 — App Store prep (week 2)

- [ ] App name: **ListingAI**  
- [ ] Icon 1200×1200  
- [ ] 3 screenshots (generate screen, preview, published product)  
- [ ] Privacy policy URL (yamshi.app/privacy or listingai page)  
- [ ] Support email  
- [ ] Register GDPR webhooks in Partner dashboard:
  - `customers/data_request` → `POST /webhooks/customers/data_request`
  - `customers/redact` → `POST /webhooks/customers/redact`
  - `shop/redact` → `POST /webhooks/shop/redact`
  - `app/uninstalled` → `POST /webhooks/app/uninstalled`
- [ ] Set `SHOPIFY_BILLING_TEST=false` for production  
- [ ] Deploy server (Railway / Fly.io / VPS) with HTTPS  

## Phase 3 — Pricing (live)

| | |
|---|---|
| Free trial | 10 listings |
| Pro | **$19/month** |
| Shopify trial | 7 days (billing API) |

## Phase 4 — Facebook ads (week 3)

**Audience:** US, Shopify store owners, dropshipping interests  

**Primary text:**
> Stop writing product descriptions manually. ListingAI turns any product idea into a full Shopify listing in 60 seconds — title, SEO, tags, HTML. **10 listings free.** Then $19/mo unlimited.

**Headline:** AI Shopify Listings — 10 Free  

**CTA:** Install app → Shopify App Store listing URL  

**Budget:** Start $15/day  

**KPI:** Cost per install < $5 = good  

## Phase 5 — After 10 paying merchants

- [ ] Add bulk import (CSV / AliExpress URL)  
- [ ] Add image → listing (vision)  
- [ ] Raise price to $29 or add $39 Pro tier  

## Support

Merchants email → fix within 24h. Most issues: OpenRouter key, billing on dev store.
