import test from "node:test";
import assert from "node:assert/strict";
import { LiveMonitor } from "../src/monitor.js";

test("caches statistics and only requests odds for actionable signals", async () => {
  const calls = { live: 0, statistics: 0, odds: 0 };
  const client = {
    async getLiveFixtures() {
      calls.live++;
      return { data: [makeFixture()], remaining: "7000" };
    },
    async getFixtureStatistics() {
      calls.statistics++;
      return { data: makeStatistics() };
    },
    async getLiveOdds() {
      calls.odds++;
      return { data: [] };
    }
  };
  const monitor = new LiveMonitor({
    client,
    store: { append() {} },
    configPath: new URL("../config.json", import.meta.url),
    statisticsRefreshSeconds: 120,
    oddsRefreshSeconds: 300
  });

  await monitor.poll();
  await monitor.poll();

  assert.equal(calls.live, 2);
  assert.equal(calls.statistics, 1);
  assert.equal(calls.odds, 1);
});

test("removes cached halftime signal immediately after a goal", async () => {
  let homeGoals = 0;
  const client = {
    async getLiveFixtures() {
      return {
        data: [{ ...makeFixture(), goals: { home: homeGoals, away: 0 } }],
        remaining: "7000"
      };
    },
    async getFixtureStatistics() {
      return { data: makeStatistics() };
    },
    async getLiveOdds() {
      return { data: [] };
    }
  };
  const monitor = new LiveMonitor({
    client,
    store: { append() {} },
    configPath: new URL("../config.json", import.meta.url),
    statisticsRefreshSeconds: 120
  });

  await monitor.poll();
  assert.equal(
    monitor.state.fixtures[0].signals.some((signal) => signal.type === "HT_OVER_0_5"),
    true
  );

  homeGoals = 1;
  await monitor.poll();
  assert.equal(
    monitor.state.fixtures[0].signals.some((signal) => signal.type === "HT_OVER_0_5"),
    false
  );
});

test("orders live fixtures by match time before signal score", async () => {
  const client = {
    async getLiveFixtures() {
      return {
        data: [
          makeFixture({ id: 123, minute: 30 }),
          makeFixture({ id: 456, minute: 40 })
        ],
        remaining: "7000"
      };
    },
    async getFixtureStatistics(fixtureId) {
      return {
        data: fixtureId === 123 ? makeStatistics() : makeQuietStatistics()
      };
    },
    async getLiveOdds() {
      return { data: [] };
    }
  };
  const monitor = new LiveMonitor({
    client,
    store: { append() {} },
    configPath: new URL("../config.json", import.meta.url),
    statisticsRefreshSeconds: 120
  });

  await monitor.poll();

  assert.deepEqual(
    monitor.state.fixtures.map((fixture) => fixture.fixtureId),
    [456, 123]
  );
});

test("monitors only configured live countries", async () => {
  const calls = { statistics: [] };
  const client = {
    async getLiveFixtures() {
      return {
        data: [
          makeFixture({ id: 123, country: "Japan" }),
          makeFixture({ id: 456, country: "Portugal" })
        ],
        remaining: "7000"
      };
    },
    async getFixtureStatistics(fixtureId) {
      calls.statistics.push(fixtureId);
      return { data: makeStatistics() };
    },
    async getLiveOdds() {
      return { data: [] };
    }
  };
  const monitor = new LiveMonitor({
    client,
    store: { append() {} },
    configPath: new URL("../config.json", import.meta.url)
  });

  await monitor.poll();

  assert.deepEqual(calls.statistics, [123]);
  assert.deepEqual(
    monitor.state.fixtures.map((fixture) => fixture.country),
    ["Japan"]
  );
});

test("monitors configured live leagues outside configured countries", async () => {
  const calls = { statistics: [] };
  const client = {
    async getLiveFixtures() {
      return {
        data: [
          makeFixture({ id: 123, country: "World", league: "World Cup" }),
          makeFixture({ id: 456, country: "World", league: "Friendly" })
        ],
        remaining: "7000"
      };
    },
    async getFixtureStatistics(fixtureId) {
      calls.statistics.push(fixtureId);
      return { data: makeStatistics() };
    },
    async getLiveOdds() {
      return { data: [] };
    }
  };
  const monitor = new LiveMonitor({
    client,
    store: { append() {} },
    configPath: new URL("../config.json", import.meta.url)
  });

  await monitor.poll();

  assert.deepEqual(calls.statistics, [123]);
  assert.deepEqual(
    monitor.state.fixtures.map((fixture) => fixture.league),
    ["World Cup"]
  );
});

function makeFixture({ id = 123, minute = 36, country = "Japan", league = "Test League" } = {}) {
  return {
    fixture: { id, status: { elapsed: minute, short: "1H" } },
    league: { name: league, country },
    teams: { home: { name: "Home" }, away: { name: "Away" } },
    goals: { home: 0, away: 0 }
  };
}

function makeStatistics() {
  return [
    {
      statistics: [
        { type: "Shots on Goal", value: 3 },
        { type: "Total Shots", value: 8 },
        { type: "Corner Kicks", value: 2 },
        { type: "Shots insidebox", value: 5 }
      ]
    },
    {
      statistics: [
        { type: "Shots on Goal", value: 2 },
        { type: "Total Shots", value: 5 },
        { type: "Corner Kicks", value: 2 },
        { type: "Shots insidebox", value: 3 }
      ]
    }
  ];
}

function makeQuietStatistics() {
  return [
    {
      statistics: [
        { type: "Shots on Goal", value: 1 },
        { type: "Total Shots", value: 2 },
        { type: "Corner Kicks", value: 0 },
        { type: "Shots insidebox", value: 1 }
      ]
    },
    {
      statistics: [
        { type: "Shots on Goal", value: 0 },
        { type: "Total Shots", value: 1 },
        { type: "Corner Kicks", value: 0 },
        { type: "Shots insidebox", value: 0 }
      ]
    }
  ];
}
