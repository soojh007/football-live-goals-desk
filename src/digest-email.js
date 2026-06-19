export class DigestEmail {
  constructor({
    apiKey,
    to,
    from = "Football Digest <onboarding@resend.dev>",
    fetchImpl = fetch
  }) {
    this.apiKey = apiKey;
    this.to = splitAddresses(to);
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  get enabled() {
    return Boolean(this.apiKey && this.to.length);
  }

  async send(report) {
    if (!this.enabled) throw new Error("Digest email is not configured.");
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: this.from,
        to: this.to,
        subject: `Football next ${report.windowHours ?? 6}h digest: ${formatWindow(
          report
        )} (${report.candidates.length} picks)`,
        html: renderDigestHtml(report)
      }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message ?? `Resend returned HTTP ${response.status}`);
    }
    return body;
  }
}

export function renderDigestHtml(report) {
  const cards = report.candidates.map((candidate) => `
    <tr>
      <td style="padding:14px;border-bottom:1px solid #dfe8e3">
        <div style="font-size:12px;color:#61736b;text-transform:uppercase">${escapeHtml(candidate.country)} · ${escapeHtml(candidate.league)}</div>
        <div style="font-size:17px;font-weight:700;margin:5px 0">${escapeHtml(candidate.home)} vs ${escapeHtml(candidate.away)}</div>
        <div style="font-size:12px;color:#61736b">${escapeHtml(formatKickoff(candidate.kickoff, report.timezone))}</div>
      </td>
      <td style="padding:14px;border-bottom:1px solid #dfe8e3;text-align:right">
        <div style="font-size:11px;color:#61736b;text-transform:uppercase;letter-spacing:.7px">Main signal</div>
        <div style="font-size:16px;font-weight:800;color:${signalColor(candidate.mainSignal)}">${escapeHtml(candidate.mainSignal?.label ?? candidate.label)}</div>
        <div style="font-size:12px;color:#43554d">${escapeHtml(candidate.mainSignal?.market ?? "Total goals 2.5")}</div>
        <div style="font-size:12px;color:#61736b">Rank score ${candidate.rankScore}/100 · ${escapeHtml(candidate.dataQuality)} data</div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0 14px 14px;color:#43554d;font-size:13px">
        ${candidate.reasons.map(escapeHtml).join(" · ")}
      </td>
    </tr>`).join("");

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#102019">
    <div style="max-width:760px;margin:0 auto;padding:24px">
      <div style="background:#0d211a;color:white;padding:22px;border-radius:14px 14px 0 0">
        <div style="font-size:12px;color:#66e0aa;text-transform:uppercase;letter-spacing:1px">Rolling match intelligence</div>
        <h1 style="margin:8px 0 4px">Next ${escapeHtml(report.windowHours ?? 6)} Hours</h1>
        <div style="color:#a9beb5">${escapeHtml(formatWindow(report))} · ${report.analyzed} matches analysed · ${report.requestsUsed} API requests</div>
      </div>
      <table role="presentation" style="border-collapse:collapse;width:100%;background:white">
        ${cards || '<tr><td style="padding:24px">No candidates passed the data-quality filter.</td></tr>'}
      </table>
      <div style="padding:16px;background:#e8efeb;color:#61736b;font-size:12px;border-radius:0 0 14px 14px">
        Rankings are model-based decision support, not guaranteed outcomes or calibrated probabilities.
      </div>
    </div>
  </body>
</html>`;
}

function formatWindow(report) {
  if (!report.windowStart || !report.windowEnd) return report.date;
  return `${formatShortDateTime(report.windowStart, report.timezone)} - ${formatShortTime(
    report.windowEnd,
    report.timezone
  )}`;
}

function signalColor(signal) {
  if (signal?.kind === "RESULT") return "#1f6feb";
  if (signal?.kind === "BTTS") return signal.pick === "Yes" ? "#087f5b" : "#9a6700";
  return signal?.pick === "Over 2.5" ? "#087f5b" : "#9a6700";
}

function formatKickoff(value, timezone) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatShortDateTime(value, timezone) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortTime(value, timezone) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function splitAddresses(value = "") {
  return value.split(",").map((address) => address.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
