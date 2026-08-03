const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

export function settleCandidate(candidate, fixture) {
  const status = fixture.fixture?.status?.short;
  if (!FINISHED_STATUSES.has(status)) return null;

  const homeGoals = Number(fixture.goals?.home);
  const awayGoals = Number(fixture.goals?.away);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;

  const outcome = candidate.marketType === "AH"
    ? settleAsianHandicap({
        selection: candidate.selection,
        line: Number(candidate.handicapLine),
        homeGoals,
        awayGoals
      })
    : settleResult({
        selection: candidate.selection,
        homeGoals,
        awayGoals
      });
  if (!outcome) return null;

  const odd = Number(candidate.selectedOdd);
  const profit = round(profitForOutcome({ outcome, odd }), 4);
  return {
    key: candidateKey(candidate),
    fixtureId: candidate.fixtureId,
    kickoff: candidate.kickoff,
    settledAt: new Date().toISOString(),
    country: candidate.country,
    league: candidate.league,
    marketType: candidate.marketType,
    selection: candidate.selection,
    handicapLine: candidate.handicapLine ?? null,
    selectedOdd: Number.isFinite(odd) ? odd : null,
    homeGoals,
    awayGoals,
    outcome,
    staked: 1,
    profit
  };
}

export function buildCalibrationStats(results = [], { minimumSamples = 12 } = {}) {
  const scopes = new Map();
  for (const result of results) {
    if (!result || !result.marketType || typeof result.profit !== "number") continue;
    addResult(scopes, leagueMarketKey(result), "league-market", result);
    addResult(scopes, marketKey(result), "market", result);
  }

  return {
    forCandidate(candidate) {
      const leagueStats = scopes.get(leagueMarketKey(candidate));
      if (leagueStats?.samples >= minimumSamples) return finalizeStats(leagueStats);
      const marketStats = scopes.get(marketKey(candidate));
      if (marketStats?.samples >= minimumSamples) return finalizeStats(marketStats);
      return null;
    }
  };
}

export function candidateKey(candidate) {
  return [
    candidate.fixtureId,
    candidate.marketType,
    candidate.selection,
    candidate.handicapLine ?? ""
  ].join(":");
}

function settleResult({ selection, homeGoals, awayGoals }) {
  const result = homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
  return normalizeSelection(selection) === result ? "win" : "loss";
}

function settleAsianHandicap({ selection, line, homeGoals, awayGoals }) {
  if (!Number.isFinite(line)) return null;
  const selectedGoals = normalizeSelection(selection) === "home" ? homeGoals : awayGoals;
  const opponentGoals = normalizeSelection(selection) === "home" ? awayGoals : homeGoals;
  const adjustedMargin = selectedGoals + line - opponentGoals;

  if (isQuarterLine(line)) {
    const [first, second] = splitQuarterLine(line);
    return combineHalfOutcomes([
      settleAsianHandicap({ selection, line: first, homeGoals, awayGoals }),
      settleAsianHandicap({ selection, line: second, homeGoals, awayGoals })
    ]);
  }

  if (adjustedMargin > 0) return "win";
  if (adjustedMargin < 0) return "loss";
  return "push";
}

function splitQuarterLine(line) {
  const lower = line > 0 ? Math.floor(line * 2) / 2 : Math.ceil(line * 2) / 2;
  const upper = line > 0 ? lower + 0.5 : lower - 0.5;
  return [round(lower, 2), round(upper, 2)];
}

function combineHalfOutcomes(outcomes) {
  const profit = outcomes.reduce(
    (total, outcome) => total + profitForOutcome({ outcome, odd: 2 }) / 2,
    0
  );
  if (profit === 0.5) return "half-win";
  if (profit === -0.5) return "half-loss";
  if (profit > 0) return "win";
  if (profit < 0) return "loss";
  return "push";
}

function profitForOutcome({ outcome, odd }) {
  if (!Number.isFinite(odd) || odd <= 1) return 0;
  if (outcome === "win") return odd - 1;
  if (outcome === "half-win") return (odd - 1) / 2;
  if (outcome === "half-loss") return -0.5;
  if (outcome === "loss") return -1;
  return 0;
}

function addResult(scopes, key, scope, result) {
  if (!scopes.has(key)) {
    scopes.set(key, {
      scope,
      samples: 0,
      decisions: 0,
      wins: 0,
      staked: 0,
      profit: 0
    });
  }
  const stats = scopes.get(key);
  stats.samples++;
  stats.staked += result.staked ?? 1;
  stats.profit += result.profit;
  if (result.outcome !== "push") stats.decisions++;
  if (["win", "half-win"].includes(result.outcome)) stats.wins++;
}

function finalizeStats(stats) {
  return {
    ...stats,
    profit: round(stats.profit, 4),
    staked: round(stats.staked, 4)
  };
}

function leagueMarketKey(value) {
  return [
    normalize(value.country),
    normalize(value.league),
    normalize(value.marketType)
  ].join("|");
}

function marketKey(value) {
  return `market|${normalize(value.marketType)}`;
}

function normalizeSelection(value) {
  return String(value ?? "").toLowerCase();
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isQuarterLine(line) {
  return Math.abs(line * 100) % 50 === 25;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
