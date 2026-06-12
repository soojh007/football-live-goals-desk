const STAT_ALIASES = {
  shotsOnTarget: ["Shots on Goal", "Shots on Target"],
  totalShots: ["Total Shots"],
  corners: ["Corner Kicks", "Corners"],
  possession: ["Ball Possession"],
  shotsInsideBox: ["Shots insidebox", "Shots Inside Box"]
};

export function normalizeStatistics(statisticsResponse = []) {
  const totals = {
    shotsOnTarget: 0,
    totalShots: 0,
    corners: 0,
    possession: 0,
    shotsInsideBox: 0
  };

  for (const teamBlock of statisticsResponse) {
    for (const stat of teamBlock.statistics ?? []) {
      const key = Object.entries(STAT_ALIASES).find(([, aliases]) =>
        aliases.includes(stat.type)
      )?.[0];
      if (!key) continue;
      totals[key] += parseStatValue(stat.value);
    }
  }

  return totals;
}

export function evaluateFixture({
  fixture,
  statistics,
  previousStatistics,
  oddsResponse = [],
  config
}) {
  const minute = Number(fixture.fixture?.status?.elapsed ?? 0);
  const status = fixture.fixture?.status?.short ?? "";
  const goals = Number(fixture.goals?.home ?? 0) + Number(fixture.goals?.away ?? 0);
  const recent = calculateRecentChange(statistics, previousStatistics);
  const market = extractGoalMarkets(oddsResponse);
  const context = extractMatchContext(fixture.events);
  const signals = [];

  if (
    config.halftimeOver05.enabled &&
    status === "1H" &&
    goals === 0 &&
    minute >= config.halftimeOver05.startMinute &&
    minute <= config.halftimeOver05.endMinute
  ) {
    signals.push(
      scoreHalftimeOver05({
        minute,
        statistics,
        recent,
        thresholds: config.halftimeOver05,
        market,
        context,
        minimumSignalScore: config.minimumSignalScore
      })
    );
  }

  if (
    config.totalGoals.enabled &&
    ["1H", "HT", "2H"].includes(status) &&
    minute >= config.totalGoals.startMinute &&
    minute <= config.totalGoals.endMinute
  ) {
    signals.push(
      scoreTotalGoals({
        minute,
        goals,
        statistics,
        recent,
        thresholds: config.totalGoals,
        market,
        context,
        minimumSignalScore: config.minimumSignalScore
      })
    );
  }

  return {
    fixtureId: fixture.fixture?.id,
    league: fixture.league?.name ?? "Unknown competition",
    country: fixture.league?.country ?? "",
    home: fixture.teams?.home?.name ?? "Home",
    away: fixture.teams?.away?.name ?? "Away",
    homeLogo: fixture.teams?.home?.logo ?? "",
    awayLogo: fixture.teams?.away?.logo ?? "",
    status,
    minute,
    score: `${fixture.goals?.home ?? 0}-${fixture.goals?.away ?? 0}`,
    statistics,
    recent,
    context,
    markets: market,
    signals,
    hasStatistics: statistics.totalShots > 0 || statistics.shotsOnTarget > 0
  };
}

function scoreHalftimeOver05({
  minute,
  statistics,
  recent,
  thresholds,
  market,
  context,
  minimumSignalScore
}) {
  let score = 10;
  const reasons = [];

  score += progressScore(statistics.shotsOnTarget, thresholds.minimumShotsOnTarget, 24);
  score += progressScore(statistics.totalShots, thresholds.minimumTotalShots, 22);
  score += progressScore(statistics.corners, thresholds.minimumCorners, 12);
  score += progressScore(recent.totalShots, thresholds.minimumRecentShots, 20);
  score += statistics.shotsInsideBox >= 4 ? 8 : 0;
  score += minute >= 35 ? 4 : 0;

  reasons.push(`${statistics.shotsOnTarget} shots on target`);
  reasons.push(`${statistics.totalShots} total shots`);
  reasons.push(`${statistics.corners} corners`);
  if (recent.available) reasons.push(`${recent.totalShots} shots since last sample`);
  if (statistics.shotsInsideBox) {
    reasons.push(`${statistics.shotsInsideBox} shots inside the box`);
  }

  score = Math.min(100, Math.round(score));
  return {
    type: "HT_OVER_0_5",
    label: "1st half over 0.5 goals",
    score,
    level: signalLevel(score, minimumSignalScore),
    reasons,
    price: findPrice(market, "Over", 0.5, true),
    caution: cautionText(
      "Only valid while the match is 0-0 and first-half betting remains open.",
      context
    )
  };
}

