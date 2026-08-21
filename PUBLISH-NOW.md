# ListingAI — انشر دابا (Shopify App Store)

## الحالة
الكود جاهز. النشر العمومي كيحتاج **جوج حسابات**:
1) Hosting ثابت (Render مجاني)
2) Submit من Shopify Partner

---

## الخطوة 1 — Deploy على Render (5 دقائق)

1. دخل: https://dashboard.render.com → Sign up (GitHub)
2. **New** → **Blueprint** أو **Web Service**
3. Connect repo / أو **Deploy existing folder**:
   - Root: `listingai-shopify`
   - Build: `npm ci --omit=dev`
   - Start: `node src/server.js`
4. Environment variables (من `.env` ديالك):

```
SHOPIFY_API_KEY=385de99759c069da23b4f62b57eebc78
SHOPIFY_API_SECRET=(من Settings → Reveal)
SHOPIFY_APP_URL=https://XXXX.onrender.com
SESSION_SECRET=(أي نص طويل عشوائي)
OPENROUTER_API_KEY=(نفس Super AI)
OPENROUTER_MODEL=deepseek/deepseek-chat
LISTINGAI_PRICE_USD=9
LISTINGAI_FREE_LISTINGS=15
LISTINGAI_PLAN_NAME=ListingAI Pro
SHOPIFY_BILLING_TEST=false
SHOPIFY_API_SCOPES=read_products,write_products
PORT=3000
```

5. بعد Deploy، افتح: `https://XXXX.onrender.com/health` → لازم `{"ok":true}`

---

## الخطوة 2 — حدّث App URLs فـ Shopify

Partners → Apps → **YAMSHI** → **Create version**:

- **App URL:** `https://XXXX.onrender.com`
- **Redirect URLs:** `https://XXXX.onrender.com/auth/callback`
- **Scopes:** `read_products,write_products`
- **Legacy install flow:** ✅ ON
- كليك **Release**

Privacy / Support (فـ listing):
- `https://XXXX.onrender.com/privacy`
- `https://XXXX.onrender.com/support`

---

## الخطوة 3 — Distribution (App Store)

1. Partners → **App distribution** (أو Dev Dashboard → YAMSHI → Distribution)
2. اختار **Shopify App Store**
3. عبّي listing من `APP_STORE.md`:
   - Name: **ListingAI**
   - Category: Content / Marketing
   - Pricing: Free + $9/mo
4. رفع **3 screenshots** من Admin (Generate / Variations / Product)
5. **Submit for review**

Shopify غادي تراجع (عادة 3–7 أيام).

---

## الخطوة 4 — بعد الموافقة

- الإعلان Facebook: *"$9/mo AI Shopify listings. 15 free."*
- الرابط: `https://apps.shopify.com/listingai` (من بعد الموافقة)

---

## شنو ما نقدروش نديرو من هنا بلا حسابك

| | |
|---|---|
| Render signup + Deploy | خاصك أنت تسجل |
| Shopify Submit for review | خاصك أنت تدوس Submit |
| Screenshots حقيقية من المتجر | خاصك تصوّر |

صوّر لي رابط Render منين يخدم، نكمّلو URLs فـ Partner معاك خطوة بخطوة.
