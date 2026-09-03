const SYSTEM = `You are a senior Shopify merchandiser, SEO specialist, and product photographer copywriter.
Your job: analyze the product (especially the photo) and produce THREE distinct, publish-ready listing variations.

Rules:
- Write like a top US brand store — clear, trustworthy, no spam, no ALL CAPS hype, no fake claims.
- Base every detail on the product name, price, and what you SEE in the photo. Never invent materials or features not visible or implied.
- If the photo shows one item, describe that item. If it shows multiple similar items (colors/shapes), detect them as variants.
- SEO title ≤ 70 chars, meta description ≤ 160 chars, product title ≤ 200 chars, keyword-rich but natural.
- Description HTML: 2 short intro paragraphs + <ul> with 4-6 benefit bullets. Clean HTML only.
- FAQ: 2-3 Q&A blocks for Google and AI search (AEO).
- Tags: 8-12 relevant strings per variation (different keyword angles per variation).
- Image alt: professional, descriptive, SEO-friendly (125 chars max).
- Tailor tone to merchant store category when provided.

THREE variations (all different angles):
1. benefit-led — emotional outcomes, lifestyle (highest seo_score 92-98)
2. feature-led — specs, materials, technical details (seo_score 88-94)
3. keyword-led — search-intent keywords in title + tags (seo_score 85-92)

Return ONLY valid JSON (no markdown):
{
  "analysis": {
    "summary": "1-2 sentences: what this product is",
    "visible_details": ["color", "material", "shape"],
    "category": "Shopify product_type suggestion"
  },
  "options": {
    "sizes": [],
    "colors": [],
    "styles": []
  },
  "variations": [
    {
      "style": "benefit-led",
      "style_label": "Best for SEO",
      "seo_score": 96,
      "title": "customer-facing product title",
      "description_html": "full HTML description",
      "tags": ["tag1","tag2"],
      "seo_title": "SEO title",
      "seo_description": "meta description with CTA",
      "faq_html": "<h3>Question?</h3><p>Answer.</p>",
      "product_type": "category",
      "vendor": "brand or Generic",
      "image_alt": "alt text"
    }
  ],
  "images": [{ "alt": "main image alt", "caption": "caption" }]
}

Options rules:
- sizes/colors/styles ONLY when clearly applicable — else empty arrays [].
- Maximum 8 values per option array.
- Exactly 3 variations in the variations array.`;

/**
 * @param {{
 *   productName: string,
 *   price?: string,
 *   language?: string,
 *   imageUrl?: string,
 *   imageBase64?: string,
 *   existingHint?: string,
 *   category?: string,
 *   collectionTitle?: string,
 * }} input
 */
export async function generateListing(input) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing in .env");

  const name = String(input.productName || input.productHint || "").trim();
  if (!name) throw new Error("Product name is required");

  const imageUrl = resolveImageUrl(input);
  const hasImage = Boolean(imageUrl);
  const language = input.language || "English";
  const price = input.price ? String(input.price).replace(/[^\d.]/g, "") : "";

  const models = [
    process.env.OPENROUTER_MODEL?.trim(),
    hasImage ? "google/gemini-2.0-flash-001" : "",
    hasImage ? "openai/gpt-4o-mini" : "",
    "deepseek/deepseek-chat",
    "google/gemini-flash-1.5",
  ].filter(Boolean);

  const userText = [
    `Language: ${language}.`,
    `Product name: ${name}`,
    price ? `Price: $${price} USD` : "",
    input.category ? `Merchant store category (use exactly as product_type): ${input.category}` : "",
    input.collectionTitle
      ? `Store collection / section: ${input.collectionTitle} — mention fit for this collection naturally.`
      : "",
    input.existingHint ? `Existing store context:\n${input.existingHint}` : "",
    hasImage
      ? "Analyze the attached product photo carefully. Describe only what you see. Detect colors, sizes, or style variants if applicable."
      : "No photo provided — write based on the product name and category norms. Do not invent specific visual details.",
    "Return exactly 3 listing variations with different SEO angles, tags, and seo_score.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userText },
  ];

  if (hasImage) {
    messages[1] = {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    };
  }

  let lastErr = "";
  let raw = "";
  let triedWithoutImage = false;
  for (const model of [...new Set(models)]) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://listingai.yamshi.app",
          "X-Title": "ListingAI SEO",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 5500,
          temperature: 0.4,
          response_format: { type: "json_object" },
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = `OpenRouter ${res.status}: ${text.slice(0, 200)}`;
        if (hasImage && !triedWithoutImage && messages[1]?.content?.length > 1) {
          messages[1] = { role: "user", content: userText };
          triedWithoutImage = true;
        }
        continue;
      }
      const data = JSON.parse(text);
      raw = String(data.choices?.[0]?.message?.content || "").trim();
      if (raw) break;
      lastErr = "Empty OpenRouter response";
    } catch (e) {
      lastErr = e.message;
    }
  }
  if (!raw && hasImage && !triedWithoutImage) {
    messages[1] = { role: "user", content: userText };
    for (const model of ["deepseek/deepseek-chat", "google/gemini-flash-1.5"]) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://listingai.yamshi.app",
            "X-Title": "ListingAI SEO",
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: 5500,
            temperature: 0.4,
            response_format: { type: "json_object" },
          }),
        });
        const text = await res.text();
        if (!res.ok) continue;
        const data = JSON.parse(text);
        raw = String(data.choices?.[0]?.message?.content || "").trim();
        if (raw) break;
      } catch {
        /* retry */
      }
    }
  }
  if (!raw) throw new Error(lastErr || "AI generation failed");

  const jsonText = raw.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(jsonText);

  return normalizeResult(parsed, name, input.category);
}

