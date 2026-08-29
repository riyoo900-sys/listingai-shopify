const params = new URLSearchParams(location.search);
const shop = params.get("shop") || "";

function abs(path) {
  return new URL(String(path).replace(/^\//, ""), location.href).toString();
}

async function api(path, opts = {}) {
  const u = new URL(abs(path));
  if (shop && !u.searchParams.get("shop")) u.searchParams.set("shop", shop);
  const url = u.toString();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (window.shopify?.idToken) {
    try {
      headers.Authorization = `Bearer ${await window.shopify.idToken()}`;
    } catch (_) {}
  }
  const res = await fetch(url, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify({ ...opts.body, shop }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const els = {
  usage: document.getElementById("usageLine"),
  list: document.getElementById("pixelList"),
  error: document.getElementById("error"),
  form: document.getElementById("formCard"),
  statPixels: document.getElementById("statPixels"),
  statEvents: document.getElementById("statEvents"),
  statCapi: document.getElementById("statCapi"),
};

function maskId(id) {
  const s = String(id || "");
  if (s.length < 8) return s;
  return s.slice(0, 4) + " " + s.slice(4, 6) + "** **** " + s.slice(-3);
}

function renderPixels(pixels) {
  if (!pixels.length) {
    els.list.innerHTML = '<p class="muted">No pixels yet. Add the first — the next ones stack, they never replace.</p>';
    return;
  }
  els.list.innerHTML = pixels
    .map(
      (p) => `<div class="pixel">
        <div><strong>${p.name}</strong><div class="muted">${maskId(p.pixel_id)}</div></div>
        <div class="ok">${p.capi_token ? "CAPI connected" : "Browser only"}</div>
        <div class="muted">${(p.events || []).slice(0, 3).join(" · ")}</div>
        <button class="btn small" data-toggle="${p.id}">${p.enabled ? "On" : "Off"}</button>
        <button class="btn small danger" data-del="${p.id}">Delete</button>
      </div>`
    )
    .join("");
}

async function loadMe() {
  if (!shop) {
    els.usage.textContent = "Open from Shopify Admin → Apps → YAMSHI Pixels";
    return;
  }
  try {
    const data = await api("/api/me");
    els.usage.textContent = data.plan === "pro"
      ? `Pro active · unlimited pixels`
      : `${data.trial_days || 15} days free, then $${data.price_usd}/mo or $${data.price_yearly}/year`;
    els.statPixels.textContent = String((data.pixels || []).length);
    els.statEvents.textContent = String(data.events_today || 0);
    els.statCapi.textContent = String(data.capi_match || 0);
    renderPixels(data.pixels || []);
    const bill = document.getElementById("billingCard");
    if (bill) bill.classList.toggle("hidden", data.plan === "pro");
  } catch (e) {
    els.usage.textContent = e.message;
    if (/not installed|expired/i.test(e.message) && shop) {
      const url = abs(`auth?shop=${encodeURIComponent(shop)}`);
      els.usage.innerHTML = `Store not connected. <a href="${url}" target="_top" style="color:#2ee6a6">Install / reconnect</a>`;
    }
  }
}

document.getElementById("btnAdd").onclick = () => {
  els.form.classList.remove("hidden");
};
document.getElementById("btnCancel").onclick = () => els.form.classList.add("hidden");
document.getElementById("btnSave").onclick = async () => {
  els.error.textContent = "";
  try {
    await api("/api/pixels", {
      method: "POST",
      body: {
        name: document.getElementById("fName").value,
        pixel_id: document.getElementById("fPixelId").value,
        capi_token: document.getElementById("fToken").value,
        test_code: document.getElementById("fTest").value,
      },
    });
    els.form.classList.add("hidden");
    ["fName", "fPixelId", "fToken", "fTest"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    await loadMe();
  } catch (e) {
    els.error.textContent = e.message;
  }
};
els.list.addEventListener("click", async (ev) => {
  const del = ev.target.getAttribute("data-del");
  const tog = ev.target.getAttribute("data-toggle");
  if (del) {
    await fetch(abs(`api/pixels/${del}?shop=${encodeURIComponent(shop)}`), { method: "DELETE" });
    await loadMe();
  }
  if (tog) {
    await api(`/api/pixels/${tog}`, { method: "POST", body: { enabled: ev.target.textContent !== "On" } });
    await loadMe();
  }
});
function goBill(plan) {
  const url = abs(`billing/start?shop=${encodeURIComponent(shop)}&plan=${plan}`);
  if (window.top && window.top !== window) window.top.location.href = url;
  else location.href = url;
}
document.getElementById("btnMonthly").onclick = () => goBill("monthly");
document.getElementById("btnYearly").onclick = () => goBill("annual");

loadMe();
