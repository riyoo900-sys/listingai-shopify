#!/usr/bin/env node
import { loadTelegramConfig } from "../ads_manager/yamshi-company-site/leads/lib/load-env.mjs";

const { token, chatId } = loadTelegramConfig();
if (!token || !chatId) {
  console.error("Telegram env missing");
  process.exit(1);
}

const text = `✅ ListingAI v2 — شنو درنا

📦 App: YAMSHI / ListingAI
🛍 Dev store: listingai-dev.myshopify.com
💰 الثمن الجديد: 15 listings مجاناً → $9/شهر (كان $19)

🆕 الميزات الجديدة:
• 3 variations لكل منتج (تختار الأفضل)
• Tone: Professional / Casual / Luxury / Urgent
• Languages: EN / ES / FR / DE
• Image URL → AI يقراها + كتتعلق فالمنتج عند Publish
• FAQ + SEO title/description + image alt
• Bulk mode (حتى 20 سطر)

📄 App Store pack:
• privacy + support pages
• APP_STORE.md (copy + checklist)

⚠️ النشر فـ App Store:
ما يقدرش يتكمّل 100% أوتوماتيك — Shopify خاصها:
1) سيرفر ثابت (Railway/Fly) ماشي tunnel
2) Screenshots
3) Submit for review من Partner dashboard (كيأخذ أيام)

📂 المجلد:
c:\\ABDELLATIF\\progy_app\\listingai-shopify

جرّب دابا: Admin → Apps → YAMSHI → Generate 3 listings`;

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text }),
});
const j = await res.json();
if (!j.ok) {
  console.error(j);
  process.exit(1);
}
console.log("TELEGRAM_OK");