function resolveImageUrl(input) {
  const b64 = String(input.imageBase64 || "").trim();
  if (b64.startsWith("data:image")) return b64;
  if (b64 && !b64.startsWith("http")) {
    return `data:image/jpeg;base64,${b64.replace(/^data:image\/\w+;base64,/, "")}`;
  }
  const url = String(input.imageUrl || "").trim();
  return url.startsWith("http") ? url : "";
}

function dedupeList(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const v = String(item || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 8);
}

function normalizeListing(listing, fallbackName, merchantCategory, images) {
  const title = String(listing.title || fallbackName).slice(0, 255);
  const bodyHtml = String(listing.description_html || listing.body_html || "");
  const faqHtml = String(listing.faq_html || "");
  const tags = Array.isArray(listing.tags)
    ? listing.tags.map(String).slice(0, 15).join(", ")
    : String(listing.tags || "");
  const mainAlt = String(listing.image_alt || images?.[0]?.alt || title).slice(0, 125);
  return {
    title,
    body_html: bodyHtml,
    tags,
    metafields_global_title_tag: String(
      listing.seo_title || listing.metafields_global_title_tag || title
    ).slice(0, 70),
    metafields_global_description_tag: String(
      listing.seo_description || listing.metafields_global_description_tag || ""
    ).slice(0, 160),
    faq_html: faqHtml,
    image_alt: mainAlt,
    product_type: String(merchantCategory || listing.product_type || "").slice(0, 100),
    vendor: String(listing.vendor || "Generic").slice(0, 100),
  };
}

function scoreListing(listing, index) {
  const ai = Number(listing.seo_score);
  if (ai >= 70 && ai <= 100) return Math.round(ai);
  let score = 72;
  const title = listing.title || "";
  const seoTitle = listing.metafields_global_title_tag || title;
  const seoDesc = listing.metafields_global_description_tag || "";
  const tagCount = (listing.tags || "").split(",").filter(Boolean).length;
  if (title.length >= 30 && title.length <= 120) score += 8;
  if (seoTitle.length >= 40 && seoTitle.length <= 70) score += 10;
  if (seoDesc.length >= 120 && seoDesc.length <= 160) score += 8;
  if (tagCount >= 6) score += 6;
  if (listing.body_html?.includes("<ul>")) score += 4;
  return Math.min(98, score - index * 2);
}

const STYLE_LABELS = {
  "benefit-led": "Best for SEO",
  "feature-led": "Feature-focused",
  "keyword-led": "Keyword-rich",
};

function normalizeResult(parsed, fallbackName, merchantCategory) {
  const analysis = parsed.analysis || {};
  const options = {
    sizes: dedupeList(parsed.options?.sizes),
    colors: dedupeList(parsed.options?.colors),
    styles: dedupeList(parsed.options?.styles),
  };
  const images = Array.isArray(parsed.images)
    ? parsed.images.map((img, i) => ({
        alt: String(img.alt || fallbackName).slice(0, 125),
        caption: String(img.caption || "").slice(0, 200),
        role: img.role || (i === 0 ? "main" : "gallery"),
      }))
    : [{ alt: String(fallbackName).slice(0, 125), caption: "", role: "main" }];

  const rawVariations = Array.isArray(parsed.variations)
    ? parsed.variations
    : parsed.listing
      ? [parsed.listing]
      : [parsed];

  const variations = rawVariations.slice(0, 3).map((v, i) => {
    const normalized = normalizeListing(v, fallbackName, merchantCategory, images);
    const style = String(v.style || Object.keys(STYLE_LABELS)[i] || "balanced");
    return {
      ...normalized,
      seo_score: scoreListing({ ...normalized, seo_score: v.seo_score }, i),
      style,
      style_label: String(v.style_label || STYLE_LABELS[style] || `Version ${i + 1}`),
    };
  });

  while (variations.length < 3 && variations.length > 0) {
    const base = variations[variations.length - 1];
    variations.push({
      ...base,
      seo_score: Math.max(80, (base.seo_score || 90) - 4),
      style_label: `Version ${variations.length + 1}`,
    });
  }

  variations.sort((a, b) => (b.seo_score || 0) - (a.seo_score || 0));
  if (variations[0]) variations[0].style_label = "Best for SEO";

  const listing = variations[0];
  return {
    analysis: {
      summary: String(analysis.summary || "").slice(0, 500),
      visible_details: dedupeList(analysis.visible_details),
      category: String(analysis.category || listing?.product_type || ""),
    },
    options,
    listing,
    images,
    variations,
  };
}

export function buildShopifyVariants(options, price) {
  const p = String(price || "19.99");
  const sizes = dedupeList(options?.sizes);
  const colors = dedupeList(options?.colors);
  const styles = dedupeList(options?.styles);

  const productOptions = [];
  const axes = [];

  if (sizes.length > 1) {
    productOptions.push({ name: "Size", values: sizes });
    axes.push(sizes);
  }
  if (colors.length > 1) {
    productOptions.push({ name: "Color", values: colors });
    axes.push(colors);
  }
  if (!sizes.length && !colors.length && styles.length > 1) {
    productOptions.push({ name: "Style", values: styles });
    axes.push(styles);
  }

  if (!axes.length) {
    return {
      options: [],
      variants: [{ price: p, inventory_management: null }],
    };
  }

  let combos = [[]];
  for (const axis of axes) {
    const next = [];
    for (const combo of combos) {
      for (const val of axis) next.push([...combo, val]);
    }
    combos = next.slice(0, 100);
  }

  const variants = combos.map((combo) => {
    const v = { price: p, inventory_management: null };
    if (combo[0]) v.option1 = combo[0];
    if (combo[1]) v.option2 = combo[1];
    if (combo[2]) v.option3 = combo[2];
    return v;
  });

  return { options: productOptions, variants };
}
