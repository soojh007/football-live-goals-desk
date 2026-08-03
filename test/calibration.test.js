import test from "node:test";
import assert from "node:assert/strict";
import { buildCalibrationStats, settleCandidate } from "../src/calibration.js";

test("settles 1X2 candidates against final score", () => {
  const result = settleCandidate(
    {
      fixtureId: 1,
      kickoff: "2026-06-13T18:00:00+08:00",
      country: "Japan",
      league: "J1 League",
      marketType: "1X2",
      selection: "home",
      selectedOdd: 1.9
    },
    makeFinishedFixture({ homeGoals: 2, awayGoals: 1 })
  );

  assert.equal(result.outcome, "win");
  assert.equal(result.profit, 0.9);
});

test("settles Asian Handicap push and quarter lines", () => {
  const push = settleCandidate(
    {
      fixtureId: 1,
      kickoff: "2026-06-13T18:00:00+08:00",
      country: "Japan",
      league: "J1 League",
      marketType: "AH",
      selection: "home",
      handicapLine: 0,
      selectedOdd: 1.9
    },
    makeFinishedFixture({ homeGoals: 1, awayGoals: 1 })
  );
  const halfWin = settleCandidate(
    {
      fixtureId: 2,
      kickoff: "2026-06-13T18:00:00+08:00",
      country: "Japan",
      league: "J1 League",
      marketType: "AH",
      selection: "home",
      handicapLine: -0.25,
      selectedOdd: 2
    },
    makeFinishedFixture({ homeGoals: 1, awayGoals: 1 })
  );

  assert.equal(push.outcome, "push");
  assert.equal(push.profit, 0);
  assert.equal(halfWin.outcome, "half-loss");
  assert.equal(halfWin.profit, -0.5);
});

test("builds calibration stats with league and market fallback", () => {
  const stats = buildCalibrationStats(
    [
      result({ fixtureId: 1, country: "Japan", league: "J1 League", marketType: "1X2", outcome: "win", profit: 0.8 }),
      result({ fixtureId: 2, country: "Japan", league: "J1 League", marketType: "1X2", outcome: "loss", profit: -1 }),
      result({ fixtureId: 3, country: "Korea", league: "K League 1", marketType: "1X2", outcome: "win", profit: 0.9 })
    ],
    { minimumSamples: 2 }
  );

  const league = stats.forCandidate({
    country: "Japan",
    league: "J1 League",
    marketType: "1X2"
  });
  const fallback = stats.forCandidate({
    country: "Sweden",
    league: "Allsvenskan",
    marketType: "1X2"
  });

  assert.equal(league.scope, "league-market");
  assert.equal(league.samples, 2);
  assert.equal(fallback.scope, "market");
  assert.equal(fallback.samples, 3);
});

function makeFinishedFixture({ homeGoals, awayGoals }) {
  return {
    fixture: { status: { short: "FT" } },
    goals: { home: homeGoals, away: awayGoals }
  };
}

function result({
  fixtureId,
  country,
  league,
  marketType,
  outcome,
  profit
}) {
  return {
    key: `${fixtureId}:${marketType}:home:`,
    fixtureId,
    country,
    league,
    marketType,
    selection: "home",
    selectedOdd: 1.8,
    outcome,
    staked: 1,
    profit
  };
}
