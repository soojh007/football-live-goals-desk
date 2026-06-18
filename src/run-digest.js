import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.js";
import { ApiFootballClient } from "./api-football.js";
import {
  analyzePrediction,
  rankDigestCandidates,
  selectUpcomingFixtures
} from "./digest-engine.js";
import { DigestEmail, renderDigestHtml } from "./digest-email.js";

loadEnv();

const timezone = process.env.DIGEST_TIMEZONE ?? "Asia/Singapore";
const now = new Date();
const windowHours = clampInteger(process.env.DIGEST_WINDOW_HOURS, 6, 1, 12);
const windowEnd = new Date(now.getTime() + windowHours * 60 * 60_000);
const dates = uniqueLocalDates(now, windowEnd, timezone);
const maxAnalyses = clampInteger(process.env.DIGEST_MAX_ANALYSES, 25, 1, 100);
const maxPicks = clampInteger(process.env.DIGEST_MAX_PICKS, 12, 1, 30);
const concurrency = clampInteger(process.env.DIGEST_CONCURRENCY, 4, 1, 8);
const dryRun = process.argv.includes("--dry-run");
const client = new ApiFootballClient({ apiKey: process.env.API_FOOTBALL_KEY });
const mailer = new DigestEmail({
  apiKey: process.env.RESEND_API_KEY,
  to: process.env.ALERT_EMAIL_TO,
  from: process.env.DIGEST_EMAIL_FROM ?? process.env.ALERT_EMAIL_FROM
});

const fixtureResults = await Promise.all(
  dates.map((date) => client.getFixturesByDate(date, timezone))
);
const fixtures = fixtureResults.flatMap((result) => result.data);
const selected = selectUpcomingFixtures(fixtures, {
  maxAnalyses,
  start: now,
  end: windowEnd
});
const analyses = await mapWithConcurrency(selected, concurrency, async (fixture) => {
  try {
    const result = await client.getPrediction(fixture.fixture.id);
    if (!result.data[0]) return null;
    return analyzePrediction(fixture, result.data[0]);
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
  requestsUsed: dates.length + selected.length,
  candidates
};

fs.mkdirSync(path.resolve("data"), { recursive: true });
const fileStamp = timestampForFile(now, timezone);
const reportPath = path.resolve("data", `digest-${fileStamp}.json`);
const htmlPath = path.resolve("data", `digest-${fileStamp}.html`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(htmlPath, renderDigestHtml(report));

if (!dryRun) {
  await mailer.send(report);
  console.log(
    `Rolling digest emailed: ${candidates.length} picks from ${selected.length} analyses.`
  );
} else {
  console.log(`Dry run complete: ${htmlPath}`);
}

function uniqueLocalDates(start, end, timeZone) {
  return [...new Set([localDate(start, timeZone), localDate(end, timeZone)])];
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
