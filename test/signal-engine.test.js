import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFixture,
  extractMatchContext,
  extractGoalMarkets,
  extractMatchWinnerMarkets,
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
  },
  matchWinner: {
    enabled: true,
    startMinute: 10,
    endMinute: 82,
    minimumBookmakers: 1,
    minimumProbability: 0.58,
    minimumEdge: 0.08
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

test("names the exact half-goal line in totals signals", () => {
  const result = evaluateFixture({
    fixture: makeFixture({ minute: 28, status: "1H", homeGoals: 1, awayGoals: 1 }),
    statistics: {
      shotsOnTarget: 5,
      totalShots: 13,
      corners: 4,
      possession: 100,
      shotsInsideBox: 7
    },
    previousStatistics: {
      shotsOnTarget: 3,
      totalShots: 9,
      corners: 3,
      possession: 100,
      shotsInsideBox: 5
    },
    oddsResponse: [],
    config
  });
  const signal = result.signals.find((item) => item.type === "TOTAL_OVER");

  assert.equal(signal.line, 3.5);
  assert.equal(signal.label, "Likely over 3.5 total goals");
});

test("uses the closest available live total line in the label", () => {
  const result = evaluateFixture({
    fixture: makeFixture({ minute: 55, status: "2H", homeGoals: 1, awayGoals: 0 }),
    statistics: {
      shotsOnTarget: 1,
      totalShots: 5,
      corners: 1,
      possession: 100,
      shotsInsideBox: 2
    },
    previousStatistics: {
      shotsOnTarget: 1,
      totalShots: 5,
      corners: 1,
      possession: 100,
      shotsInsideBox: 2
    },
    oddsResponse: [
      {
        odds: [
          {
            name: "Book A",
            bets: [
              {
                name: "Goals Over/Under",
                values: [{ value: "Under 2.5", odd: "1.80" }]
              }
            ]
          }
        ]
      }
    ],
    config
  });
  const signal = result.signals.find((item) => item.type === "TOTAL_UNDER");

  assert.equal(signal.line, 2.5);
  assert.equal(signal.label, "Likely under 2.5 total goals");
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

test("extracts live 1X2 market data", () => {
  const market = extractMatchWinnerMarkets({
    home: "Home",
    away: "Away",
    oddsResponse: [
      {
        odds: [{
          name: "Book A",
          bets: [{
            name: "Match Winner",
            values: [
              { value: "Home", odd: "1.80" },
              { value: "Draw", odd: "3.60" },
              { value: "Away", odd: "4.80" }
            ]
          }]
        }]
      }
    ]
  });

  assert.equal(market.bookmakers, 1);
  assert.equal(market.bestPrices.home.odd, 1.8);
  assert.equal(market.bestPrices.home.label, "Home");
  assert.ok(market.probabilities.home > market.probabilities.draw);
});

test("creates a live 1X2 signal from match winner odds", () => {
  const result = evaluateFixture({
    fixture: makeFixture({ minute: 30, status: "1H", homeGoals: 0, awayGoals: 0 }),
    statistics: { shotsOnTarget: 0, totalShots: 0, corners: 0, possession: 0, shotsInsideBox: 0 },
    oddsResponse: [
      {
        odds: [{
          name: "Book A",
          bets: [{
            name: "Match Winner",
            values: [
              { value: "Home", odd: "1.55" },
              { value: "Draw", odd: "4.00" },
              { value: "Away", odd: "6.00" }
            ]
          }]
        }]
      }
    ],
    config
  });
  const signal = result.signals.find((item) => item.type === "LIVE_1X2_HOME");

  assert.equal(result.hasStatistics, false);
  assert.equal(signal.label, "Live 1X2 lean: Home");
  assert.equal(signal.price.label, "Home");
  assert.equal(signal.level, "watch");
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
