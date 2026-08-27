import crypto from "node:crypto";

function sha256(v) {
  if (!v) return undefined;
  return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
}

export async function sendCapi(pixel, eventName, { value, currency, eventId, email, phone, ip, ua, sourceUrl }) {
  if (!pixel?.pixel_id || !pixel?.capi_token) return { skipped: true };
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId || crypto.randomUUID(),
        action_source: "website",
        event_source_url: sourceUrl || undefined,
        user_data: {
          em: email ? [sha256(email)] : undefined,
          ph: phone ? [sha256(String(phone).replace(/\D/g, ""))] : undefined,
          client_ip_address: ip || undefined,
          client_user_agent: ua || undefined,
        },
        custom_data:
          value != null
            ? { value: Number(value), currency: currency || "USD" }
            : undefined,
      },
    ],
  };
  if (pixel.test_code) payload.test_event_code = pixel.test_code;
  const url = `https://graph.facebook.com/v21.0/${pixel.pixel_id}/events?access_token=${encodeURIComponent(pixel.capi_token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}
