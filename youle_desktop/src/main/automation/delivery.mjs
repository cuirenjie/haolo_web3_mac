import crypto from "node:crypto";

export async function deliverWebhook({ url, payload, secret, allowlist = [], fetchImpl = fetch }) {
  const parsed = new URL(url);
  if (allowlist.length && !allowlist.includes(parsed.hostname)) {
    throw new Error(`Webhook host ${parsed.hostname} is not allowlisted.`);
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Webhook URL must use http or https.");
  }
  const body = JSON.stringify({ payload, deliveredAt: new Date().toISOString() });
  const signature = signBody(body, secret || "");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-youle-signature": signature,
    },
    body,
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
}

export function buildDeliveryPayload({ provider = "webhook", run = {}, job = {} } = {}) {
  const title = `${job.name || "Automation"} · ${run.status || "unknown"}`;
  const summary = run.summary || run.errorMessage || "";
  const patchText = run.hasPatch ? " · patch ready" : "";
  const text = `${title}${patchText}${summary ? `\n${summary}` : ""}`;
  if (provider === "slack") {
    return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
  }
  if (provider === "teams") {
    return { type: "message", text, summary: title };
  }
  if (provider === "email") {
    return { subject: title, text };
  }
  return { text, run, job };
}

export function signBody(body, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}
