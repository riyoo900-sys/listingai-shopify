const SYSTEM = `You are an expert Shopify copywriter and SEO + AEO specialist for US e-commerce.
Optimize for Google shopping/search AND for AI assistants (ChatGPT, Perplexity) that recommend products.
Return ONLY valid JSON with this shape:
{
  "variations": [
    {
      "title": "max 70 chars, keyword-rich",
      "description_html": "HTML with 2-3 short paragraphs + ul/li bullets (benefits first)",
      "tags": ["tag1","tag2"],
      "seo_title": "max 60 chars",
      "seo_description": "max 155 chars with primary keyword + CTA",
      "faq_html": "<h3>Q</h3><p>A</p> x2-3 (natural Q&A for AI search)",
      "image_alt": "short descriptive alt text"
    }
  ]
}
Generate exactly 3 variations with different angles (benefit-led, feature-led, urgency/value).
Tone: clear, persuasive. No markdown fences.`;

/**
 * @param {{
 *   productHint: string,
 *   niche?: string,
 *   price?: string,
 *   tone?: string,
 *   language?: string,
 *   imageUrl?: string,
 *   brandVoice?: string,
 * }} input
 */
export async function generateListing(input) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing in .env");

  const models = [
    process.env.OPENROUTER_MODEL?.trim(),
    "deepseek/deepseek-chat",
    "openai/gpt-4o-mini",
    "google/gemini-flash-1.5",
  ].filter(Boolean);

  const tone = input.tone || "professional";
  const language = input.language || "English";

  const userParts = [
    `Write product listings in ${language}. Tone: ${tone}.`,
    "Product input:",
    input.productHint,
    input.niche ? `Niche: ${input.niche}` : "",
    input.price ? `Price: $${input.price}` : "",
    input.brandVoice
      ? `Brand voice / style rules (follow strictly): ${input.brandVoice}`
      : "",
    input.imageUrl
      ? `Product image URL (use for visual accuracy): ${input.imageUrl}`
      : "",
  ].filter(Boolean);

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userParts.join("\n") },
  ];

  if (input.imageUrl?.startsWith("http")) {
    messages[1] = {
      role: "user",
      content: [
        { type: "text", text: userParts.join("\n") },
        { type: "image_url", image_url: { url: input.imageUrl } },
      ],
    };
  }

  let lastErr = "";
  let raw = "";
  for (const model of [...new Set(models)]) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.SHOPIFY_APP_URL || "https://listingai.app",
        "X-Title": "ListingAI Shopify",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2800,
        temperature: 0.75,
        response_format: { type: "json_object" },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      lastErr = `OpenRouter ${res.status}: ${text.slice(0, 200)}`;
      // vision may fail on text-only models — retry without image next
      if (input.imageUrl && messages[1].content?.length) {
        messages[1] = { role: "user", content: userParts.join("\n") };
      }
      continue;
    }
    const data = JSON.parse(text);
    raw = String(data.choices?.[0]?.message?.content || "").trim();
    if (raw) break;
    lastErr = "Empty OpenRouter response";
  }
  if (!raw) throw new Error(lastErr || "OpenRouter failed");

  const jsonText = raw.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(jsonText);

  let variations = Array.isArray(parsed.variations) ? parsed.variations : [];
  if (!variations.length && parsed.title) variations = [parsed];

  const normalized = variations.slice(0, 3).map((v) => ({
    title: String(v.title || "").slice(0, 255),
    body_html: String(v.description_html || v.body_html || ""),
    tags: Array.isArray(v.tags)
      ? v.tags.map(String).slice(0, 12).join(", ")
      : String(v.tags || ""),
    metafields_global_title_tag: String(v.seo_title || v.title || "").slice(0, 70),
    metafields_global_description_tag: String(v.seo_description || "").slice(0, 160),
    faq_html: String(v.faq_html || ""),
    image_alt: String(v.image_alt || v.title || "").slice(0, 125),
  }));

  while (normalized.length < 3 && normalized.length > 0) {
    normalized.push({ ...normalized[0] });
  }

  return {
    variations: normalized,
    listing: normalized[0] || null,
  };
}
