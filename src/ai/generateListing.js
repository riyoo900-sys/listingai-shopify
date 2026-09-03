const SYSTEM = "You are a senior Shopify merchandiser, SEO specialist, and product photographer copywriter.\nYour job: analyze the product (especially the photo) and produce THREE premium, publish-ready listing variations optimized for SEO and conversion.\n\nRules:\n- Write like a top US brand store ? clear, trustworthy, no spam, no ALL CAPS hype, no fake claims.\n- Base every detail on the product name, price, and what you SEE in the photo. Never invent materials or features not visible or implied.\n- If the photo shows one item, describe that item. If it shows multiple similar items (colors/shapes), detect them as variants.\n- SEO title ? 60 chars, meta description ? 155 chars, product title ? 70 chars, keyword-rich but natural.\n- Description HTML: 2 short intro paragraphs + <ul> with 4-6 benefit bullets + optional specs line. Clean HTML only.\n- FAQ: 2-3 Q&A blocks for Google and AI search (AEO).\n- Tags: 8-12 relevant comma-ready strings ? prioritize searchable product tags for Shopify navigation and SEO.\n- Image alt texts: professional, descriptive, SEO-friendly (125 chars max each).\n- Tailor tone, keywords, and benefits to the merchant's store category when provided.\n- When merchant category is provided, product_type MUST match it exactly.\n\nGenerate exactly 3 listing variations with different SEO angles:\n1) benefit-led ? outcomes and customer value first\n2) feature-led ? specs, materials, and tangible attributes first\n3) keyword-led ? search-intent phrasing and high-intent keywords first\nEach variation MUST include seo_score (0-100 integer) reflecting SEO quality (title/meta length, tags, keyword use, FAQ).\n\nReturn ONLY valid JSON (no markdown):\n{\n  \"analysis\": {\n    \"summary\": \"1-2 sentences: what this product is\",\n    \"visible_details\": [\"color\", \"material\", \"shape\", \"style notes from photo\"],\n    \"category\": \"Shopify product_type suggestion\"\n  },\n  \"options\": {\n    \"sizes\": [\"only if apparel/footwear and multiple sizes make sense ? else []\"],\n    \"colors\": [\"only colors visible or clearly offered ? dedupe, else []\"],\n    \"styles\": [\"only if multiple similar shapes/types in photo ? else []\"]\n  },\n  \"variations\": [\n    {\n      \"style\": \"benefit-led\",\n      \"seo_score\": 85,\n      \"title\": \"customer-facing product title\",\n      \"description_html\": \"full HTML description\",\n      \"tags\": [\"tag1\",\"tag2\"],\n      \"seo_title\": \"SEO title\",\n      \"seo_description\": \"meta description with CTA\",\n      \"faq_html\": \"<h3>Question?</h3><p>Answer.</p>\",\n      \"product_type\": \"category\",\n      \"vendor\": \"brand name suggestion or Generic\",\n      \"image_alt\": \"main image alt\"\n    },\n    { \"style\": \"feature-led\", \"seo_score\": 80, \"title\": \"...\", \"description_html\": \"...\", \"tags\": [], \"seo_title\": \"...\", \"seo_description\": \"...\", \"faq_html\": \"...\", \"product_type\": \"...\", \"vendor\": \"...\", \"image_alt\": \"...\" },\n    { \"style\": \"keyword-led\", \"seo_score\": 90, \"title\": \"...\", \"description_html\": \"...\", \"tags\": [], \"seo_title\": \"...\", \"seo_description\": \"...\", \"faq_html\": \"...\", \"product_type\": \"...\", \"vendor\": \"...\", \"image_alt\": \"...\" }\n  ],\n  \"images\": [\n    { \"alt\": \"main image alt\", \"caption\": \"short caption for gallery\" }\n  ]\n}\n\nOptions rules:\n- Put sizes ONLY when product category typically has sizes AND merchant likely sells multiple (S,M,L,XL etc).\n- Put colors ONLY when multiple distinct colors are visible OR product type clearly comes in colors.\n- Put styles for shape/type variants (e.g. round vs square, classic vs sport) when photo shows similar variants.\n- If only one color/size/style exists, return empty arrays [] ? do NOT fake options.\n- Maximum 8 values per option array.";

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
          temperature: 0.35,
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
            temperature: 0.35,
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


