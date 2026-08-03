import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CalibrationStore } from "../src/calibration-store.js";

test("loads pending digest candidates that have not been settled", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-calibration-"));
  const store = new CalibrationStore(directory);

  store.appendDigestCandidates({
    generatedAt: "2026-06-13T10:00:00+08:00",
    windowStart: "2026-06-13T10:00:00+08:00",
    windowEnd: "2026-06-13T16:00:00+08:00",
    candidates: [
      candidate({ fixtureId: 1, kickoff: "2026-06-13T10:00:00+08:00" }),
      candidate({ fixtureId: 2, kickoff: "2026-06-13T15:00:00+08:00" })
    ]
  });
  store.appendSettledResult({
    key: "1:1X2:home:",
    fixtureId: 1,
    marketType: "1X2",
    outcome: "win",
    staked: 1,
    profit: 0.8
  });

  const pending = store.loadPendingCandidates({
    now: new Date("2026-06-13T18:30:00+08:00"),
    settleAfterHours: 3
  });

  assert.deepEqual(pending.map((item) => item.fixtureId), [2]);
});

function candidate({ fixtureId, kickoff }) {
  return {
    fixtureId,
    kickoff,
    country: "Japan",
    league: "J1 League",
    home: "Home",
    away: "Away",
    marketType: "1X2",
    selection: "home",
    selectedOdd: 1.8,
    rankScore: 58
  };
}
