const DEFAULT_BASE_URL = "https://api.sportmonks.com/v3/football";
const FIXTURE_INCLUDE = "participants;league.country;scores;state";
const ODDS_INCLUDE = "bookmaker";

export class SportMonksClient {
  constructor({ apiToken, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch }) {
    this.apiToken = apiToken;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async request(endpoint, params = {}) {
    if (!this.apiToken) {
      throw new Error("SPORTMONKS_API_TOKEN is missing. Add it to Render and .env.");
    }

    const url = buildUrl(this.baseUrl, endpoint);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiToken}`
      },
      signal: AbortSignal.timeout(20_000)
    });

    if (!response.ok) {
      throw new Error(`SportsMonks ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    if (payload.message && !payload.data) {
      throw new Error(`SportsMonks: ${payload.message}`);
    }

    return {
      data: normalizeData(payload.data),
      pagination: payload.pagination ?? payload.meta?.pagination ?? {},
      rateLimit: payload.rate_limit ?? payload.rateLimit ?? null
    };
  }

  async requestAll(endpoint, params = {}) {
    const all = [];
    let page = 1;
    let latest = null;

    while (true) {
      latest = await this.request(endpoint, { per_page: 50, ...params, page });
      all.push(...latest.data);
      if (!hasMorePages(latest.pagination)) break;
      page++;
    }

    return { ...latest, data: all };
  }

  async getFixturesByDate(date) {
    const result = await this.requestAll(`/fixtures/date/${date}`, {
      include: FIXTURE_INCLUDE
    });
    return {
      data: result.data.map(normalizeFixture),
      remaining: remainingRequests(result.rateLimit)
    };
  }

  async getFixtureById(fixtureId) {
    const result = await this.request(`/fixtures/${fixtureId}`, {
      include: FIXTURE_INCLUDE
    });
    const fixtures = result.data.map(normalizeFixture);
    return {
      data: fixtures,
      remaining: remainingRequests(result.rateLimit)
    };
  }

  async getFixtureOdds(fixtureId) {
    const result = await this.requestAll(`/odds/pre-match/fixtures/${fixtureId}`, {
      include: ODDS_INCLUDE
    });
    return {
      data: [normalizeOdds(result.data)].filter((item) => item.bookmakers.length),
      remaining: remainingRequests(result.rateLimit)
    };
  }

  async getFixtureProbabilities(fixtureId) {
    const result = await this.requestAll(`/predictions/probabilities/fixture/${fixtureId}`, {
      include: "type"
    });
    return {
      data: normalizeProbabilities(result.data),
      remaining: remainingRequests(result.rateLimit)
    };
  }

  async getFixtureValueBets(fixtureId) {
    const result = await this.requestAll(`/predictions/value-bets/fixture/${fixtureId}`, {
      include: "type"
    });
    return {
      data: normalizeValueBets(result.data),
      remaining: remainingRequests(result.rateLimit)
    };
  }
}

function buildUrl(baseUrl, endpoint) {
  return new URL(endpoint.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`);
}

function normalizeData(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

function hasMorePages(pagination = {}) {
  return Boolean(
    pagination.has_more ||
      pagination.hasMore ||
      (pagination.current_page && pagination.last_page && pagination.current_page < pagination.last_page)
  );
}

function normalizeFixture(fixture) {
  const teams = teamsFromParticipants(fixture.participants ?? [], fixture.name);
  const goals = goalsFromScores(fixture.scores ?? []);
  const league = fixture.league ?? {};
  const country = league.country ?? {};

  return {
    fixture: {
      id: fixture.id,
      date: toIsoDate(fixture.starting_at),
      status: { short: normalizeStatus(fixture) }
    },
    league: {
      id: fixture.league_id ?? league.id,
      name: league.name ?? "Unknown competition",
      country: country.name ?? league.country_name ?? ""
    },
    teams,
    goals
  };
}

function teamsFromParticipants(participants, fixtureName = "") {
  const home = participants.find((participant) => participant.meta?.location === "home");
  const away = participants.find((participant) => participant.meta?.location === "away");
  const [fallbackHome, fallbackAway] = String(fixtureName).split(/\s+vs\s+/i);

  return {
    home: {
      id: home?.id ?? null,
      name: home?.name ?? fallbackHome ?? "Home",
      logo: home?.image_path ?? ""
    },
    away: {
      id: away?.id ?? null,
      name: away?.name ?? fallbackAway ?? "Away",
      logo: away?.image_path ?? ""
    }
  };
}

function goalsFromScores(scores) {
  const goals = { home: 0, away: 0 };
  for (const score of scores) {
    const participant = score.score?.participant;
    const value = Number(score.score?.goals);
    if ((participant === "home" || participant === "away") && Number.isFinite(value)) {
      goals[participant] = value;
    }
  }
  return goals;
}

function normalizeStatus(fixture) {
  const raw = String(
    fixture.state?.short_name ??
      fixture.state?.code ??
      fixture.state?.name ??
      fixture.state_id ??
      ""
  ).toLowerCase();

  if (["1", "ns", "not started", "not_started", "fixture scheduled", "scheduled"].includes(raw)) {
    return "NS";
  }
  if (["5", "ft", "finished", "full time", "full-time", "ended"].includes(raw)) return "FT";
  if (raw.includes("extra")) return "AET";
  if (raw.includes("pen")) return "PEN";
  if (raw.includes("postpon")) return "PST";
  if (raw.includes("cancel")) return "CANC";
  return raw.toUpperCase() || "TBD";
}

function toIsoDate(value) {
  if (!value) return new Date(0).toISOString();
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`).toISOString();
}

