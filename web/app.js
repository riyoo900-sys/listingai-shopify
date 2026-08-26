const params = new URLSearchParams(location.search);
const shop = params.get("shop") || "";
const PRICE = 7.99;

const els = {
  usageLine: document.getElementById("usageLine"),
  planBadge: document.getElementById("planBadge"),
  productSelect: document.getElementById("productSelect"),
  productStatus: document.getElementById("productStatus"),
  productPreview: document.getElementById("productPreview"),
  productPreviewImg: document.getElementById("productPreviewImg"),
  productHint: document.getElementById("productHint"),
  brandVoice: document.getElementById("brandVoice"),
  imageUrl: document.getElementById("imageUrl"),
  niche: document.getElementById("niche"),
  price: document.getElementById("price"),
  tone: document.getElementById("tone"),
  language: document.getElementById("language"),
  btnGenerate: document.getElementById("btnGenerate"),
  btnPublish: document.getElementById("btnPublish"),
  btnBulk: document.getElementById("btnBulk"),
  bulkLines: document.getElementById("bulkLines"),
  bulkOut: document.getElementById("bulkOut"),
  error: document.getElementById("error"),
  variationsCard: document.getElementById("variationsCard"),
  upgradeCard: document.getElementById("upgradeCard"),
  varTabs: document.getElementById("varTabs"),
  outTitle: document.getElementById("outTitle"),
  outTags: document.getElementById("outTags"),
  outSeoTitle: document.getElementById("outSeoTitle"),
  outSeoDesc: document.getElementById("outSeoDesc"),
  outAlt: document.getElementById("outAlt"),
  outBody: document.getElementById("outBody"),
  btnUpgrade: document.getElementById("btnUpgrade"),
};

let variations = [];
let selected = 0;
let activeProductId = null;

try {
  const saved = localStorage.getItem("listingai_brand_voice");
  if (saved && els.brandVoice) els.brandVoice.value = saved;
} catch {
  /* ignore */
}

els.brandVoice?.addEventListener("change", () => {
  try {
    localStorage.setItem("listingai_brand_voice", els.brandVoice.value.trim());
  } catch {
    /* ignore */
  }
});

