import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.js";
import { ApiFootballClient } from "./api-football.js";
import { SportMonksClient } from "./sportmonks-client.js";
import {
  analyzeOdds,
  rankDigestCandidates,
  selectUpcomingFixtures
} from "./digest-engine.js";
import { DigestEmail, renderDigestHtml } from "./digest-email.js";
import { settleCandidate } from "./calibration.js";
import { CalibrationStore } from "./calibration-store.js";

loadEnv();

const config = readConfig();
config.oddsAgent = configuredOddsAgent(config.oddsAgent);
const timezone = process.env.DIGEST_TIMEZONE ?? config.timezone ?? "Asia/Singapore";
const now = new Date();
const windowHours = clampInteger(process.env.DIGEST_WINDOW_HOURS, 6, 1, 12);
const windowEnd = new Date(now.getTime() + windowHours * 60 * 60_000);
const dates = uniqueLocalDates(now, windowEnd, timezone);
const maxAnalyses = clampInteger(process.env.DIGEST_MAX_ANALYSES, 25, 1, 100);
const maxPicks = clampInteger(process.env.DIGEST_MAX_PICKS, 12, 1, 30);
const concurrency = clampInteger(process.env.DIGEST_CONCURRENCY, 4, 1, 8);
const calibrationMinimumSamples = clampInteger(process.env.CALIBRATION_MINIMUM_SAMPLES, 12, 1, 500);
const modelSignalsEnabled = parseBoolean(process.env.SPORTMONKS_MODEL_SIGNALS_ENABLED, true);
const dryRun = process.argv.includes("--dry-run");
const client = createDigestClient();
const calibrationStore = new CalibrationStore(path.resolve("data"));
const mailer = new DigestEmail({
  apiKey: process.env.RESEND_API_KEY,
  to: process.env.ALERT_EMAIL_TO,
  from: process.env.DIGEST_EMAIL_FROM ?? process.env.ALERT_EMAIL_FROM
});

const settlement = await settlePendingCandidates({
  client,
  store: calibrationStore,
  now,
  concurrency
});
const calibrationStats = calibrationStore.loadCalibrationStats({
  minimumSamples: calibrationMinimumSamples
});
const fixtureResults = await Promise.all(
  dates.map((date) => client.getFixturesByDate(date, timezone))
);
const fixtures = fixtureResults.flatMap((result) => result.data);
const selected = selectUpcomingFixtures(fixtures, {
  maxAnalyses,
  start: now,
  end: windowEnd,
  countries: configuredList("DIGEST_COUNTRIES", config.digestCountries),
  leagues: configuredList("DIGEST_LEAGUES", config.digestLeagues)
});
const modelSignalRequests = modelSignalsEnabled && supportsModelSignals(client)
  ? selected.length * 2
  : 0;
const analyses = await mapWithConcurrency(selected, concurrency, async (fixture) => {
  try {
    const [result, modelSignals] = await Promise.all([
      client.getFixtureOdds(fixture.fixture.id),
      modelSignalsEnabled ? getModelSignals(client, fixture.fixture.id) : null
    ]);
    if (!result.data[0]) return null;
    return analyzeOdds(fixture, result.data, {
      agentConfig: config.oddsAgent,
      calibrationStats,
      modelSignals
    });
  } catch (error) {
    console.warn(`Skipped fixture ${fixture.fixture.id}: ${error.message}`);
    return null;
  }
});
const candidates = rankDigestCandidates(analyses.filter(Boolean), maxPicks);
const report = {
  date: localDate(now, timezone),
  generatedAt: now.toISOString(),
  windowStart: now.toISOString(),
  windowEnd: windowEnd.toISOString(),
  windowHours,
  timezone,
  fixturesFound: fixtures.length,
  upcomingFound: selected.length,
  analyzed: selected.length,
  requestsUsed: dates.length + selected.length + settlement.checked + modelSignalRequests,
  modelSignalRequests,
  modelSignalsEnabled,
  settled: settlement.settled,
  settlementChecked: settlement.checked,
  candidates
};