function normalizeOdds(odds) {
  const bookmakers = new Map();

  for (const odd of odds) {
    const bookmakerId = odd.bookmaker_id ?? odd.bookmaker?.id ?? "unknown";
    const bookmakerName = odd.bookmaker?.name ?? `Bookmaker ${bookmakerId}`;
    if (!bookmakers.has(bookmakerId)) {
      bookmakers.set(bookmakerId, { name: bookmakerName, bets: new Map() });
    }

    const marketName = normalizeMarketName(odd.market_description ?? odd.market?.description ?? odd.market?.name);
    if (!marketName) continue;
    const value = normalizeOddValue(odd, marketName);
    if (!value) continue;

    const bookmaker = bookmakers.get(bookmakerId);
    if (!bookmaker.bets.has(marketName)) bookmaker.bets.set(marketName, []);
    bookmaker.bets.get(marketName).push(value);
  }

  return {
    bookmakers: [...bookmakers.values()]
      .map((bookmaker) => ({
        name: bookmaker.name,
        bets: [...bookmaker.bets.entries()].map(([name, values]) => ({ name, values }))
      }))
      .filter((bookmaker) => bookmaker.bets.length)
  };
}

function normalizeMarketName(value = "") {
  const normalized = String(value).toLowerCase();
  if (/match winner|full.?time result|1x2|3way result/.test(normalized)) return "Match Winner";
  if (/asian handicap|handicap/.test(normalized) && !/corner|card/.test(normalized)) return "Asian Handicap";
  return null;
}

function normalizeOddValue(odd, marketName) {
  const price = Number.parseFloat(odd.value ?? odd.dp3);
  if (!Number.isFinite(price) || price <= 1) return null;

  if (marketName === "Match Winner") {
    const label = normalizeMatchWinnerLabel(odd.label ?? odd.name);
    return label ? { value: label, odd: String(price) } : null;
  }

  const side = normalizeHandicapSide(odd.label ?? odd.name);
  const line = Number.parseFloat(odd.handicap ?? odd.total);
  if (!side || !Number.isFinite(line)) return null;
  return { value: `${side} ${formatSignedLine(line)}`, odd: String(price) };
}

function normalizeMatchWinnerLabel(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (["home", "1"].includes(normalized)) return "Home";
  if (["draw", "x"].includes(normalized)) return "Draw";
  if (["away", "2"].includes(normalized)) return "Away";
  return null;
}

function normalizeHandicapSide(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (["home", "1"].includes(normalized)) return "Home";
  if (["away", "2"].includes(normalized)) return "Away";
  return null;
}

function formatSignedLine(line) {
  if (Object.is(line, -0) || line === 0) return "0";
  return `${line > 0 ? "+" : ""}${line}`;
}

function remainingRequests(rateLimit) {
  if (!rateLimit) return null;
  return rateLimit.remaining ?? rateLimit.remaining_requests ?? null;
}

function normalizeProbabilities(records) {
  return records
    .map((record) => {
      const predictions = record.predictions ?? {};
      const result = resultProbabilities(predictions);
      if (!result) return null;
      return {
        fixtureId: record.fixture_id,
        marketType: "1X2",
        typeId: record.type_id,
        typeName: record.type?.name ?? record.type?.developer_name ?? "",
        probabilities: result
      };
    })
    .filter(Boolean);
}

function resultProbabilities(predictions) {
  const home = probabilityValue(
    predictions.home ?? predictions.localteam ?? predictions.local_team ?? predictions["1"]
  );
  const draw = probabilityValue(predictions.draw ?? predictions.x ?? predictions["X"]);
  const away = probabilityValue(
    predictions.away ?? predictions.visitorteam ?? predictions.visitor_team ?? predictions["2"]
  );

  if (home === null || draw === null || away === null) return null;
  const total = home + draw + away;
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function normalizeValueBets(records) {
  return records
    .map((record) => {
      const prediction = record.predictions ?? {};
      const selection = valueBetSelection(prediction.bet);
      if (!selection) return null;
      return {
        fixtureId: record.fixture_id,
        marketType: "1X2",
        selection,
        bookmaker: prediction.bookmaker ?? "",
        odd: numberOrNull(prediction.odd),
        fairOdd: numberOrNull(prediction.fair_odd),
        stake: numberOrNull(prediction.stake),
        isValue: prediction.is_value === true,
        typeId: record.type_id
      };
    })
    .filter(Boolean);
}

function valueBetSelection(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "home"].includes(normalized)) return "home";
  if (["x", "draw"].includes(normalized)) return "draw";
  if (["2", "away"].includes(normalized)) return "away";
  return null;
}

function probabilityValue(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function numberOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
