# ListingAI — Shopify App Store submission pack

## App identity
- **Name:** ListingAI (Partner app: YAMSHI)
- **Tagline:** Product → Shopify listing in 60 seconds
- **Category:** Content / SEO
- **Price:** Free (15 listings) → **$9/month** Pro unlimited · 7-day trial

## App Store listing copy (EN)

### Short description
Generate SEO-ready Shopify product titles, descriptions, tags, FAQs and image alt text with AI. 3 variations per run. Publish in one click. From $9/mo.

### Full description
ListingAI helps Shopify merchants create high-converting product listings in seconds.

**What you get**
- 3 AI variations per product (pick the best)
- SEO title + meta description + tags
- FAQ block + image alt text
- Optional image URL (AI reads it + attaches on publish)
- Tone: Professional / Casual / Luxury / Urgent
- Languages: English, Spanish, French, German
- Bulk mode (up to 20 products)
- One-click publish to Shopify

**Pricing**
- Free: 15 AI listings
- Pro: $9/month unlimited · 7-day trial

Built for dropshippers and catalogs that need speed without hiring a copywriter.

### Keywords
ai product description, shopify listing, seo product copy, bulk descriptions, chatgpt shopify, product title generator

## Required URLs (after production host)
- App URL: `https://YOUR_DOMAIN`
- Redirect: `https://YOUR_DOMAIN/auth/callback`
- Privacy: `https://YOUR_DOMAIN/privacy`
- Support: `https://YOUR_DOMAIN/support`

## Screenshots to capture (3+)
1. Generate form with tone/language/image URL
2. 3 variation tabs + preview
3. Published product in Shopify admin

## Review notes for Shopify
- Scopes: `read_products,write_products`
- GDPR webhooks implemented
- Embedded admin app
- Test store: listingai-dev.myshopify.com

## Status
- [x] App built (v2)
- [x] Privacy + Support pages
- [x] Billing $9/mo
- [x] Docker + Render blueprint (`render.yaml`, `Dockerfile`)
- [x] Publish guide (`PUBLISH-NOW.md`)
- [ ] Stable production host URL (user creates Render)
- [ ] Screenshots uploaded
- [ ] Submit for Shopify review (Partner dashboard → Distribution)

## Honest note
Shopify App Store review takes **days** and needs a **fixed HTTPS domain**. Cloudflare quick tunnels are for local testing only.
