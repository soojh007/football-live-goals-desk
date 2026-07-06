import fs from "node:fs";
import path from "node:path";
import { normalizeStatistics, evaluateFixture } from "./signal-engine.js";

export class LiveMonitor {
  constructor({
    client,
    store,
    alerts,
    configPath = path.resolve("config.json"),
    statisticsRefreshSeconds = 120,
    unavailableRetrySeconds = 900,
    oddsRefreshSeconds = 300
  }) {
    this.client = client;
    this.store = store;
    this.alerts = alerts;
    this.configPath = configPath;
    this.statisticsRefreshMs = statisticsRefreshSeconds * 1000;
    this.unavailableRetryMs = unavailableRetrySeconds * 1000;
    this.oddsRefreshMs = oddsRefreshSeconds * 1000;
    this.previousStatistics = new Map();
    this.fixtureCache = new Map();
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
        const cached = this.fixtureCache.get(fixtureId);
        const now = Date.now();
        if (cached && now - cached.statisticsFetchedAt < cacheDuration(cached, this)) {
          if (hasSameLiveState(cached.evaluated, fixture)) {
            return updateLiveState(cached.evaluated, fixture);
          }
          cached.evaluated = evaluateFixture({
            fixture,
            statistics: cached.evaluated.statistics,
            previousStatistics: null,
            oddsResponse: cached.odds,
            config
          });
          return cached.evaluated;
        }

        const statsResult = await this.client.getFixtureStatistics(fixtureId);
        const statistics = normalizeStatistics(statsResult.data);
        const previous = this.previousStatistics.get(fixtureId);
        let odds = cached?.odds ?? [];
        let oddsFetchedAt = cached?.oddsFetchedAt ?? 0;
        let evaluated = evaluateFixture({
          fixture,
          statistics,
          previousStatistics: previous,
          oddsResponse: odds,
          config
        });

        if (
          hasAlertCandidate(evaluated) &&
          now - oddsFetchedAt >= this.oddsRefreshMs
        ) {
          try {
            const oddsResult = await this.client.getLiveOdds(fixtureId);
            odds = oddsResult.data;
            oddsFetchedAt = now;
            evaluated = evaluateFixture({
              fixture,
              statistics,
              previousStatistics: previous,
              oddsResponse: odds,
              config
            });
          } catch {
            // Statistics-based signals remain useful when live odds are unavailable.
          }
        }

        this.previousStatistics.set(fixtureId, statistics);
        this.fixtureCache.set(fixtureId, {
          evaluated,
          odds,
          oddsFetchedAt,
          statisticsFetchedAt: now
        });
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
      let alertResults = [];
      if (this.alerts) {
        try {
          alertResults = await this.alerts.notify(details);
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
          sent: alertResults.length,
          error: alertError
        },
        fixtures: details.sort(sortFixtures)
      };
      pruneFixtureCache(this.fixtureCache, new Set(relevant.map((fixture) => fixture.fixture.id)));
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

function cacheDuration(cached, monitor) {
  return cached.evaluated.hasStatistics
    ? monitor.statisticsRefreshMs
    : monitor.unavailableRetryMs;
}

function hasAlertCandidate(evaluated) {
  return evaluated.signals.some((signal) => signal.level !== "pass");
}

function updateLiveState(evaluated, fixture) {
  return {
    ...evaluated,
    minute: Number(fixture.fixture?.status?.elapsed ?? evaluated.minute),
    status: fixture.fixture?.status?.short ?? evaluated.status,
    score: `${fixture.goals?.home ?? 0}-${fixture.goals?.away ?? 0}`
  };
}

function hasSameLiveState(evaluated, fixture) {
  const score = `${fixture.goals?.home ?? 0}-${fixture.goals?.away ?? 0}`;
  const status = fixture.fixture?.status?.short ?? evaluated.status;
  return evaluated.score === score && evaluated.status === status;
}

function pruneFixtureCache(cache, activeFixtureIds) {
  for (const fixtureId of cache.keys()) {
    if (!activeFixtureIds.has(fixtureId)) cache.delete(fixtureId);
  }
}

function isRelevantFixture(fixture, config) {
  const minute = Number(fixture.fixture?.status?.elapsed ?? 0);
  const status = fixture.fixture?.status?.short;
  const filters = {
    countries: new Set((config.liveCountries ?? []).map(normalizeFilterValue)),
    leagues: new Set((config.liveLeagues ?? []).map(normalizeFilterValue))
  };
  return (
    fixtureAllowed(fixture, filters) &&
    ["1H", "HT", "2H"].includes(status) &&
    minute >= Math.min(config.halftimeOver05.startMinute, config.totalGoals.startMinute) &&
    minute <= Math.max(config.halftimeOver05.endMinute, config.totalGoals.endMinute)
  );
}

function fixtureAllowed(fixture, filters) {
  if (!filters.countries.size && !filters.leagues.size) return true;
  return (
    filters.countries.has(normalizeFilterValue(fixture.league?.country)) ||
    filters.leagues.has(normalizeFilterValue(fixture.league?.name))
  );
}

function normalizeFilterValue(value) {
  return String(value ?? "").trim().toLowerCase();
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
  return b.minute - a.minute || bBest - aBest;
}