const STYLE_LABELS = {
  "benefit-led": "Benefit-led",
  "feature-led": "Feature-led",
  "keyword-led": "Keyword-led",
};

function scoreListing(listing) {
  let score = Number(listing?.seo_score);
  if (Number.isFinite(score) && score >= 0) return Math.min(100, Math.round(score));
  score = 40;
  const title = String(listing?.title || "");
  const seoTitle = String(listing?.seo_title || listing?.metafields_global_title_tag || "");
  const seoDesc = String(listing?.seo_description || listing?.metafields_global_description_tag || "");
  const tags = Array.isArray(listing?.tags)
    ? listing.tags
    : String(listing?.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const faq = String(listing?.faq_html || "");
  if (title.length >= 20 && title.length <= 70) score += 12;
  if (seoTitle.length >= 20 && seoTitle.length <= 60) score += 14;
  if (seoDesc.length >= 80 && seoDesc.length <= 155) score += 14;
  if (tags.length >= 8) score += 12;
  else if (tags.length >= 5) score += 6;
  if (faq.includes("<h3") || faq.includes("<H3")) score += 8;
  if (String(listing?.description_html || listing?.body_html || "").length > 200) score += 8;
  return Math.min(100, score);
}

function normalizeListing(raw, fallbackName, merchantCategory, analysis, imagesFallback) {
  const listing = raw || {};
  const title = String(listing.title || fallbackName).slice(0, 255);
  const bodyHtml = String(listing.description_html || listing.body_html || "");
  const faqHtml = String(listing.faq_html || "");
  const tags = Array.isArray(listing.tags)
    ? listing.tags.map(String).slice(0, 12).join(", ")
    : String(listing.tags || "");
  const style = String(listing.style || "benefit-led");
  const seo_score = scoreListing(listing);
  const image_alt = String(listing.image_alt || imagesFallback?.[0]?.alt || title).slice(0, 125);
  return {
    style,
    style_label: STYLE_LABELS[style] || style,
    seo_score,
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
    image_alt,
    product_type: String(
      merchantCategory || listing.product_type || analysis?.category || ""
    ).slice(0, 100),
    vendor: String(listing.vendor || "Souso").slice(0, 100),
  };
}

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

  let rawVars = Array.isArray(parsed.variations) ? parsed.variations.slice(0, 3) : [];
  if (!rawVars.length && (parsed.listing || parsed.title)) {
    rawVars = [parsed.listing || parsed];
  }
  while (rawVars.length < 3) {
    const base = rawVars[rawVars.length - 1] || parsed.listing || parsed;
    const styles = ["benefit-led", "feature-led", "keyword-led"];
    rawVars.push({ ...base, style: styles[rawVars.length] || "benefit-led" });
  }

  const variations = rawVars
    .map((v) => normalizeListing(v, fallbackName, merchantCategory, analysis, images))
    .sort((a, b) => (b.seo_score || 0) - (a.seo_score || 0));

  if (variations[0]) variations[0].best_for_seo = true;
  variations.forEach((v, i) => {
    v.label = i === 0 ? "Best for SEO" : (v.style_label || ("Version " + (i + 1)));
  });

  const listing = { ...variations[0] };
  if (images[0] && listing.image_alt) images[0].alt = listing.image_alt;

  return {
    analysis: {
      summary: String(analysis.summary || "").slice(0, 500),
      visible_details: dedupeList(analysis.visible_details),
      category: String(analysis.category || listing.product_type || ""),
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