async function api(path, opts = {}) {
  const url = path.includes("?")
    ? path
    : `${path}?shop=${encodeURIComponent(shop)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify({ ...opts.body, shop }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function fillVariation(i) {
  selected = i;
  const v = variations[i];
  if (!v) return;
  els.outTitle.value = v.title || "";
  els.outTags.value = v.tags || "";
  els.outSeoTitle.value = v.metafields_global_title_tag || "";
  els.outSeoDesc.value = v.metafields_global_description_tag || "";
  els.outAlt.value = v.image_alt || "";
  els.outBody.value = [v.body_html || "", v.faq_html || ""]
    .filter(Boolean)
    .join("\n\n");
  [...els.varTabs.querySelectorAll(".tab")].forEach((t, idx) => {
    t.classList.toggle("active", idx === i);
  });
  els.btnPublish.disabled = false;
  els.btnPublish.textContent = activeProductId
    ? "Apply to product"
    : "Publish as new product";
}

function showVariations(list) {
  variations = list || [];
  els.varTabs.innerHTML = "";
  variations.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (i === 0 ? " active" : "");
    b.textContent = `Version ${i + 1}`;
    b.onclick = () => fillVariation(i);
    els.varTabs.appendChild(b);
  });
  els.variationsCard.classList.remove("hidden");
  fillVariation(0);
}

function updateUsage(usage) {
  if (!usage) return;
  if (usage.plan === "pro") {
    els.planBadge.textContent = "Pro";
    els.usageLine.textContent = `Unlimited listings · Pro $${PRICE}/mo active`;
    els.upgradeCard.classList.add("hidden");
    return;
  }
  els.planBadge.textContent = "Free";
  const left = usage.remaining ?? 0;
  const cap = usage.free_limit ?? 15;
  els.usageLine.textContent = `${left} free listings left (of ${cap}) · then $${PRICE}/mo`;
  if (left <= 0) els.upgradeCard.classList.remove("hidden");
}

function currentListing() {
  return {
    title: els.outTitle.value,
    tags: els.outTags.value,
    body_html: els.outBody.value,
    metafields_global_title_tag: els.outSeoTitle.value,
    metafields_global_description_tag: els.outSeoDesc.value,
    image_alt: els.outAlt.value,
    faq_html: "",
  };
}

async function loadProducts() {
  if (!shop) return;
  if (els.productStatus) els.productStatus.textContent = "Loading catalog…";
  try {
    const data = await api("/api/products");
    const keep = els.productSelect.options[0];
    els.productSelect.innerHTML = "";
    els.productSelect.appendChild(keep);
    const list = data.products || [];
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.title + (p.price ? ` · $${p.price}` : "");
      opt.dataset.image = p.image || "";
      opt.dataset.price = p.price || "";
      els.productSelect.appendChild(opt);
    });
    if (els.productStatus) {
      els.productStatus.textContent = list.length
        ? `${list.length} product${list.length === 1 ? "" : "s"} loaded from your store.`
        : "No products in this store yet. You can still write from scratch below.";
    }
  } catch (e) {
    const msg = e.message || "Could not load products";
    if (els.productStatus) els.productStatus.textContent = msg;
    if (els.error) els.error.textContent = "Catalog: " + msg;
  }
}

function showPreview(url) {
  if (url) {
    els.productPreviewImg.src = url;
    els.productPreview.classList.remove("hidden");
  } else {
    els.productPreview.classList.add("hidden");
    els.productPreviewImg.removeAttribute("src");
  }
}

els.productSelect?.addEventListener("change", () => {
  const opt = els.productSelect.selectedOptions[0];
  activeProductId = els.productSelect.value || null;
  const img = opt?.dataset?.image || "";
  if (img) els.imageUrl.value = img;
  if (opt?.dataset?.price) els.price.value = opt.dataset.price;
  showPreview(img);
  if (activeProductId) {
    els.btnPublish.textContent = "Apply to product";
  } else {
    els.btnPublish.textContent = "Publish as new product";
  }
});

function installUrl() {
  const host = params.get("host") || "";
  const q = new URLSearchParams({ shop });
  if (host) q.set("host", host);
  return `${location.origin}/auth?${q.toString()}`;
}

function goInstall() {
  const url = installUrl();
  if (window.top && window.top !== window) {
    window.top.location.href = url;
    return;
  }
  location.href = url;
}

async function loadMe() {
  if (!shop) {
    if (els.usageLine) {
      els.usageLine.textContent = "Open from Shopify Admin → Apps → ListingAI SEO";
    }
    return;
  }
  try {
    const data = await api("/api/me");
    updateUsage(data.usage);
    await loadProducts();
  } catch (e) {
    const msg = e.message || "Could not reach the store";
    if (els.error) els.error.textContent = msg;
    if (els.usageLine) els.usageLine.textContent = msg;
    if (els.productStatus) els.productStatus.textContent = msg;
    if (/not installed|expired|reinstall/i.test(msg)) {
      if (els.usageLine) {
        els.usageLine.innerHTML =
          'Store not connected. <a href="#" id="btnReconnect" style="color:#5b8def">Click to install / reconnect</a>';
        document.getElementById("btnReconnect")?.addEventListener("click", (ev) => {
          ev.preventDefault();
          goInstall();
        });
      }
    }
  }
}

els.btnGenerate?.addEventListener("click", async () => {
  els.error.textContent = "";
  els.btnGenerate.disabled = true;
  try {
    const productId = els.productSelect.value || null;
    activeProductId = productId;
    const data = await api("/api/generate", {
      method: "POST",
      body: {
        productId,
        productHint: els.productHint.value,
        niche: els.niche.value,
        price: els.price.value,
        tone: els.tone.value,
        language: els.language.value,
        imageUrl: els.imageUrl.value,
        brandVoice: els.brandVoice.value,
      },
    });
    if (data.productId) activeProductId = String(data.productId);
    if (data.imageUrl) {
      els.imageUrl.value = data.imageUrl;
      showPreview(data.imageUrl);
    }
    showVariations(data.variations || [data.listing].filter(Boolean));
    updateUsage(data.usage);
  } catch (e) {
    els.error.textContent = e.message;
    if (/limit/i.test(e.message)) els.upgradeCard.classList.remove("hidden");
  } finally {
    els.btnGenerate.disabled = false;
  }
});

els.btnPublish?.addEventListener("click", async () => {
  els.error.textContent = "";
  els.btnPublish.disabled = true;
  try {
    const data = await api("/api/publish", {
      method: "POST",
      body: {
        listing: currentListing(),
        price: els.price.value || "19.99",
        imageUrl: els.imageUrl.value,
        productId: activeProductId || els.productSelect.value || null,
      },
    });
    els.error.style.color = "#3dd68c";
    els.error.textContent = data.updated
      ? "Product updated ✓ — check Products"
      : "Published to Shopify ✓ — check Products";
  } catch (e) {
    els.error.style.color = "#ff7b7b";
    els.error.textContent = e.message;
  } finally {
    els.btnPublish.disabled = false;
  }
});

els.btnBulk?.addEventListener("click", async () => {
  els.bulkOut.textContent = "Running…";
  try {
    const data = await api("/api/bulk", {
      method: "POST",
      body: {
        lines: els.bulkLines.value,
        tone: els.tone.value,
        language: els.language.value,
        brandVoice: els.brandVoice.value,
      },
    });
    els.bulkOut.textContent = JSON.stringify(data.results, null, 2);
    updateUsage(data.usage);
  } catch (e) {
    els.bulkOut.textContent = e.message;
  }
});

els.btnUpgrade?.addEventListener("click", () => {
  const url = `/billing/start?shop=${encodeURIComponent(shop)}`;
  if (window.top && window.top !== window) window.top.location.href = url;
  else location.href = url;
});

loadMe();
