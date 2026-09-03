const params = new URLSearchParams(location.search);

const DEFAULT_PLANS = {
  starter: { price: 4.99, limit: 50 },
  pro: { price: 7.99, limit: null },
};

function normalizeShopClient(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!s) return "";
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return s;
}

function resolveShop() {
  const fromUrl = params.get("shop") || "";
  if (fromUrl) return normalizeShopClient(fromUrl);
  try {
    const saved = sessionStorage.getItem("listingai_shop");
    if (saved) return normalizeShopClient(saved);
  } catch {
    /* ignore */
  }
  if (typeof window.shopify !== "undefined" && window.shopify?.config?.shop) {
    return normalizeShopClient(window.shopify.config.shop);
  }
  return "";
}

let shop = resolveShop();
let storeConnected = false;

const els = {
  connectCard: document.getElementById("connectCard"),
  shopInput: document.getElementById("shopInput"),
  btnConnect: document.getElementById("btnConnect"),
  usageLine: document.getElementById("usageLine"),
  planBadge: document.getElementById("planBadge"),
  stepsBar: document.getElementById("stepsBar"),
  stepProduct: document.getElementById("stepProduct"),
  stepPreview: document.getElementById("stepPreview"),
  stepDone: document.getElementById("stepDone"),
  productName: document.getElementById("productName"),
  productPrice: document.getElementById("productPrice"),
  productCategory: document.getElementById("productCategory"),
  productCategoryCustom: document.getElementById("productCategoryCustom"),
  collectionSelect: document.getElementById("collectionSelect"),
  categoryStatus: document.getElementById("categoryStatus"),
  uploadZone: document.getElementById("uploadZone"),
  photoInput: document.getElementById("photoInput"),
  uploadPlaceholder: document.getElementById("uploadPlaceholder"),
  uploadPreview: document.getElementById("uploadPreview"),
  previewImg: document.getElementById("previewImg"),
  btnChangePhoto: document.getElementById("btnChangePhoto"),
  existingSelect: document.getElementById("existingSelect"),
  catalogStatus: document.getElementById("catalogStatus"),
  language: document.getElementById("language"),
  btnCreate: document.getElementById("btnCreate"),
  btnBack: document.getElementById("btnBack"),
  btnPublish: document.getElementById("btnPublish"),
  btnNew: document.getElementById("btnNew"),
  btnOpenShopify: document.getElementById("btnOpenShopify"),
  doneMessage: document.getElementById("doneMessage"),
  error: document.getElementById("error"),
  errorPublish: document.getElementById("errorPublish"),
  analysisBox: document.getElementById("analysisBox"),
  optionsBox: document.getElementById("optionsBox"),
  optionsChips: document.getElementById("optionsChips"),
  outTitle: document.getElementById("outTitle"),
  outCategory: document.getElementById("outCategory"),
  outSeoTitle: document.getElementById("outSeoTitle"),
  outSeoDesc: document.getElementById("outSeoDesc"),
  outTags: document.getElementById("outTags"),
  outAlt: document.getElementById("outAlt"),
  outBody: document.getElementById("outBody"),
  variationTabs: document.getElementById("variationTabs"),
  seoScoreBadge: document.getElementById("seoScoreBadge"),
  tagsChips: document.getElementById("tagsChips"),
  countTitle: document.getElementById("countTitle"),
  countSeoTitle: document.getElementById("countSeoTitle"),
  countSeoDesc: document.getElementById("countSeoDesc"),
  countTags: document.getElementById("countTags"),
  trialLine: document.getElementById("trialLine"),
  upgradeCard: document.getElementById("upgradeCard"),
  btnUpgradeStarter: document.getElementById("btnUpgradeStarter"),
  btnUpgradePro: document.getElementById("btnUpgradePro"),
  planStarter: document.getElementById("planStarter"),
  planPro: document.getElementById("planPro"),
};

let imageBase64 = "";
let imageDataUrl = "";
let lastResult = null;
let activeProductId = null;
let storeCollections = [];
let activeVariationIndex = 0;

const CATEGORY_ALL = "__all__";

