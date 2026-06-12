import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFixture,
  extractMatchContext,
  extractGoalMarkets,
  normalizeStatistics
} from "../src/signal-engine.js";

const config = {
  minimumSignalScore: 58,
  halftimeOver05: {
    enabled: true,
    startMinute: 25,
    endMinute: 43,
    minimumShotsOnTarget: 2,
    minimumTotalShots: 7,
    minimumCorners: 2,
    minimumRecentShots: 2
  },
  totalGoals: {
    enabled: true,
    startMinute: 15,
    endMinute: 82,
    minimumShotsOnTarget: 3,
    minimumTotalShots: 9,
    minimumCorners: 3,
    minimumRecentShots: 2
  }
};

test("normalizes and combines team statistics", () => {
  const result = normalizeStatistics([
    { statistics: [{ type: "Shots on Goal", value: 3 }, { type: "Ball Possession", value: "62%" }] },
    { statistics: [{ type: "Shots on Goal", value: 2 }, { type: "Ball Possession", value: "38%" }] }
  ]);
  assert.equal(result.shotsOnTarget, 5);
  assert.equal(result.possession, 100);
});

test("creates a strong halftime goal signal from sustained pressure", () => {
  const fixture = makeFixture({ minute: 38, status: "1H", homeGoals: 0, awayGoals: 0 });
  const result = evaluateFixture({
    fixture,
    statistics: { shotsOnTarget: 5, totalShots: 14, corners: 5, possession: 100, shotsInsideBox: 8 },
    previousStatistics: { shotsOnTarget: 3, totalShots: 10, corners: 4, possession: 100, shotsInsideBox: 5 },
    oddsResponse: [],
    config
  });
  const signal = result.signals.find((item) => item.type === "HT_OVER_0_5");
  assert.equal(signal.level, "strong");
  assert.ok(signal.score >= 78);
});

test("does not create halftime over 0.5 signal after a goal", () => {
  const result = evaluateFixture({
    fixture: makeFixture({ minute: 35, status: "1H", homeGoals: 1, awayGoals: 0 }),
    statistics: { shotsOnTarget: 4, totalShots: 10, corners: 3, possession: 100, shotsInsideBox: 6 },
    oddsResponse: [],
    config
  });
  assert.equal(result.signals.some((item) => item.type === "HT_OVER_0_5"), false);
});

test("does not generate totals signals without live statistics", () => {
  const result = evaluateFixture({
    fixture: makeFixture({ minute: 17, status: "1H", homeGoals: 1, awayGoals: 1 }),
    statistics: {
      shotsOnTarget: 0,
      totalShots: 0,
      corners: 0,
      possession: 0,
      shotsInsideBox: 0
    },
    oddsResponse: [],
    config
  });

  assert.equal(result.hasStatistics, false);
  assert.deepEqual(result.signals, []);
});

test("extracts the best matching goal market data", () => {
  const markets = extractGoalMarkets([
    {
      odds: [{
        name: "Book A",
        bets: [{ name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.91" }] }]
      }]
    }
  ]);
  assert.deepEqual(markets[0], {
    bookmaker: "Book A",
    market: "Goals Over/Under",
    side: "Over",
    line: 2.5,
    odd: 1.91,
    suspended: false
  });
});

test("surfaces red cards as unstable match context", () => {
  const context = extractMatchContext([
    {
      time: { elapsed: 31 },
      team: { name: "Home" },
      player: { name: "Player A" },
      type: "Card",
      detail: "Red Card"
    }
  ]);
  assert.equal(context.redCards.length, 1);
  assert.equal(context.warnings[0], "Red card: Home at 31'");
});

function makeFixture({ minute, status, homeGoals, awayGoals }) {
  return {
    fixture: { id: 123, status: { elapsed: minute, short: status } },
    league: { name: "Test League", country: "Test" },
    teams: { home: { name: "Home" }, away: { name: "Away" } },
    goals: { home: homeGoals, away: awayGoals }
  };
}
