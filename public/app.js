const fixturesElement = document.querySelector("#fixtures");
const statusElement = document.querySelector("#status");
const usageElement = document.querySelector("#usage");
const cooldownElement = document.querySelector("#cooldown");
const summaryElement = document.querySelector("#summary");
const generateButton = document.querySelector("#generate");
const template = document.querySelector("#fixture-template");
let nextAllowedAt = null;

generateButton.addEventListener("click", async () => {
  setLoading(true);
  try {
    const response = await fetch("/api/shortlist", { method: "POST" });
    const state = await response.json();
    if (!response.ok && response.status !== 429) throw new Error(state.error);
    render(state);
  } catch (error) {
    statusElement.textContent = `Could not generate list: ${error.message}`;
    statusElement.className = "error";
  } finally {
    setLoading(false);
  }
});

async function loadState() {
  try {
    const state = await fetch("/api/shortlist", { cache: "no-store" }).then((response) =>
      response.json()
    );
    render(state);
  } catch (error) {
    statusElement.textContent = `Dashboard error: ${error.message}`;
    statusElement.className = "error";
  }
}

function render(state) {
  nextAllowedAt = state.nextAllowedAt ? new Date(state.nextAllowedAt) : null;
  updateCooldown();
  if (!state.report) return;

  const report = state.report;
  statusElement.textContent = `List generated ${new Date(report.generatedAt).toLocaleTimeString()}`;
  statusElement.className = "connected";
  usageElement.textContent = `${report.requestsUsed} API requests used`;
  summaryElement.hidden = false;
  summaryElement.textContent =
    `${report.candidates.length} picks from ${report.analyzed} matches analyzed · ` +
    `${formatTime(report.windowStart)} to ${formatTime(report.windowEnd)}`;

  fixturesElement.replaceChildren();
  if (!report.candidates.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = report.upcomingFound
      ? "Matches were found, but none passed the data-quality filter."
      : "No eligible matches begin in the next three hours.";
    fixturesElement.append(empty);
    return;
  }

  for (const candidate of report.candidates) {
    const card = template.content.cloneNode(true);
    const cardElement = card.querySelector(".fixture-card");
    const signal = candidate.mainSignal ?? {
      market: "Total goals 2.5",
      label: candidate.label,
      pick: candidate.side === "OVER_2_5" ? "Over 2.5" : "Under 2.5",
      kind: "TOTALS"
    };
    cardElement.classList.add(signalClass(signal));
    card.querySelector(".competition").textContent =
      `${candidate.country} · ${candidate.league}`;
    card.querySelector(".teams").textContent = `${candidate.home} vs ${candidate.away}`;
    card.querySelector(".kickoff").textContent = `Kickoff ${formatDateTime(candidate.kickoff)}`;
    card.querySelector(".label").textContent = signal.label;
    card.querySelector(".rank").textContent =
      `${signal.market} · Rank ${candidate.rankScore}/100 · ${candidate.dataQuality} data`;

    const details = card.querySelector(".details");
    for (const reason of candidate.reasons) {
      const item = document.createElement("span");
      item.textContent = reason;
      details.append(item);
    }
    fixturesElement.append(card);
  }
}

function updateCooldown() {
  if (!nextAllowedAt) {
    cooldownElement.textContent = "";
    generateButton.disabled = false;
    return;
  }
  const remaining = nextAllowedAt.getTime() - Date.now();
  if (remaining <= 0) {
    cooldownElement.textContent = "Ready for another list";
    generateButton.disabled = false;
    nextAllowedAt = null;
    return;
  }
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.ceil((remaining % 60_000) / 1000);
  cooldownElement.textContent = `New scan available in ${minutes}:${String(seconds).padStart(2, "0")}`;
  generateButton.disabled = true;
}

function setLoading(loading) {
  generateButton.disabled = loading;
  generateButton.textContent = loading ? "Scanning matches..." : "Generate new list";
  if (loading) {
    statusElement.textContent = "Checking fixtures and predictions...";
    statusElement.className = "";
  }
}

function signalClass(signal) {
  if (signal.kind === "RESULT") return "result";
  if (signal.kind === "BTTS") return signal.pick === "Yes" ? "over" : "under";
  return signal.pick === "Over 2.5" ? "over" : "under";
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

loadState();
setInterval(updateCooldown, 1000);