function selectedCategory() {
  const custom = els.productCategoryCustom?.value.trim();
  if (custom) return custom;
  const val = els.productCategory?.value.trim();
  if (!val || val === CATEGORY_ALL) return "";
  return val;
}

function selectedCollectionMeta() {
  const id = els.collectionSelect?.value || "";
  if (!id) return { id: "", title: "" };
  const found = storeCollections.find((c) => String(c.id) === String(id));
  return { id, title: found?.title || "" };
}

function fillCategorySelect(types) {
  els.productCategory.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = CATEGORY_ALL;
  allOpt.textContent = "All — AI picks the best category";
  allOpt.selected = true;
  els.productCategory.appendChild(allOpt);
  (types || []).forEach((t) => {
    if (!t) return;
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    els.productCategory.appendChild(opt);
  });
}

function fillCollectionSelect(collections) {
  storeCollections = collections || [];
  els.collectionSelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "All / none — not tied to one collection";
  none.selected = true;
  els.collectionSelect.appendChild(none);
  storeCollections.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.title;
    els.collectionSelect.appendChild(opt);
  });
}

async function loadCategories() {
  if (!shop) return;
  try {
    const data = await api("/api/categories");
    fillCategorySelect(data.product_types || []);
    fillCollectionSelect(data.collections || []);
    if (els.categoryStatus) {
      const n = (data.product_types || []).length;
      const c = (data.collections || []).length;
      els.categoryStatus.textContent =
        n || c
          ? `${n} categories · ${c} collections — or leave All`
          : "No categories yet? Leave All — AI will choose for you.";
    }
  } catch (e) {
    if (els.categoryStatus) els.categoryStatus.textContent = e.message;
  }
}

