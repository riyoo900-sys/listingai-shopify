# ListingAI — Shopify App (Accio-style)

AI product listings for Shopify stores. **$19/mo** · **10 free listings** · 7-day trial.

## What it does

1. Merchant pastes product idea / URL / title  
2. AI generates title, HTML description, tags, SEO meta  
3. One click → publish to Shopify  
4. After 10 free listings → **$19/mo** subscription (Shopify Billing)

## Project structure

```
listingai-shopify/
  src/server.js          # Express + OAuth + API + billing
  src/shopify.js         # Shopify API helpers
  src/db.js              # JSON store (shops, usage)
  src/ai/generateListing.js
  web/                   # Embedded admin UI
  data/                  # shops.json (auto-created)
  LAUNCH.md              # Step-by-step App Store checklist
```

## Quick start (dev)

### 1) Shopify Partner

1. https://partners.shopify.com → **Apps** → **Create app**  
2. Name: **ListingAI**  
3. Copy **Client ID** + **Client secret**

### 2) Env

```powershell
cd c:\ABDELLATIF\progy_app\listingai-shopify
copy .env.example .env
# Edit .env — fill SHOPIFY_API_KEY, SHOPIFY_API_SECRET, OPENROUTER_API_KEY
```

### 3) Tunnel (ngrok or Cloudflare)

```powershell
ngrok http 3000
# Set SHOPIFY_APP_URL=https://YOUR.ngrok-free.app in .env
```

Update `shopify.app.toml` with same URL + client_id.

### 4) Run

```powershell
npm install
npm run dev
```

### 5) Install on dev store

Open in browser:

```
https://YOUR.ngrok-free.app/auth?shop=YOUR-STORE.myshopify.com
```

## Pricing (default)

| Plan | Price | Listings |
|------|-------|----------|
| Free | $0 | 10 |
| Pro | $19/mo | Unlimited |

Edit in `.env`: `LISTINGAI_PRICE_USD`, `LISTINGAI_FREE_LISTINGS`

## Facebook ad copy (US)

> Product link → Shopify listing in 60 sec. SEO ready. **10 free.**

## Next steps

See **LAUNCH.md** for App Store listing, webhooks, and production deploy.
