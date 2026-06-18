import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePrediction,
  rankDigestCandidates,
  selectDigestFixtures,
  selectUpcomingFixtures
} from "../src/digest-engine.js";

test("selects fixtures across countries before taking second matches", () => {
  const fixtures = [
    makeFixture(1, "England", "2026-06-13T10:00:00+08:00"),
    makeFixture(2, "England", "2026-06-13T11:00:00+08:00"),
    makeFixture(3, "Japan", "2026-06-13T12:00:00+08:00"),
    makeFixture(4, "Brazil", "2026-06-13T13:00:00+08:00")
  ];
  const selected = selectDigestFixtures(fixtures, {
    maxAnalyses: 3,
    now: new Date("2026-06-13T00:00:00+08:00")
  });

  assert.deepEqual(
    new Set(selected.map((fixture) => fixture.league.country)),
    new Set(["Brazil", "England", "Japan"])
  );
});

test("selects only fixtures inside the upcoming digest window", () => {
  const fixtures = [
    makeFixture(1, "England", "2026-06-13T09:59:00+08:00"),
    makeFixture(2, "Japan", "2026-06-13T10:00:00+08:00"),
    makeFixture(3, "Brazil", "2026-06-13T15:59:00+08:00"),
    makeFixture(4, "Peru", "2026-06-13T16:01:00+08:00")
  ];
  const selected = selectUpcomingFixtures(fixtures, {
    maxAnalyses: 10,
    start: new Date("2026-06-13T10:00:00+08:00"),
    end: new Date("2026-06-13T16:00:00+08:00")
  });

  assert.deepEqual(selected.map((fixture) => fixture.fixture.id).sort(), [2, 3]);
});

test("analyses explicit over 2.5 candidate from team goal averages", () => {
  const candidate = analyzePrediction(
    makeFixture(1, "Netherlands", "2026-06-13T18:00:00+08:00"),
    makePrediction({
      homeFor: 2.2,
      homeAgainst: 1.4,
      awayFor: 1.8,
      awayAgainst: 1.7,
      underOver: "+2.5"
    })
  );

  assert.equal(candidate.side, "OVER_2_5");
  assert.equal(candidate.label, "Likely over 2.5");
  assert.deepEqual(candidate.mainSignal, {
    market: "Total goals 2.5",
    pick: "Over 2.5",
    label: "Likely over 2.5"
  });
  assert.ok(candidate.projectedGoals > 3);
});

test("analyses explicit under 2.5 candidate from low-scoring teams", () => {
  const candidate = analyzePrediction(
    makeFixture(1, "Tunisia", "2026-06-13T18:00:00+08:00"),
    makePrediction({
      homeFor: 0.8,
      homeAgainst: 0.7,
      awayFor: 0.6,
      awayAgainst: 0.9,
      underOver: "-2.5"
    })
  );

  assert.equal(candidate.side, "UNDER_2_5");
  assert.equal(candidate.label, "Likely under 2.5");
  assert.ok(candidate.projectedGoals < 2);
});

test("ranks higher-quality candidates first and respects output limit", () => {
  const ranked = rankDigestCandidates([
    { rankScore: 75, dataQuality: "medium" },
    { rankScore: 60, dataQuality: "high" },
    { rankScore: 74, dataQuality: "limited" },
    { rankScore: 70, dataQuality: "high" }
  ], 2);

  assert.deepEqual(ranked.map((item) => item.rankScore), [70, 60]);
});

function makeFixture(id, country, date) {
  return {
    fixture: { id, date, status: { short: "NS" } },
    league: { name: `${country} League`, country },
    teams: {
      home: { id: id * 10, name: `Home ${id}` },
      away: { id: id * 10 + 1, name: `Away ${id}` }
    }
  };
}

function makePrediction({ homeFor, homeAgainst, awayFor, awayAgainst, underOver }) {
  return {
    predictions: {
      advice: underOver.startsWith("+") ? "Winner or over 2.5" : "Under 2.5",
      under_over: underOver,
      percent: { home: "45%", draw: "25%", away: "30%" },
      winner: { name: "Home", comment: "Win or draw" }
    },
    comparison: {
      form: { home: "60%", away: "40%" },
      goals: { home: "55%", away: "45%" }
    },
    teams: {
      home: {
        league: {
          form: "WWDLW",
          goals: {
            for: { average: { home: String(homeFor), total: String(homeFor) } },
            against: { average: { home: String(homeAgainst), total: String(homeAgainst) } }
          }
        }
      },
      away: {
        league: {
          form: "LDWLW",
          goals: {
            for: { average: { away: String(awayFor), total: String(awayFor) } },
            against: { average: { away: String(awayAgainst), total: String(awayAgainst) } }
          }
        }
      }
    }
  };
}
