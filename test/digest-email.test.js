import test from "node:test";
import assert from "node:assert/strict";
import { DigestEmail, renderDigestHtml } from "../src/digest-email.js";

test("renders 1X2 prediction signals in one digest", () => {
  const html = renderDigestHtml(makeReport());
  assert.match(html, /Likely Home win/);
  assert.match(html, /1X2 match result/);
  assert.doesNotMatch(html, /Both teams to score/);
  assert.match(html, /Main signal/);
  assert.match(html, /Next 6 Hours/);
  assert.match(html, /12 API requests/);
});

test("sends a single email for the full report", async () => {
  const requests = [];
  const email = new DigestEmail({
    apiKey: "test-key",
    to: "owner@example.com",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: "digest-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  await email.send(makeReport());
  assert.equal(requests.length, 1);
});

function makeReport() {
  return {
    date: "2026-06-13",
    windowStart: "2026-06-13T20:00:00+08:00",
    windowEnd: "2026-06-14T02:00:00+08:00",
    windowHours: 6,
    timezone: "Asia/Singapore",
    analyzed: 11,
    requestsUsed: 12,
    candidates: [
      {
        kickoff: "2026-06-13T20:00:00+08:00",
        country: "Japan",
        league: "J1 League",
        home: "Home",
        away: "Away",
        side: "OVER_2_5",
        label: "Likely over 2.5",
        mainSignal: {
          market: "1X2 match result",
          pick: "Home",
          label: "Likely Home win",
          kind: "RESULT",
          score: 68
        },
        rankScore: 68,
        dataQuality: "high",
        reasons: ["Result split: 58%/23%/19%"]
      }
    ]
  };
}
