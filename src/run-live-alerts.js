import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.js";
import { ApiFootballClient } from "./api-football.js";
import { EmailAlerts } from "./email-alerts.js";
import { LiveMonitor } from "./monitor.js";
import { SnapshotStore } from "./snapshot-store.js";

loadEnv();

const root = path.resolve(".");
const config = readConfig();
config.matchWinner = configuredMatchWinner(config.matchWinner);
const monitor = new LiveMonitor({
  client: new ApiFootballClient({ apiKey: process.env.API_FOOTBALL_KEY }),
  store: new SnapshotStore(path.join(root, "data")),
  alerts: new EmailAlerts({
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.ALERT_EMAIL_TO,
    from: process.env.ALERT_EMAIL_FROM,
    minimumLevel: process.env.ALERT_MIN_LEVEL ?? "watch",
    dashboardUrl: process.env.PUBLIC_URL ?? "",
    cooldownMinutes: clampInteger(process.env.ALERT_COOLDOWN_MINUTES, 90, 1, 360)
  }),
  configPath: path.join(root, "config.json"),
  configOverrides: { matchWinner: config.matchWinner },
  statisticsRefreshSeconds: clampInteger(process.env.STATISTICS_REFRESH_SECONDS, 120, 30, 900),
  unavailableRetrySeconds: clampInteger(process.env.UNAVAILABLE_RETRY_SECONDS, 900, 60, 3600),
  oddsRefreshSeconds: clampInteger(process.env.ODDS_REFRESH_SECONDS, 300, 30, 1200)
});

const state = await monitor.poll();
if (state.error) throw new Error(state.error);
if (state.alerts.error) throw new Error(state.alerts.error);

const actionable = state.fixtures.reduce(
  (total, fixture) =>
    total + fixture.signals.filter((signal) => signal.level !== "pass").length,
  0
);

console.log(
  [
    `Live alert scan complete: ${state.fixtures.length} focused matches`,
    `${actionable} actionable signals`,
    `${state.alerts.sent ?? 0} emails sent`,
    `alerts ${state.alerts.enabled ? "enabled" : "disabled"}`,
    `countries ${(config.liveCountries ?? []).join(", ") || "all"}`,
    `leagues ${(config.liveLeagues ?? []).join(", ") || "all"}`,
    `requests left ${state.remainingRequests ?? "unknown"}`
  ].join(" · ")
);

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
}

function configuredMatchWinner(fallback = {}) {
  return {
    ...fallback,
    enabled: parseBoolean(process.env.MATCH_WINNER_ENABLED, fallback.enabled),
    startMinute: configuredNumber("MATCH_WINNER_START_MINUTE", fallback.startMinute),
    endMinute: configuredNumber("MATCH_WINNER_END_MINUTE", fallback.endMinute),
    minimumBookmakers: configuredNumber("MATCH_WINNER_MINIMUM_BOOKMAKERS", fallback.minimumBookmakers),
    minimumProbability: configuredNumber("MATCH_WINNER_MINIMUM_PROBABILITY", fallback.minimumProbability),
    minimumEdge: configuredNumber("MATCH_WINNER_MINIMUM_EDGE", fallback.minimumEdge)
  };
}

function configuredNumber(envKey, fallback) {
  const parsed = Number.parseFloat(process.env[envKey]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}
