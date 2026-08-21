#!/usr/bin/env node
import { loadTelegramConfig } from "../ads_manager/yamshi-company-site/leads/lib/load-env.mjs";

const { token, chatId } = loadTelegramConfig();
if (!token || !chatId) {
  console.error("Telegram env missing");
  process.exit(1);
}

const text = `🚀 ListingAI — جاهزين للنشر فـ App Store

✅ الكود v2 جاهز ($9/mo · 15 free · 3 variations · image · bulk)
✅ Privacy + Support pages
✅ Dockerfile + render.yaml + PUBLISH-NOW.md

❌ مازال ما منشور فـ apps.shopify.com

باش ننشرو دابا (خاص حسابك):

1️⃣ Render (مجاني)
→ https://dashboard.render.com
→ New Web Service
→ المجلد listingai-shopify
→ Start: node src/server.js
→ زيد env من .env
→ تنتظر: https://XXXX.onrender.com/health = ok

2️⃣ Shopify Partner → YAMSHI → Create version
→ App URL = رابط Render
→ Redirect = .../auth/callback
→ Release

3️⃣ App distribution → Shopify App Store
→ عبّي listing من APP_STORE.md
→ 3 screenshots
→ Submit for review (3–7 أيام)

📂 c:\\ABDELLATIF\\progy_app\\listingai-shopify\\PUBLISH-NOW.md

صوّر لي رابط Render منين يخدم، نكمّلو معاك.`;

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
