const SYSTEM = `You are a senior Shopify merchandiser, SEO specialist, and product photographer copywriter.
Your job: analyze the product (especially the photo) and produce ONE premium, publish-ready listing.

Rules:
- Write like a top US brand store — clear, trustworthy, no spam, no ALL CAPS hype, no fake claims.
- Base every detail on the product name, price, and what you SEE in the photo. Never invent materials or features not visible or implied.
- If the photo shows one item, describe that item. If it shows multiple similar items (colors/shapes), detect them as variants.
- SEO title ≤ 60 chars, meta description ≤ 155 chars, product title ≤ 70 chars, keyword-rich but natural.
- Description HTML: 2 short intro paragraphs + <ul> with 4-6 benefit bullets + optional specs line. Clean HTML only.
- FAQ: 2-3 Q&A blocks for Google and AI search (AEO).
- Tags: 8-12 relevant comma-ready strings.
- Image alt texts: professional, descriptive, SEO-friendly (125 chars max each).
- Tailor tone, keywords, and benefits to the merchant's store category when provided.
- When merchant category is provided, product_type MUST match it exactly.

Return ONLY valid JSON (no markdown):
{
  "analysis": {
    "summary": "1-2 sentences: what this product is",
    "visible_details": ["color", "material", "shape", "style notes from photo"],
    "category": "Shopify product_type suggestion"
  },
  "options": {
    "sizes": ["only if apparel/footwear and multiple sizes make sense — else []"],
    "colors": ["only colors visible or clearly offered — dedupe, else []"],
    "styles": ["only if multiple similar shapes/types in photo — else []"]
  },
  "listing": {
    "title": "customer-facing product title",
    "description_html": "full HTML description",
    "tags": ["tag1","tag2"],
    "seo_title": "SEO title",
    "seo_description": "meta description with CTA",
    "faq_html": "<h3>Question?</h3><p>Answer.</p>",
    "product_type": "category",
    "vendor": "brand name suggestion or Generic"
  },
  "images": [
    { "alt": "main image alt", "caption": "short caption for gallery" }
  ]
}

Options rules:
- Put sizes ONLY when product category typically has sizes AND merchant likely sells multiple (S,M,L,XL etc).
- Put colors ONLY when multiple distinct colors are visible OR product type clearly comes in colors.
- Put styles for shape/type variants (e.g. round vs square, classic vs sport) when photo shows similar variants.
- If only one color/size/style exists, return empty arrays [] — do NOT fake options.
- Maximum 8 values per option array.`;

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
          max_tokens: 3500,
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
            max_tokens: 3500,
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

function normalizeResult(parsed, fallbackName, merchantCategory) {
  const listing = parsed.listing || parsed;
  const analysis = parsed.analysis || {};
  const options = {
    sizes: dedupeList(parsed.options?.sizes),
    colors: dedupeList(parsed.options?.colors),
    styles: dedupeList(parsed.options?.styles),
  };

  const title = String(listing.title || fallbackName).slice(0, 255);
  const bodyHtml = String(listing.description_html || listing.body_html || "");
  const faqHtml = String(listing.faq_html || "");
  const tags = Array.isArray(listing.tags)
    ? listing.tags.map(String).slice(0, 12).join(", ")
    : String(listing.tags || "");

  const images = Array.isArray(parsed.images)
    ? parsed.images.map((img, i) => ({
        alt: String(img.alt || title).slice(0, 125),
        caption: String(img.caption || "").slice(0, 200),
        role: img.role || (i === 0 ? "main" : "gallery"),
      }))
    : [{ alt: String(listing.image_alt || title).slice(0, 125), caption: "", role: "main" }];

  const normalized = {
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
    image_alt: images[0]?.alt || title.slice(0, 125),
    product_type: String(
      merchantCategory || listing.product_type || analysis.category || ""
    ).slice(0, 100),
    vendor: String(listing.vendor || "Souso").slice(0, 100),
  };

  return {
    analysis: {
      summary: String(analysis.summary || "").slice(0, 500),
      visible_details: dedupeList(analysis.visible_details),
      category: String(analysis.category || normalized.product_type || ""),
    },
    options,
    listing: normalized,
    images,
    variations: [normalized],
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
