import test from "node:test";
import assert from "node:assert/strict";
import { SportMonksClient } from "../src/sportmonks-client.js";

test("normalizes SportsMonks fixtures into digest fixture shape", async () => {
  const requests = [];
  const headers = [];
  const client = new SportMonksClient({
    apiToken: "token",
    fetchImpl: async (url, options) => {
      requests.push(String(url));
      headers.push(options.headers);
      return jsonResponse({
        data: [
          {
            id: 1001,
            league_id: 8,
            name: "Home FC vs Away FC",
            starting_at: "2026-08-23 12:00:00",
            state: { short_name: "NS" },
            league: { id: 8, name: "J1 League", country: { name: "Japan" } },
            participants: [
              { id: 1, name: "Home FC", image_path: "home.png", meta: { location: "home" } },
              { id: 2, name: "Away FC", image_path: "away.png", meta: { location: "away" } }
            ],
            scores: []
          }
        ],
        pagination: { has_more: false },
        rate_limit: { remaining: 99 }
      });
    }
  });

  const result = await client.getFixturesByDate("2026-08-23");

  assert.match(requests[0], /fixtures\/date\/2026-08-23/);
  assert.match(requests[0], /api\.sportmonks\.com\/v3\/football\/fixtures\/date\/2026-08-23/);
  assert.match(requests[0], /include=participants%3Bleague.country%3Bscores%3Bstate/);
  assert.equal(headers[0].authorization, "Bearer token");
  assert.equal(result.remaining, 99);
  assert.deepEqual(result.data[0], {
    fixture: {
      id: 1001,
      date: "2026-08-23T12:00:00.000Z",
      status: { short: "NS" }
    },
    league: { id: 8, name: "J1 League", country: "Japan" },
    teams: {
      home: { id: 1, name: "Home FC", logo: "home.png" },
      away: { id: 2, name: "Away FC", logo: "away.png" }
    },
    goals: { home: 0, away: 0 }
  });
});

test("normalizes SportsMonks pre-match odds into existing odds shape", async () => {
  const client = new SportMonksClient({
    apiToken: "token",
    fetchImpl: async () => jsonResponse({
      data: [
        {
          fixture_id: 1001,
          market_description: "Match Winner",
          bookmaker_id: 1,
          bookmaker: { id: 1, name: "Book A" },
          label: "Home",
          value: "1.90"
        },
        {
          fixture_id: 1001,
          market_description: "Match Winner",
          bookmaker_id: 1,
          bookmaker: { id: 1, name: "Book A" },
          label: "Draw",
          value: "3.50"
        },
        {
          fixture_id: 1001,
          market_description: "Match Winner",
          bookmaker_id: 1,
          bookmaker: { id: 1, name: "Book A" },
          label: "Away",
          value: "4.20"
        },
        {
          fixture_id: 1001,
          market_description: "Asian Handicap",
          bookmaker_id: 1,
          bookmaker: { id: 1, name: "Book A" },
          label: "Home",
          handicap: "-0.5",
          value: "1.80"
        },
        {
          fixture_id: 1001,
          market_description: "Asian Handicap",
          bookmaker_id: 1,
          bookmaker: { id: 1, name: "Book A" },
          label: "Away",
          handicap: "+0.5",
          value: "2.05"
        }
      ],
      pagination: { has_more: false }
    })
  });

  const result = await client.getFixtureOdds(1001);

  assert.deepEqual(result.data, [
    {
      bookmakers: [
        {
          name: "Book A",
          bets: [
            {
              name: "Match Winner",
              values: [
                { value: "Home", odd: "1.9" },
                { value: "Draw", odd: "3.5" },
                { value: "Away", odd: "4.2" }
              ]
            },
            {
              name: "Asian Handicap",
              values: [
                { value: "Home -0.5", odd: "1.8" },
                { value: "Away +0.5", odd: "2.05" }
              ]
            }
          ]
        }
      ]
    }
  ]);
});

test("paginates SportsMonks date responses", async () => {
  const pages = [
    { data: [{ id: 1, starting_at: "2026-08-23 12:00:00", state_id: 1 }], pagination: { has_more: true } },
    { data: [{ id: 2, starting_at: "2026-08-23 13:00:00", state_id: 1 }], pagination: { has_more: false } }
  ];
  const client = new SportMonksClient({
    apiToken: "token",
    fetchImpl: async () => jsonResponse(pages.shift())
  });

  const result = await client.getFixturesByDate("2026-08-23");

  assert.deepEqual(result.data.map((fixture) => fixture.fixture.id), [1, 2]);
});

test("normalizes SportsMonks value bets", async () => {
  const requests = [];
  const client = new SportMonksClient({
    apiToken: "token",
    fetchImpl: async (url) => {
      requests.push(String(url));
      return jsonResponse({
        data: [
          {
            fixture_id: 1001,
            predictions: {
              bet: "1",
              bookmaker: "bet365",
              odd: 1.9,
              is_value: true,
              stake: 0.95,
              fair_odd: 1.84
            },
            type_id: 33
          }
        ],
        pagination: { has_more: false }
      });
    }
  });

  const result = await client.getFixtureValueBets(1001);

  assert.match(requests[0], /predictions\/value-bets\/fixture\/1001/);
  assert.deepEqual(result.data, [
    {
      fixtureId: 1001,
      marketType: "1X2",
      selection: "home",
      bookmaker: "bet365",
      odd: 1.9,
      fairOdd: 1.84,
      stake: 0.95,
      isValue: true,
      typeId: 33
    }
  ]);
});

test("normalizes SportsMonks 1X2 probabilities when labels are available", async () => {
  const requests = [];
  const client = new SportMonksClient({
    apiToken: "token",
    fetchImpl: async (url) => {
      requests.push(String(url));
      return jsonResponse({
        data: [
          {
            fixture_id: 1001,
            predictions: { home: 55, draw: 25, away: 20 },
            type_id: 100,
            type: { name: "Fulltime Result" }
          }
        ],
        pagination: { has_more: false }
      });
    }
  });

  const result = await client.getFixtureProbabilities(1001);

  assert.match(requests[0], /predictions\/probabilities\/fixture\/1001/);
  assert.deepEqual(result.data, [
    {
      fixtureId: 1001,
      marketType: "1X2",
      typeId: 100,
      typeName: "Fulltime Result",
      probabilities: { home: 0.55, draw: 0.25, away: 0.2 }
    }
  ]);
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
