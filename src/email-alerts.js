import { createHash } from "node:crypto";

const LEVEL_RANK = { pass: 0, watch: 1, strong: 2 };

export class EmailAlerts {
  constructor({
    apiKey,
    to,
    from = "Live Goals Desk <onboarding@resend.dev>",
    minimumLevel = "watch",
    dashboardUrl = "",
    cooldownMinutes = 90,
    fetchImpl = fetch
  }) {
    this.apiKey = apiKey;
    this.to = splitAddresses(to);
    this.from = from;
    this.minimumLevel = minimumLevel;
    this.dashboardUrl = dashboardUrl;
    this.cooldownMs = Number(cooldownMinutes) * 60_000;
    this.fetchImpl = fetchImpl;
    this.sent = new Map();
    this.lastResult = null;
  }

  get enabled() {
    return Boolean(this.apiKey && this.to.length);
  }

  async notify(fixtures) {
    if (!this.enabled) return [];
    this.prune();

    const candidates = [];
    for (const fixture of fixtures) {
      for (const signal of fixture.signals ?? []) {
        if (!this.shouldSend(fixture, signal)) continue;
        candidates.push({ fixture, signal });
      }
    }

    const results = [];
    for (const candidate of candidates) {
      results.push(await this.send(candidate.fixture, candidate.signal));
    }
    return results;
  }

  shouldSend(fixture, signal) {
    const minimumRank = LEVEL_RANK[this.minimumLevel] ?? LEVEL_RANK.watch;
    const signalRank = LEVEL_RANK[signal.level] ?? 0;
    if (signalRank < minimumRank) return false;

    const key = alertKey(fixture, signal);
    const lastSentAt = this.sent.get(key);
    return !lastSentAt || Date.now() - lastSentAt >= this.cooldownMs;
  }

  async send(fixture, signal) {
    const key = alertKey(fixture, signal);
    const payload = {
      from: this.from,
      to: this.to,
      subject: `${signal.level.toUpperCase()}: ${signal.label} | ${fixture.home} vs ${fixture.away}`,
      html: renderEmail({ fixture, signal, dashboardUrl: this.dashboardUrl })
    };
    const idempotencyKey = createIdempotencyKey({
      key,
      payload,
      bucket: Math.floor(Date.now() / this.cooldownMs)
    });

    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.message ?? `Resend returned HTTP ${response.status}`;
      this.lastResult = { ok: false, at: new Date().toISOString(), message };
      throw new Error(`Email alert failed: ${message}`);
    }

    this.sent.set(key, Date.now());
    this.lastResult = {
      ok: true,
      at: new Date().toISOString(),
      message: `Alert sent for ${fixture.home} vs ${fixture.away}`,
      id: body.id
    };
    return this.lastResult;
  }

  prune() {
    const cutoff = Date.now() - this.cooldownMs * 2;
    for (const [key, sentAt] of this.sent) {
      if (sentAt < cutoff) this.sent.delete(key);
    }
  }
}

function alertKey(fixture, signal) {
  return `${fixture.fixtureId}:${signal.type}:${signal.level}`;
}

function createIdempotencyKey({ key, payload, bucket }) {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 24);
  return `live-goals:${key}:${bucket}:${digest}`;
}

function splitAddresses(value = "") {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function renderEmail({ fixture, signal, dashboardUrl }) {
  const price = formatPrice(signal.price);
  const dashboardLink = dashboardUrl
    ? `<p><a href="${escapeHtml(dashboardUrl)}">Open Live Goals Desk</a></p>`
    : "";

  return `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;color:#102019">
    <h1>${escapeHtml(signal.label)}</h1>
    <p><strong>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</strong></p>
    <p>${escapeHtml(fixture.league)} | ${escapeHtml(fixture.score)} | ${fixture.minute}' ${escapeHtml(fixture.status)}</p>
    <p><strong>Signal:</strong> ${escapeHtml(signal.level.toUpperCase())} (${signal.score}/100)</p>
    <p><strong>Live market:</strong> ${escapeHtml(price)}</p>
    <p>${signal.reasons.map(escapeHtml).join(" &middot; ")}</p>
    <p style="color:#8a3b3b">${escapeHtml(signal.caution)}</p>
    ${dashboardLink}
    <hr>
    <small>This is decision support, not a guarantee or calibrated probability.</small>
  </body>
</html>`;
}

function formatPrice(price) {
  if (!price) return "No matching live price returned";
  if (price.label) return `${price.label} @ ${price.odd} (${price.bookmaker})`;
  return `${price.side} ${price.line} @ ${price.odd} (${price.bookmaker})`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