async function api(path, opts = {}) {
  const activeShop = shop || resolveShop();
  const url = path.includes("?")
    ? path
    : `${path}?shop=${encodeURIComponent(activeShop)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body
      ? JSON.stringify({ ...opts.body, shop: activeShop })
      : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setStoreConnected(ok) {
  storeConnected = ok;
  if (els.connectCard) els.connectCard.hidden = ok;
  if (els.stepProduct) els.stepProduct.classList.toggle("is-disabled", !ok);
  if (els.btnCreate) els.btnCreate.disabled = !ok;
}

function showConnectMessage(msg) {
  if (els.usageLine) els.usageLine.textContent = msg;
  setStoreConnected(false);
}

function setStep(n) {
  els.stepsBar?.querySelectorAll(".step").forEach((s) => {
    s.classList.toggle("is-active", Number(s.dataset.step) === n);
    s.classList.toggle("is-done", Number(s.dataset.step) < n);
  });
  els.stepProduct.classList.toggle("hidden", n !== 1);
  els.stepPreview.classList.toggle("hidden", n !== 2);
  els.stepDone.classList.toggle("hidden", n !== 3);
}

function planPrices(usage) {
  return {
    starter: usage?.plans?.starter || DEFAULT_PLANS.starter,
    pro: usage?.plans?.pro || DEFAULT_PLANS.pro,
  };
}

function updateUsage(usage) {
  if (!usage) return;
  const { starter, pro } = planPrices(usage);
  const trialDays = usage.plans?.trial_days || 15;
  if (els.trialLine) {
    els.trialLine.textContent = `${trialDays}-day free trial · cancel anytime in Shopify`;
  }

  if (usage.plan === "pro") {
    els.planBadge.textContent = "Pro";
    els.usageLine.textContent = `Unlimited listings · Pro $${pro.price}/mo`;
    els.upgradeCard.classList.add("hidden");
    return;
  }

  if (usage.plan === "starter") {
    els.planBadge.textContent = "Starter";
    const left = usage.remaining ?? 0;
    const cap = usage.plan_limit ?? starter.limit ?? 50;
    els.usageLine.textContent = `${left} of ${cap} listings left this month · Starter $${starter.price}/mo`;
    if (left <= 0) {
      els.upgradeCard.classList.remove("hidden");
      els.planStarter?.classList.add("hidden");
      els.planPro?.classList.remove("hidden");
    } else {
      els.upgradeCard.classList.add("hidden");
    }
    return;
  }

  els.planBadge.textContent = "Free";
  const left = usage.remaining ?? 0;
  const cap = usage.free_limit ?? 25;
  els.usageLine.textContent = `${left} of ${cap} free listings left · ${trialDays}-day trial on paid plans`;
  if (left <= 0) {
    els.upgradeCard.classList.remove("hidden");
    els.planStarter?.classList.remove("hidden");
    els.planPro?.classList.remove("hidden");
  } else {
    els.upgradeCard.classList.add("hidden");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showPhotoPreview(dataUrl) {
  imageDataUrl = dataUrl;
  imageBase64 = dataUrl;
  els.previewImg.src = dataUrl;
  els.uploadPlaceholder.classList.add("hidden");
  els.uploadPreview.classList.remove("hidden");
}

function clearPhoto() {
  imageBase64 = "";
  imageDataUrl = "";
  els.previewImg.removeAttribute("src");
  els.uploadPreview.classList.add("hidden");
  els.uploadPlaceholder.classList.remove("hidden");
  els.photoInput.value = "";
}

async function handlePhotoFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    els.error.textContent = "Please upload a JPG, PNG or WebP image.";
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    els.error.textContent = "Image too large (max 4 MB).";
    return;
  }
  els.error.textContent = "";
  const dataUrl = await readFileAsDataUrl(file);
  showPhotoPreview(dataUrl);
}

els.uploadZone?.addEventListener("click", () => els.photoInput?.click());
els.btnChangePhoto?.addEventListener("click", (e) => {
  e.stopPropagation();
  els.photoInput?.click();
});
els.photoInput?.addEventListener("change", () => {
  const file = els.photoInput.files?.[0];
  if (file) handlePhotoFile(file);
});
els.uploadZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.uploadZone.classList.add("is-drag");
});
els.uploadZone?.addEventListener("dragleave", () => {
  els.uploadZone.classList.remove("is-drag");
});
els.uploadZone?.addEventListener("drop", (e) => {
  e.preventDefault();
  els.uploadZone.classList.remove("is-drag");
  const file = e.dataTransfer?.files?.[0];
  if (file) handlePhotoFile(file);
});

function renderOptions(options) {
  const parts = [];
  if (options?.sizes?.length) parts.push({ label: "Sizes", values: options.sizes });
  if (options?.colors?.length) parts.push({ label: "Colors", values: options.colors });
  if (options?.styles?.length) parts.push({ label: "Styles", values: options.styles });

  if (!parts.length) {
    els.optionsBox.classList.add("hidden");
    return;
  }

  els.optionsBox.classList.remove("hidden");
  els.optionsChips.innerHTML = parts
    .map(
      (g) =>
        `<div class="option-group"><strong>${g.label}</strong><div class="chips">${g.values
          .map((v) => `<span class="chip">${escapeHtml(v)}</span>`)
          .join("")}</div></div>`
    )
    .join("");
}

function renderAnalysis(analysis) {
  if (!analysis?.summary) {
    els.analysisBox.innerHTML = "";
    els.analysisBox.classList.add("hidden");
    return;
  }
  els.analysisBox.classList.remove("hidden");
  const details = (analysis.visible_details || [])
    .map((d) => `<li>${escapeHtml(d)}</li>`)
    .join("");
  els.analysisBox.innerHTML = `
    <h2>AI analysis</h2>
    <p>${escapeHtml(analysis.summary)}</p>
    ${details ? `<ul>${details}</ul>` : ""}
    ${analysis.category ? `<p class="muted">Category: ${escapeHtml(analysis.category)}</p>` : ""}
  `;
}

function parseTags(raw) {
  return String(raw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 15);
}

function renderTagsChips(tagsStr) {
  const tags = parseTags(tagsStr);
  if (els.countTags) els.countTags.textContent = `${tags.length}/15`;
  if (!els.tagsChips) return;
  els.tagsChips.innerHTML = tags
    .map(
      (t, i) =>
        `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-tag-i="${i}" aria-label="Remove">×</button></span>`
    )
    .join("");
}

function updateCharCounts() {
  if (els.countTitle) els.countTitle.textContent = `${(els.outTitle?.value || "").length}/200`;
  if (els.countSeoTitle) els.countSeoTitle.textContent = `${(els.outSeoTitle?.value || "").length}/70`;
  if (els.countSeoDesc) els.countSeoDesc.textContent = `${(els.outSeoDesc?.value || "").length}/160`;
  if (els.countTags) els.countTags.textContent = `${parseTags(els.outTags?.value).length}/15`;
}

function saveCurrentVariation() {
  if (!lastResult?.variations?.length) return;
  const i = activeVariationIndex;
  if (!lastResult.variations[i]) return;
  lastResult.variations[i] = {
    ...lastResult.variations[i],
    ...currentListing(),
  };
  lastResult.listing = lastResult.variations[i];
}

function applyVariation(listing) {
  if (!listing) return;
  els.outTitle.value = listing.title || "";
  els.outCategory.value =
    listing.product_type || selectedCategory() || lastResult?.analysis?.category || "";
  els.outSeoTitle.value = listing.metafields_global_title_tag || "";
  els.outSeoDesc.value = listing.metafields_global_description_tag || "";
  els.outTags.value = listing.tags || "";
  els.outAlt.value = listing.image_alt || "";
  els.outBody.value = [listing.body_html || "", listing.faq_html || ""].filter(Boolean).join("\n\n");
  renderTagsChips(listing.tags || "");
  updateCharCounts();
  if (els.seoScoreBadge) {
    const score = listing.seo_score != null ? listing.seo_score : "—";
    els.seoScoreBadge.textContent = `SEO ${score}/100`;
  }
}

function renderVariationTabs() {
  const vars = lastResult?.variations || [];
  if (!els.variationTabs) return;
  if (vars.length < 2) {
    els.variationTabs.innerHTML = "";
    return;
  }
  els.variationTabs.innerHTML = vars
    .map((v, i) => {
      const label = v.style_label || `Version ${i + 1}`;
      const score = v.seo_score != null ? v.seo_score : "—";
      return `<button type="button" class="var-tab${i === activeVariationIndex ? " is-active" : ""}" data-var="${i}">
        ${escapeHtml(label)}
        <span class="var-score">SEO ${score}/100</span>
      </button>`;
    })
    .join("");
}

function selectVariation(index) {
  if (!lastResult?.variations?.[index]) return;
  saveCurrentVariation();
  activeVariationIndex = index;
  applyVariation(lastResult.variations[index]);
  lastResult.listing = lastResult.variations[index];
  renderVariationTabs();
}

function fillPreview(data) {
  lastResult = data;
  activeVariationIndex = 0;
  const vars = data.variations?.length ? data.variations : data.listing ? [data.listing] : [];
  if (!data.variations?.length && data.listing) lastResult.variations = vars;
  renderAnalysis(data.analysis);
  renderOptions(data.options);
  renderVariationTabs();
  applyVariation(vars[0] || data.listing || {});
}

function currentListing() {
  return {
    title: els.outTitle.value.trim(),
    tags: els.outTags.value.trim(),
    body_html: els.outBody.value,
    metafields_global_title_tag: els.outSeoTitle.value.trim(),
    metafields_global_description_tag: els.outSeoDesc.value.trim(),
    image_alt: els.outAlt.value.trim(),
    faq_html: "",
    product_type: els.outCategory?.value.trim() || lastResult?.listing?.product_type || "",
    vendor: lastResult?.listing?.vendor || "",
    seo_score: lastResult?.variations?.[activeVariationIndex]?.seo_score,
    style_label: lastResult?.variations?.[activeVariationIndex]?.style_label,
  };
}

function imagePayload() {
  const img = String(imageDataUrl || imageBase64 || "");
  return {
    imageBase64: img.startsWith("data:") ? img : "",
    imageUrl: img.startsWith("http") ? img : "",
  };
}

function hasPhoto() {
  const img = String(imageDataUrl || imageBase64 || "");
  return img.startsWith("data:") || img.startsWith("http");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadProducts() {
  if (!shop) return;
  try {
    const data = await api("/api/products");
    const keep = els.existingSelect.options[0];
    els.existingSelect.innerHTML = "";
    els.existingSelect.appendChild(keep);
    (data.products || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.title + (p.price ? ` · $${p.price}` : "");
      opt.dataset.title = p.title;
      opt.dataset.price = p.price || "";
      opt.dataset.image = p.image || "";
      opt.dataset.type = p.product_type || "";
      els.existingSelect.appendChild(opt);
    });
    if (els.catalogStatus) {
      els.catalogStatus.textContent = data.products?.length
        ? `${data.products.length} products in your store`
        : "No products yet — create a new one below";
    }
  } catch (e) {
    if (els.catalogStatus) els.catalogStatus.textContent = e.message;
  }
}

els.existingSelect?.addEventListener("change", () => {
  const opt = els.existingSelect.selectedOptions[0];
  activeProductId = els.existingSelect.value || null;
  if (!activeProductId) return;
  if (opt.dataset.title) els.productName.value = opt.dataset.title;
  if (opt.dataset.price) els.productPrice.value = opt.dataset.price;
  if (opt.dataset.type) {
    const t = opt.dataset.type;
    if ([...els.productCategory.options].some((o) => o.value === t)) {
      els.productCategory.value = t;
      els.productCategoryCustom.value = "";
    } else {
      els.productCategoryCustom.value = t;
    }
  }
  if (opt.dataset.image) {
    imageBase64 = opt.dataset.image;
    imageDataUrl = opt.dataset.image;
    showPhotoPreview(opt.dataset.image);
  }
});

function goInstall(targetShop) {
  const s = normalizeShopClient(targetShop || shop);
  if (!s) return;
  shop = s;
  const host = params.get("host") || "";
  const q = new URLSearchParams({ shop: s });
  if (host) q.set("host", host);
  const url = `${location.origin}/auth?${q.toString()}`;
  if (window.top && window.top !== window) window.top.location.href = url;
  else location.href = url;
}

els.btnConnect?.addEventListener("click", () => {
  const raw = els.shopInput?.value.trim() || shop;
  if (!raw) {
    if (els.error) els.error.textContent = "Enter your store: example.myshopify.com";
    els.shopInput?.focus();
    return;
  }
  if (els.error) els.error.textContent = "";
  goInstall(raw);
});

async function loadMe() {
  shop = resolveShop();
  if (els.shopInput && shop) els.shopInput.value = shop;

  if (!shop) {
    showConnectMessage("Connect your Shopify store to create listings.");
    return;
  }
  try {
    const data = await api("/api/me");
    try {
      sessionStorage.setItem("listingai_shop", shop);
    } catch {
      /* ignore */
    }
    setStoreConnected(true);
    if (els.usageLine) els.usageLine.textContent = `Connected · ${shop}`;
    updateUsage(data.usage);
    await Promise.all([loadProducts(), loadCategories()]);
  } catch (e) {
    const msg = e.message || "Could not connect store";
    showConnectMessage(msg === "Not installed" ? "Store not installed yet — click Connect below." : msg);
    if (els.error) {
      els.error.textContent =
        msg === "Not installed"
          ? "Install the app on your store first, then come back here."
          : msg;
    }
  }
}

els.btnCreate?.addEventListener("click", async () => {
  els.error.textContent = "";
  shop = resolveShop();
  if (!shop || !storeConnected) {
    els.error.textContent =
      "Connect your Shopify store first — enter example.myshopify.com above.";
    els.connectCard?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const name = els.productName.value.trim();
  const price = els.productPrice.value.trim();
  if (!name) {
    els.error.textContent = "Enter the product name.";
    els.productName.focus();
    return;
  }
  if (!price) {
    els.error.textContent = "Enter the price.";
    els.productPrice.focus();
    return;
  }
  if (!hasPhoto()) {
    els.error.textContent =
      "Upload a product photo (or pick an existing product with an image).";
    return;
  }

  els.btnCreate.disabled = true;
  els.btnCreate.textContent = "Analyzing photo & writing 3 SEO variations…";
  try {
    const coll = selectedCollectionMeta();
    const img = imagePayload();
    const cat = selectedCategory();
    const data = await api("/api/generate", {
      method: "POST",
      body: {
        productName: name,
        price,
        ...(cat ? { category: cat } : {}),
        ...(coll.title ? { collectionTitle: coll.title } : {}),
        language: els.language.value,
        imageBase64: img.imageBase64,
        imageUrl: img.imageUrl,
        productId: activeProductId,
      },
    });
    lastResult = data;
    fillPreview(data);
    setStep(2);
    updateUsage(data.usage);
  } catch (e) {
    els.error.textContent = e.message;
    if (/limit/i.test(e.message)) els.upgradeCard.classList.remove("hidden");
  } finally {
    els.btnCreate.disabled = false;
    els.btnCreate.textContent = "Generate listings with AI";
  }
});

els.btnBack?.addEventListener("click", () => setStep(1));

els.variationTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-var]");
  if (!btn) return;
  selectVariation(Number(btn.dataset.var));
});

els.tagsChips?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tag-i]");
  if (!btn) return;
  const tags = parseTags(els.outTags.value);
  tags.splice(Number(btn.dataset.tagI), 1);
  els.outTags.value = tags.join(", ");
  renderTagsChips(els.outTags.value);
});

els.outTags?.addEventListener("input", () => {
  renderTagsChips(els.outTags.value);
});
els.outTitle?.addEventListener("input", updateCharCounts);
els.outSeoTitle?.addEventListener("input", updateCharCounts);
els.outSeoDesc?.addEventListener("input", updateCharCounts);

els.btnPublish?.addEventListener("click", async () => {
  saveCurrentVariation();
  if (els.errorPublish) els.errorPublish.textContent = "";
  if (!currentListing().title) {
    if (els.errorPublish) els.errorPublish.textContent = "Title is required.";
    return;
  }
  els.btnPublish.disabled = true;
  els.btnPublish.textContent = "Publishing…";
  try {
    const img = imagePayload();
    const coll = selectedCollectionMeta();
    const data = await api("/api/publish", {
      method: "POST",
      body: {
        listing: currentListing(),
        options: lastResult?.options || {},
        price: els.productPrice.value.trim(),
        category: els.outCategory?.value.trim() || selectedCategory() || undefined,
        collectionId: coll.id || null,
        imageBase64: img.imageBase64,
        imageUrl: img.imageUrl,
        productId: activeProductId,
      },
    });
    const pid = data.product?.id;
    if (els.doneMessage) {
      els.doneMessage.textContent = data.updated
        ? "Product updated with tags, SEO title & professional copy ✓"
        : "New product published with tags, SEO, variants & image ✓";
    }
    if (pid && shop && els.btnOpenShopify) {
      els.btnOpenShopify.href = `https://${shop}/admin/products/${pid}`;
    }
    setStep(3);
  } catch (e) {
    if (els.errorPublish) els.errorPublish.textContent = e.message || "Publish failed";
  } finally {
    els.btnPublish.disabled = false;
    els.btnPublish.textContent = "Publish to Shopify";
  }
});

els.btnNew?.addEventListener("click", () => {
  els.productName.value = "";
  els.productPrice.value = "";
  els.productCategory.value = CATEGORY_ALL;
  els.productCategoryCustom.value = "";
  els.collectionSelect.value = "";
  clearPhoto();
  activeProductId = null;
  els.existingSelect.value = "";
  lastResult = null;
  setStep(1);
});

function goBilling(planId) {
  const url = `/billing/start?shop=${encodeURIComponent(shop)}&plan=${encodeURIComponent(planId)}`;
  if (window.top && window.top !== window) window.top.location.href = url;
  else location.href = url;
}

els.btnUpgradeStarter?.addEventListener("click", () => goBilling("starter"));
els.btnUpgradePro?.addEventListener("click", () => goBilling("pro"));

loadMe();
