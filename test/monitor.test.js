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

function makeFixture() {
  return {
    fixture: { id: 123, status: { elapsed: 36, short: "1H" } },
    league: { name: "Test League", country: "Test" },
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
