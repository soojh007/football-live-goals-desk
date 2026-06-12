const DEFAULT_BASE_URL = "https://v3.football.api-sports.io";

export class ApiFootballClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async request(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error("API_FOOTBALL_KEY is missing. Add it to .env.");
    }

    const url = new URL(endpoint, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      headers: { "x-apisports-key": this.apiKey },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      throw new Error(`API-Football ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const apiErrors = normalizeErrors(payload.errors);
    if (apiErrors.length) throw new Error(`API-Football: ${apiErrors.join("; ")}`);

    return {
      data: payload.response ?? [],
      paging: payload.paging ?? {},
      remaining:
        response.headers.get("x-ratelimit-requests-remaining") ??
        response.headers.get("X-RateLimit-requests-Remaining")
    };
  }

  getLiveFixtures(timezone) {
    return this.request("/fixtures", { live: "all", timezone });
  }

  getFixtureStatistics(fixtureId) {
    return this.request("/fixtures/statistics", { fixture: fixtureId });
  }

  getLiveOdds(fixtureId) {
    return this.request("/odds/live", { fixture: fixtureId });
  }

  getFixturesByDate(date, timezone) {
    return this.request("/fixtures", { date, timezone });
  }

  getPrediction(fixtureId) {
    return this.request("/predictions", { fixture: fixtureId });
  }
}

function normalizeErrors(errors) {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.filter(Boolean).map(String);
  if (typeof errors === "object") {
    return Object.entries(errors).map(([key, value]) => `${key}: ${value}`);
  }
  return [String(errors)];
}
