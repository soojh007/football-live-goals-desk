import test from "node:test";
import assert from "node:assert/strict";
import { EmailAlerts } from "../src/email-alerts.js";

test("sends one alert and suppresses duplicate polls", async () => {
  const requests = [];
  const alerts = new EmailAlerts({
    apiKey: "test-key",
    to: "owner@example.com",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const fixture = makeFixture();

  await alerts.notify([fixture]);
  await alerts.notify([fixture]);

  assert.equal(requests.length, 1);
  assert.equal(alerts.lastResult.ok, true);
});

test("does not send pass-level signals by default", async () => {
  let sent = false;
  const alerts = new EmailAlerts({
    apiKey: "test-key",
    to: "owner@example.com",
    fetchImpl: async () => {
      sent = true;
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    }
  });
  const fixture = makeFixture();
  fixture.signals[0].level = "pass";

  await alerts.notify([fixture]);
  assert.equal(sent, false);
});

test("reports disabled when credentials or recipient are missing", () => {
  assert.equal(new EmailAlerts({}).enabled, false);
  assert.equal(new EmailAlerts({ apiKey: "test-key" }).enabled, false);
});

test("changes the idempotency key when the email payload changes", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: `email-${requests.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const firstAlerts = new EmailAlerts({
    apiKey: "test-key",
    to: "owner@example.com",
    fetchImpl
  });
  const secondAlerts = new EmailAlerts({
    apiKey: "test-key",
    to: "owner@example.com",
    fetchImpl
  });
  const firstFixture = makeFixture();
  const changedFixture = makeFixture();
  changedFixture.minute = 38;
  changedFixture.signals[0].score = 74;

  await firstAlerts.notify([firstFixture]);
  await secondAlerts.notify([changedFixture]);

  assert.equal(requests.length, 2);
  assert.notEqual(
    requests[0].options.headers["idempotency-key"],
    requests[1].options.headers["idempotency-key"]
  );
});

function makeFixture() {
  return {
    fixtureId: 123,
    league: "Test League",
    home: "Home",
    away: "Away",
    score: "0-0",
    minute: 36,
    status: "1H",
    signals: [
      {
        type: "HT_OVER_0_5",
        label: "1st half over 0.5 goals",
        level: "watch",
        score: 68,
        reasons: ["3 shots on target", "10 total shots"],
        price: null,
        caution: "Check match context."
      }
    ]
  };
}
