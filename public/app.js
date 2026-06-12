const fixturesElement = document.querySelector("#fixtures");
const connectionElement = document.querySelector("#connection");
const updatedElement = document.querySelector("#updated");
const quotaElement = document.querySelector("#quota");
const alertsElement = document.querySelector("#alerts");
const refreshButton = document.querySelector("#refresh");
const template = document.querySelector("#fixture-template");

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  await fetch("/api/refresh", { method: "POST" });
  await loadState();
  refreshButton.disabled = false;
});

async function loadState() {
  try {
    const state = await fetch("/api/state", { cache: "no-store" }).then((response) =>
      response.json()
    );
    render(state);
  } catch (error) {
    connectionElement.textContent = `Dashboard error: ${error.message}`;
    connectionElement.className = "error";
  }
}

function render(state) {
  connectionElement.textContent = state.error
    ? state.error
    : state.loading
      ? "Polling live matches..."
      : "Live feed connected";
  connectionElement.className = state.error ? "error" : "connected";
  updatedElement.textContent = state.updatedAt
    ? `Updated ${new Date(state.updatedAt).toLocaleTimeString()}`
    : "";
  quotaElement.textContent = state.remainingRequests
    ? `${state.remainingRequests} API requests remaining`
    : "";
  alertsElement.textContent = state.alerts?.enabled
    ? state.alerts.error
      ? `Email error: ${state.alerts.error}`
      : state.alerts.lastResult?.ok
        ? `Email active · last sent ${new Date(state.alerts.lastResult.at).toLocaleTimeString()}`
        : "Email alerts active"
    : "Email alerts not configured";
  alertsElement.className = state.alerts?.error ? "error" : "";

  fixturesElement.replaceChildren();
  if (!state.fixtures?.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.error
      ? "Fix the connection message above, then refresh."
      : "No live matches currently meet the configured monitoring windows.";
    fixturesElement.append(empty);
    return;
  }

  for (const fixture of state.fixtures) {
    const card = template.content.cloneNode(true);
    const cardElement = card.querySelector(".fixture-card");
    cardElement.classList.toggle("no-stats", !fixture.hasStatistics);
    card.querySelector(".competition").textContent = [fixture.country, fixture.league]
      .filter(Boolean)
      .join(" · ");
    card.querySelector(".teams").textContent = `${fixture.home} vs ${fixture.away}`;
    card.querySelector(".score").textContent = fixture.score;
    card.querySelector(".minute").textContent = `${fixture.minute}' ${fixture.status}`;

    const stats = card.querySelector(".stats");
    const statValues = [
      ["On target", fixture.statistics.shotsOnTarget],
      ["Shots", fixture.statistics.totalShots],
      ["Corners", fixture.statistics.corners],
      ["Box shots", fixture.statistics.shotsInsideBox]
    ];
    for (const [label, value] of statValues) {
      stats.append(makeStat(label, value));
    }

    const signals = card.querySelector(".signals");
    for (const warning of fixture.context?.warnings ?? []) {
      const warningElement = document.createElement("div");
      warningElement.className = "context-warning";
      warningElement.textContent = warning;
      signals.append(warningElement);
    }
    if (!fixture.hasStatistics) {
      const unavailable = document.createElement("div");
      unavailable.className = "data-unavailable";
      unavailable.innerHTML =
        "<strong>No stats coverage</strong><span>This match is excluded from betting signals.</span>";
      signals.append(unavailable);
    } else if (!fixture.signals.length) {
      signals.textContent = "Monitoring only: no configured market is active.";
    }
    for (const signal of fixture.signals) {
      signals.append(makeSignal(signal));
    }
    fixturesElement.append(card);
  }
}

function makeStat(label, value) {
  const element = document.createElement("div");
  element.innerHTML = `<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>`;
  return element;
}

function makeSignal(signal) {
  const element = document.createElement("section");
  element.className = `signal ${signal.level}`;
  const price = signal.price
    ? `<span class="price">${escapeHtml(signal.price.side)} ${signal.price.line} @ ${signal.price.odd} · ${escapeHtml(signal.price.bookmaker)}</span>`
    : `<span class="price muted">No matching live price returned</span>`;
  element.innerHTML = `
    <div class="signal-title">
      <div><span class="level">${escapeHtml(signal.level)}</span><h3>${escapeHtml(signal.label)}</h3></div>
      <strong class="signal-score">${signal.score}</strong>
    </div>
    ${price}
    <p>${signal.reasons.map(escapeHtml).join(" · ")}</p>
    <small>${escapeHtml(signal.caution)}</small>
  `;
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadState();
setInterval(loadState, 5000);
