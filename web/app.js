const params = new URLSearchParams(location.search);
const shop = params.get("shop") || "";

const els = {
  usageLine: document.getElementById("usageLine"),
  planBadge: document.getElementById("planBadge"),
  productHint: document.getElementById("productHint"),
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

async function api(path, opts = {}) {
  const url = path.includes("?") ? path : `${path}?shop=${encodeURIComponent(shop)}`;
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
  els.outBody.value = [v.body_html || "", v.faq_html || ""].filter(Boolean).join("\n\n");
  [...els.varTabs.querySelectorAll(".tab")].forEach((t, idx) => {
    t.classList.toggle("active", idx === i);
  });
  els.btnPublish.disabled = false;
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
    els.usageLine.textContent = "Unlimited listings · Pro $9/mo active";
    els.upgradeCard.classList.add("hidden");
    return;
  }
  els.planBadge.textContent = "Free";
  const left = usage.remaining ?? 0;
  els.usageLine.textContent = `${left} free listings left (of ${usage.free_limit}) · then $9/mo`;
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

async function loadMe() {
  if (!shop) {
    els.usageLine.textContent = "Open from Shopify Admin → Apps → YAMSHI";
    return;
  }
  try {
    const data = await api("/api/me");
    updateUsage(data.usage);
  } catch (e) {
    els.error.textContent = e.message;
  }
}

els.btnGenerate.addEventListener("click", async () => {
  els.error.textContent = "";
  els.btnGenerate.disabled = true;
  try {
    const data = await api("/api/generate", {
      method: "POST",
      body: {
        productHint: els.productHint.value,
        niche: els.niche.value,
        price: els.price.value,
        tone: els.tone.value,
        language: els.language.value,
        imageUrl: els.imageUrl.value,
      },
    });
    showVariations(data.variations || [data.listing].filter(Boolean));
    updateUsage(data.usage);
  } catch (e) {
    els.error.textContent = e.message;
    if (/limit/i.test(e.message)) els.upgradeCard.classList.remove("hidden");
  } finally {
    els.btnGenerate.disabled = false;
  }
});

els.btnPublish.addEventListener("click", async () => {
  els.error.textContent = "";
  els.btnPublish.disabled = true;
  try {
    await api("/api/publish", {
      method: "POST",
      body: {
        listing: currentListing(),
        price: els.price.value || "19.99",
        imageUrl: els.imageUrl.value,
      },
    });
    els.error.style.color = "#3dd68c";
    els.error.textContent = "Published to Shopify ✓ — check Products";
  } catch (e) {
    els.error.style.color = "#ff7b7b";
    els.error.textContent = e.message;
  } finally {
    els.btnPublish.disabled = false;
  }
});

els.btnBulk.addEventListener("click", async () => {
  els.bulkOut.textContent = "Running…";
  try {
    const data = await api("/api/bulk", {
      method: "POST",
      body: {
        lines: els.bulkLines.value,
        tone: els.tone.value,
        language: els.language.value,
      },
    });
    els.bulkOut.textContent = JSON.stringify(data.results, null, 2);
    updateUsage(data.usage);
  } catch (e) {
    els.bulkOut.textContent = e.message;
  }
});

els.btnUpgrade.addEventListener("click", () => {
  location.href = `/billing/start?shop=${encodeURIComponent(shop)}`;
});

loadMe();
