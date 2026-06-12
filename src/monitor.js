import fs from "node:fs";
import path from "node:path";
import { normalizeStatistics, evaluateFixture } from "./signal-engine.js";

export class LiveMonitor {
  constructor({ client, store, alerts, configPath = path.resolve("config.json") }) {
    this.client = client;
    this.store = store;
    this.alerts = alerts;
    this.configPath = configPath;
    this.previousStatistics = new Map();
    this.state = {
      updatedAt: null,
      loading: false,
      error: null,
      remainingRequests: null,
      alerts: {
        enabled: Boolean(alerts?.enabled),
        lastResult: null
      },
      fixtures: []
    };
  }

  getConfig() {
    return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
  }

  async poll() {
    if (this.state.loading) return this.state;
    this.state.loading = true;
    this.state.error = null;

    try {
      const config = this.getConfig();
      const live = await this.client.getLiveFixtures(config.timezone);
      const relevant = live.data.filter((fixture) => isRelevantFixture(fixture, config));

      const details = await mapWithConcurrency(relevant, 4, async (fixture) => {
        const fixtureId = fixture.fixture.id;
        const [statsResult, oddsResult] = await Promise.allSettled([
          this.client.getFixtureStatistics(fixtureId),
          this.client.getLiveOdds(fixtureId)
        ]);

        const statistics = normalizeStatistics(
          statsResult.status === "fulfilled" ? statsResult.value.data : []
        );
        const previous = this.previousStatistics.get(fixtureId);
        const odds = oddsResult.status === "fulfilled" ? oddsResult.value.data : [];
        const evaluated = evaluateFixture({
          fixture,
          statistics,
          previousStatistics: previous,
          oddsResponse: odds,
          config
        });

        this.previousStatistics.set(fixtureId, statistics);
        this.store.append("signals", {
          fixtureId,
          minute: evaluated.minute,
          score: evaluated.score,
          statistics,
          signals: evaluated.signals,
          odds
        });
        return evaluated;
      });

      let alertError = null;
      if (this.alerts) {
        try {
          await this.alerts.notify(details);
        } catch (error) {
          alertError = error.message;
        }
      }

      this.state = {
        updatedAt: new Date().toISOString(),
        loading: false,
        error: null,
        remainingRequests: live.remaining,
        alerts: {
          enabled: Boolean(this.alerts?.enabled),
          lastResult: this.alerts?.lastResult ?? null,
          error: alertError
        },
        fixtures: details.sort(sortFixtures)
      };
    } catch (error) {
      this.state = {
        ...this.state,
        updatedAt: new Date().toISOString(),
        loading: false,
        error: error.message
      };
    }
    return this.state;
  }
}

function isRelevantFixture(fixture, config) {
  const minute = Number(fixture.fixture?.status?.elapsed ?? 0);
  const status = fixture.fixture?.status?.short;
  return (
    ["1H", "HT", "2H"].includes(status) &&
    minute >= Math.min(config.halftimeOver05.startMinute, config.totalGoals.startMinute) &&
    minute <= Math.max(config.halftimeOver05.endMinute, config.totalGoals.endMinute)
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function sortFixtures(a, b) {
  const aBest = Math.max(0, ...a.signals.map((signal) => signal.score));
  const bBest = Math.max(0, ...b.signals.map((signal) => signal.score));
  return bBest - aBest || b.minute - a.minute;
}
