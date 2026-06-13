import test from "node:test";
import assert from "node:assert/strict";
import { ShortlistService } from "../src/shortlist-service.js";

test("generates a capped shortlist for fixtures in the next three hours", async () => {
  const calls = [];
  const client = {
    async getFixturesByDate(date) {
      calls.push(["fixtures", date]);
      return {
        data: [
          makeFixture(1, "2026-06-13T11:00:00+08:00"),
          makeFixture(2, "2026-06-13T14:30:00+08:00")
        ],
        remaining: "7000"
      };
    },
    async getPrediction(id) {
      calls.push(["prediction", id]);
      return { data: [makePrediction()] };
    }
  };
  const service = new ShortlistService({
    client,
    now: () => new Date("2026-06-13T10:00:00+08:00"),
    maxAnalyses: 15,
    cooldownMinutes: 15
  });

  const state = await service.generate();

  assert.equal(state.report.analyzed, 1);
  assert.equal(state.report.requestsUsed, 2);
  assert.equal(state.report.candidates.length, 1);
  assert.deepEqual(calls.map(([type]) => type), ["fixtures", "prediction"]);
});

test("returns cached state during cooldown without making API calls", async () => {
  let fixtureCalls = 0;
  const client = {
    async getFixturesByDate() {
      fixtureCalls++;
      return { data: [], remaining: "7000" };
    },
    async getPrediction() {
      throw new Error("should not be called");
    }
  };
  const service = new ShortlistService({
    client,
    now: () => new Date("2026-06-13T10:00:00+08:00"),
    cooldownMinutes: 15
  });
  await service.generate();

  await assert.rejects(() => service.generate(), (error) => error.statusCode === 429);
  assert.equal(fixtureCalls, 1);
});

function makeFixture(id, date) {
  return {
    fixture: { id, date, status: { short: "NS" } },
    league: { name: "Test League", country: "Testland" },
    teams: {
      home: { id: id * 10, name: "Home" },
      away: { id: id * 10 + 1, name: "Away" }
    }
  };
}

function makePrediction() {
  return {
    predictions: {
      advice: "Winner or over 2.5",
      under_over: "+2.5",
      percent: { home: "50%", draw: "20%", away: "30%" }
    },
    comparison: {
      form: { home: "60%", away: "40%" },
      goals: { home: "60%", away: "40%" }
    },
    teams: {
      home: {
        league: {
          goals: {
            for: { average: { home: "2.1", total: "2.0" } },
            against: { average: { home: "1.2", total: "1.3" } }
          }
        }
      },
      away: {
        league: {
          goals: {
            for: { average: { away: "1.8", total: "1.7" } },
            against: { average: { away: "1.6", total: "1.5" } }
          }
        }
      }
    }
  };
}