function scoreTotalGoals({
  minute,
  goals,
  statistics,
  recent,
  thresholds,
  market,
  context,
  minimumSignalScore
}) {
  let pressure = 8;
  pressure += progressScore(statistics.shotsOnTarget, thresholds.minimumShotsOnTarget, 26);
  pressure += progressScore(statistics.totalShots, thresholds.minimumTotalShots, 22);
  pressure += progressScore(statistics.corners, thresholds.minimumCorners, 12);
  pressure += progressScore(recent.totalShots, thresholds.minimumRecentShots, 20);
  pressure += statistics.shotsInsideBox >= 6 ? 8 : 0;
  pressure = Math.min(100, Math.round(pressure));

  const expectedLine = goals + (minute < 35 ? 1.5 : minute < 65 ? 1 : 0.5);
  const overPrice = findClosestPrice(market, "Over", expectedLine);
  const underPrice = findClosestPrice(market, "Under", expectedLine);
  const leanOver = pressure >= minimumSignalScore;
  const score = leanOver ? pressure : Math.min(100, 100 - pressure + 20);

  const reasons = [
    `${statistics.shotsOnTarget} shots on target`,
    `${statistics.totalShots} total shots`,
    `${statistics.corners} corners`
  ];
  if (recent.available) reasons.push(`${recent.totalShots} shots since last sample`);
  reasons.push(`${goals} goals after ${minute} minutes`);

  return {
    type: leanOver ? "TOTAL_OVER" : "TOTAL_UNDER",
    label: leanOver ? "Total goals: over lean" : "Total goals: under lean",
    score: Math.round(score),
    level: signalLevel(score, minimumSignalScore),
    reasons,
    price: leanOver ? overPrice : underPrice,
    caution: cautionText(
      leanOver
        ? "Confirm the offered line still leaves value after recent goals or VAR."
        : "An under lean can be fragile: penalties and game state can reverse it quickly.",
      context
    )
  };
}

export function extractMatchContext(events = []) {
  const redCards = events
    .filter(
      (event) =>
        event.type === "Card" &&
        /red/i.test(`${event.detail ?? ""} ${event.comments ?? ""}`)
    )
    .map((event) => ({
      minute: event.time?.elapsed ?? null,
      team: event.team?.name ?? "Unknown team",
      player: event.player?.name ?? "Unknown player"
    }));

  return {
    redCards,
    warnings: redCards.map(
      (card) => `Red card: ${card.team} at ${card.minute ?? "?"}'`
    )
  };
}

export function extractGoalMarkets(oddsResponse = []) {
  const markets = [];
  for (const fixtureOdds of oddsResponse) {
    for (const bookmaker of fixtureOdds.odds ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        if (!/over|under|total|goal/i.test(bet.name ?? "")) continue;
        for (const value of bet.values ?? []) {
          const parsed = parseMarketValue(value.value);
          if (!parsed) continue;
          markets.push({
            bookmaker: bookmaker.name,
            market: bet.name,
            side: parsed.side,
            line: parsed.line,
            odd: Number(value.odd),
            suspended: Boolean(value.suspended)
          });
        }
      }
    }
  }
  return markets;
}

function parseMarketValue(value) {
  const match = String(value ?? "").match(/\b(Over|Under)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  return { side: titleCase(match[1]), line: Number(match[2]) };
}

function findPrice(markets, side, line, firstHalf = false) {
  const filtered = markets.filter(
    (item) =>
      item.side === side &&
      item.line === line &&
      (!firstHalf || /first|1st|half/i.test(item.market)) &&
      !item.suspended
  );
  return bestPrice(filtered);
}

function findClosestPrice(markets, side, targetLine) {
  const candidates = markets
    .filter(
      (item) =>
        item.side === side &&
        !/first|1st|half/i.test(item.market) &&
        !item.suspended
    )
    .sort((a, b) => Math.abs(a.line - targetLine) - Math.abs(b.line - targetLine));
  if (!candidates.length) return null;
  const closestLine = candidates[0].line;
  return bestPrice(candidates.filter((item) => item.line === closestLine));
}

function bestPrice(items) {
  if (!items.length) return null;
  return items.reduce((best, item) => (item.odd > best.odd ? item : best));
}

function calculateRecentChange(current, previous) {
  if (!previous) {
    return { available: false, shotsOnTarget: 0, totalShots: 0, corners: 0 };
  }
  return {
    available: true,
    shotsOnTarget: Math.max(0, current.shotsOnTarget - previous.shotsOnTarget),
    totalShots: Math.max(0, current.totalShots - previous.totalShots),
    corners: Math.max(0, current.corners - previous.corners)
  };
}

function progressScore(value, target, points) {
  if (!target) return 0;
  return Math.min(points, (Math.max(0, value) / target) * points);
}

function signalLevel(score, minimumSignalScore) {
  if (score >= Math.max(78, minimumSignalScore + 15)) return "strong";
  if (score >= minimumSignalScore) return "watch";
  return "pass";
}

function parseStatValue(value) {
  if (value === null || value === undefined) return 0;
  return Number.parseFloat(String(value).replace("%", "")) || 0;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function cautionText(base, context) {
  if (!context.redCards.length) return base;
  return `RED CARD IN MATCH. Treat the model score as unstable. ${base}`;
}
