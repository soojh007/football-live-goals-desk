import {
  analyzePrediction,
  rankDigestCandidates,
  selectUpcomingFixtures
} from "./digest-engine.js";

export class ShortlistService {
  constructor({
    client,
    timezone = "Asia/Singapore",
    windowHours = 3,
    maxAnalyses = 15,
    maxPicks = 10,
    concurrency = 4,
    cooldownMinutes = 15,
    now = () => new Date()
  }) {
    this.client = client;
    this.timezone = timezone;
    this.windowHours = windowHours;
    this.maxAnalyses = maxAnalyses;
    this.maxPicks = maxPicks;
    this.concurrency = concurrency;
    this.cooldownMs = cooldownMinutes * 60_000;
    this.now = now;
    this.running = null;
    this.report = null;
  }

  getState() {
    const nextAllowedAt = this.report
      ? new Date(new Date(this.report.generatedAt).getTime() + this.cooldownMs).toISOString()
      : null;
    return {
      loading: Boolean(this.running),
      report: this.report,
      nextAllowedAt
    };
  }

  async generate() {
    if (this.running) return this.running;

    const currentTime = this.now();
    const generatedAt = this.report ? new Date(this.report.generatedAt).getTime() : 0;
    if (generatedAt && currentTime.getTime() - generatedAt < this.cooldownMs) {
      const error = new Error("A fresh list is already available. Please wait for the cooldown.");
      error.statusCode = 429;
      error.state = this.getState();
      throw error;
    }

    this.running = this.#run(currentTime).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async #run(start) {
    const end = new Date(start.getTime() + this.windowHours * 60 * 60_000);
    const dates = uniqueLocalDates(start, end, this.timezone);
    const fixtureResults = await Promise.all(
      dates.map((date) => this.client.getFixturesByDate(date, this.timezone))
    );
    const fixtures = fixtureResults.flatMap((result) => result.data);
    const selected = selectUpcomingFixtures(fixtures, {
      maxAnalyses: this.maxAnalyses,
      start,
      end
    });
    const analyses = await mapWithConcurrency(
      selected,
      this.concurrency,
      async (fixture) => {
        try {
          const result = await this.client.getPrediction(fixture.fixture.id);
          return result.data[0] ? analyzePrediction(fixture, result.data[0]) : null;
        } catch (error) {
          console.warn(`Skipped fixture ${fixture.fixture.id}: ${error.message}`);
          return null;
        }
      }
    );

    this.report = {
      generatedAt: start.toISOString(),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      timezone: this.timezone,
      fixturesFound: fixtures.length,
      upcomingFound: selected.length,
      analyzed: selected.length,
      requestsUsed: dates.length + selected.length,
      remainingRequests: fixtureResults.findLast((result) => result.remaining)?.remaining ?? null,
      candidates: rankDigestCandidates(analyses.filter(Boolean), this.maxPicks)
    };
    return this.getState();
  }
}

function uniqueLocalDates(start, end, timezone) {
  return [...new Set([localDate(start, timezone), localDate(end, timezone)])];
}

function localDate(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
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