fs.mkdirSync(path.resolve("data"), { recursive: true });
const fileStamp = timestampForFile(now, timezone);
const reportPath = path.resolve("data", `digest-${fileStamp}.json`);
const htmlPath = path.resolve("data", `digest-${fileStamp}.html`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(htmlPath, renderDigestHtml(report));
calibrationStore.appendDigestCandidates(report);

if (!dryRun) {
  await mailer.send(report);
  console.log(
    `Rolling digest emailed: ${candidates.length} picks from ${selected.length} analyses.`
  );
} else {
  console.log(`Dry run complete: ${htmlPath}`);
}

function createDigestClient() {
  const provider = String(process.env.FOOTBALL_PROVIDER ?? "sportmonks").toLowerCase();
  if (provider === "api-football" || provider === "api_football") {
    return new ApiFootballClient({ apiKey: process.env.API_FOOTBALL_KEY });
  }
  if (provider === "sportmonks" || provider === "sportsmonks" || provider === "sportsmonk") {
    return new SportMonksClient({
      apiToken: process.env.SPORTMONKS_API_TOKEN,
      authMode: process.env.SPORTMONKS_AUTH_MODE
    });
  }
  throw new Error(`Unsupported FOOTBALL_PROVIDER: ${provider}`);
}

function supportsModelSignals(client) {
  return (
    typeof client.getFixtureProbabilities === "function" ||
    typeof client.getFixtureValueBets === "function"
  );
}

async function getModelSignals(client, fixtureId) {
  const [probabilities, valueBets] = await Promise.all([
    optionalProviderCall(client, "getFixtureProbabilities", fixtureId),
    optionalProviderCall(client, "getFixtureValueBets", fixtureId)
  ]);
  if (!probabilities && !valueBets) return null;
  return {
    probabilities: probabilities?.data ?? [],
    valueBets: valueBets?.data ?? []
  };
}

async function optionalProviderCall(client, method, fixtureId) {
  if (typeof client[method] !== "function") return null;
  try {
    return await client[method](fixtureId);
  } catch (error) {
    console.warn(`Skipped ${method} for fixture ${fixtureId}: ${error.message}`);
    return null;
  }
}

async function settlePendingCandidates({ client, store, now, concurrency }) {
  const pending = store.loadPendingCandidates({ now });
  const settled = await mapWithConcurrency(pending, concurrency, async (candidate) => {
    try {
      const result = await client.getFixtureById(candidate.fixtureId);
      const fixture = result.data[0];
      if (!fixture) return null;
      return settleCandidate(candidate, fixture);
    } catch (error) {
      console.warn(`Skipped settlement for fixture ${candidate.fixtureId}: ${error.message}`);
      return null;
    }
  });

  let settledCount = 0;
  for (const result of settled.filter(Boolean)) {
    store.appendSettledResult(result);
    settledCount++;
  }
  return { checked: pending.length, settled: settledCount };
}

function uniqueLocalDates(start, end, timeZone) {
  return [...new Set([localDate(start, timeZone), localDate(end, timeZone)])];
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve("config.json"), "utf8"));
  } catch {
    return {};
  }
}

function configuredList(envKey, fallback = []) {
  if (process.env[envKey]) {
    return process.env[envKey].split(",").map((value) => value.trim());
  }
  return fallback;
}

function configuredOddsAgent(fallback = {}) {
  return {
    ...fallback,
    enabled: parseBoolean(process.env.ODDS_AGENT_ENABLED, fallback.enabled),
    minimumBookmakers: configuredNumber("ODDS_AGENT_MINIMUM_BOOKMAKERS", fallback.minimumBookmakers),
    minimumTopProbability: configuredNumber("ODDS_AGENT_MINIMUM_TOP_PROBABILITY", fallback.minimumTopProbability),
    minimumEdge: configuredNumber("ODDS_AGENT_MINIMUM_EDGE", fallback.minimumEdge),
    minimumOdd: configuredNumber("ODDS_AGENT_MINIMUM_ODD", fallback.minimumOdd),
    maximumOdd: configuredNumber("ODDS_AGENT_MAXIMUM_ODD", fallback.maximumOdd),
    maximumPriceSpread: configuredNumber("ODDS_AGENT_MAXIMUM_PRICE_SPREAD", fallback.maximumPriceSpread)
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

function localDate(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function timestampForFile(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}-${lookup.hour}${lookup.minute}`;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
