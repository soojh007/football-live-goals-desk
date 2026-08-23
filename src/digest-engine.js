import { evaluateOddsCandidate } from "./odds-agent.js";

const ELIGIBLE_STATUSES = new Set(["NS", "TBD"]);

export function selectDigestFixtures(
  fixtures,
  { maxAnalyses = 40, now = new Date(), countries = [], leagues = [] } = {}
) {
  const filters = normalizedFixtureFilters({ countries, leagues });
  const eligible = fixtures.filter((fixture) => {
    const status = fixture.fixture?.status?.short;
    const kickoff = new Date(fixture.fixture?.date ?? 0);
    return (
      fixture.fixture?.id &&
      fixtureAllowed(fixture, filters) &&
      ELIGIBLE_STATUSES.has(status) &&
      kickoff.getTime() >= now.getTime() - 30 * 60_000 &&
      fixture.teams?.home?.id &&
      fixture.teams?.away?.id
    );
  });

  return selectAcrossCountries(eligible, maxAnalyses);
}

export function selectUpcomingFixtures(
  fixtures,
  { maxAnalyses = 15, start = new Date(), end, countries = [], leagues = [] } = {}
) {
  const filters = normalizedFixtureFilters({ countries, leagues });
  const endTime = end instanceof Date ? end.getTime() : start.getTime() + 3 * 60 * 60_000;
  const eligible = fixtures.filter((fixture) => {
    const status = fixture.fixture?.status?.short;
    const kickoff = new Date(fixture.fixture?.date ?? 0).getTime();
    return (
      fixture.fixture?.id &&
      fixtureAllowed(fixture, filters) &&
      ELIGIBLE_STATUSES.has(status) &&
      kickoff >= start.getTime() &&
      kickoff <= endTime &&
      fixture.teams?.home?.id &&
      fixture.teams?.away?.id
    );
  });

  return selectAcrossCountries(eligible, maxAnalyses);
}

function normalizedFixtureFilters({ countries, leagues }) {
  return {
    countries: new Set(countries.map(normalizeFilterValue).filter(Boolean)),
    leagues: new Set(leagues.map(normalizeFilterValue).filter(Boolean))
  };
}

function fixtureAllowed(fixture, filters) {
  if (!filters.countries.size && !filters.leagues.size) return true;
  const country = normalizeFilterValue(fixture.league?.country);
  const league = normalizeFilterValue(fixture.league?.name);
  return (
    filters.countries.has(country) ||
    filters.leagues.has(league) ||
    filters.leagues.has(`${country}:${league}`)
  );
}

function normalizeFilterValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function selectAcrossCountries(fixtures, limit) {
  const byCountry = new Map();
  for (const fixture of fixtures) {
    const country = fixture.league?.country ?? "International";
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(fixture);
  }
  for (const fixturesForCountry of byCountry.values()) {
    fixturesForCountry.sort(
      (a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime()
    );
  }

  const selected = [];
  const countries = [...byCountry.keys()].sort();
  while (selected.length < limit) {
    let added = false;
    for (const country of countries) {
      const fixture = byCountry.get(country).shift();
      if (!fixture) continue;
      selected.push(fixture);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function analyzePrediction(fixture, predictionResponse) {
  const prediction = predictionResponse?.predictions ?? {};
  const comparison = predictionResponse?.comparison ?? {};
  const teams = predictionResponse?.teams ?? {};
  const percent = parsePercentages(prediction.percent);
  const goalModel = calculateProjectedGoals(predictionResponse);
  const projectedGoals = goalModel.projectedGoals;
  const overProbability = estimateOver25Probability({
    projectedGoals,
    advice: prediction.advice,
    underOver: prediction.under_over
  });
  const side = overProbability >= 0.5 ? "OVER_2_5" : "UNDER_2_5";
  const label = side === "OVER_2_5" ? "Likely over 2.5" : "Likely under 2.5";
  const mainSignal = chooseMainSignal({
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    totalSide: side,
    totalLabel: label,
    overProbability,
    percent,
    winner: prediction.winner,
    advice: prediction.advice,
    underOver: prediction.under_over
  });
  const rankScore = mainSignal.score;
  const dataPoints =
    goalModel.dataPoints +
    countComparisonSignals(comparison) +
    countResultPredictionSignals({ percent, winner: prediction.winner });

  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league?.country ?? "International",
    league: fixture.league?.name ?? "Unknown competition",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    side,
    label,
    mainSignal,
    rankScore,
    dataQuality: dataPoints >= 7 ? "high" : dataPoints >= 4 ? "medium" : "limited",
    projectedGoals: projectedGoals === null ? null : round(projectedGoals, 2),
    advice: prediction.advice ?? "",
    underOver: prediction.under_over ?? "",
    winner: prediction.winner?.name ?? "",
    winnerComment: prediction.winner?.comment ?? "",
    percent,
    form: {
      home: teams.home?.league?.form ?? "",
      away: teams.away?.league?.form ?? ""
    },
    reasons: buildReasons({
      projectedGoals,
      underOver: prediction.under_over,
      advice: prediction.advice,
      percent,
      winner: prediction.winner,
      comparison
    })
  };
}

export function analyzeOdds(
  fixture,
  oddsResponse = [],
  { agentConfig = {}, calibrationStats = null, modelSignals = null } = {}
) {
  const candidates = [
    buildMatchWinnerCandidate({ fixture, oddsResponse, agentConfig }),
    buildAsianHandicapCandidate({ fixture, oddsResponse, agentConfig })
  ].filter(Boolean);

  if (!candidates.length) return null;
  return candidates
    .map((candidate) => applyModelSignals(candidate, modelSignals))
    .map((candidate) => applyCalibration(candidate, calibrationStats))
    .sort(compareOddsCandidates)[0];
}

export function analyzeModelSignals(
  fixture,
  modelSignals,
  { agentConfig = {}, calibrationStats = null } = {}
) {
  const probabilityRecord = (modelSignals?.probabilities ?? [])
    .find((item) => item.marketType === "1X2" && item.probabilities);
  if (!probabilityRecord) return null;

  const options = [
    {
      key: "home",
      pick: fixture.teams.home.name,
      label: `Likely ${fixture.teams.home.name} win`,
      probability: probabilityRecord.probabilities.home
    },
    {
      key: "draw",
      pick: "Draw",
      label: "Likely draw",
      probability: probabilityRecord.probabilities.draw
    },
    {
      key: "away",
      pick: fixture.teams.away.name,
      label: `Likely ${fixture.teams.away.name} win`,
      probability: probabilityRecord.probabilities.away
    }
  ]
    .filter((option) => Number.isFinite(option.probability))
    .sort((a, b) => b.probability - a.probability);
  if (options.length < 3) return null;

  const [best, next] = options;
  const edge = best.probability - next.probability;
  const minimumTopProbability = agentConfig.minimumTopProbability ?? 0.45;
  const minimumEdge = agentConfig.minimumEdge ?? 0.08;
  if (best.probability < minimumTopProbability || edge < minimumEdge) return null;

  const rankScore = Math.round(best.probability * 100);
  const candidate = {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league?.country ?? "International",
    league: fixture.league?.name ?? "Unknown competition",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    side: best.key.toUpperCase(),
    label: best.label,
    marketType: "1X2",
    selection: best.key,
    selectedOdd: null,
    selectedBookmaker: "",
    impliedProbability: round(best.probability, 4),
    marketEdge: round(edge, 4),
    mainSignal: {
      market: "SportsMonks probability",
      pick: best.pick,
      label: best.label,
      kind: "RESULT",
      score: clamp(rankScore, 25, 86)
    },
    rankScore: clamp(rankScore, 25, 86),
    baseRankScore: clamp(rankScore, 25, 86),
    dataQuality: best.probability >= 0.58 && edge >= 0.12 ? "high" : "medium",
    projectedGoals: null,
    advice: "",
    underOver: "",
    winner: best.pick,
    winnerComment: "Inferred from SportsMonks probabilities because odds access is unavailable",
    percent: {
      home: formatPercent(probabilityRecord.probabilities.home),
      draw: formatPercent(probabilityRecord.probabilities.draw),
      away: formatPercent(probabilityRecord.probabilities.away)
    },
    form: { home: "", away: "" },
    modelSignals: { status: "probability-only", probability: round(best.probability, 4) },
    calibration: { status: "collecting", samples: 0 },
    reasons: [
      `SportsMonks probability split: ${formatPercent(probabilityRecord.probabilities.home)}/${formatPercent(probabilityRecord.probabilities.draw)}/${formatPercent(probabilityRecord.probabilities.away)}`,
      `Probability edge over next outcome: ${formatPercent(edge)}`,
      "Odds endpoint unavailable on current SportsMonks plan"
    ]
  };

  return applyCalibration(candidate, calibrationStats);
}

function buildMatchWinnerCandidate({ fixture, oddsResponse, agentConfig }) {
  const market = summarizeMatchWinnerOdds({
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    oddsResponse
  });
  if (!market) return null;
  const options = [
    {
      key: "home",
      pick: fixture.teams.home.name,
      label: `Likely ${fixture.teams.home.name} win`,
      probability: market.probabilities.home
    },
    {
      key: "draw",
      pick: "Draw",
      label: "Likely draw",
      probability: market.probabilities.draw
    },
    {
      key: "away",
      pick: fixture.teams.away.name,
      label: `Likely ${fixture.teams.away.name} win`,
      probability: market.probabilities.away
    }
  ].sort((a, b) => b.probability - a.probability);
  const [best, next] = options;
  const rankScore = Math.round(best.probability * 100);
  const selectedPrice = market.bestPrices[best.key];
  const candidate = {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league?.country ?? "International",
    league: fixture.league?.name ?? "Unknown competition",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    side: best.key.toUpperCase(),
    label: best.label,
    marketType: "1X2",
    selection: best.key,
    selectedOdd: selectedPrice.odd,
    selectedBookmaker: selectedPrice.bookmaker,
    impliedProbability: round(best.probability, 4),
    marketEdge: round(best.probability - next.probability, 4),
    mainSignal: {
      market: "1X2 market odds",
      pick: best.pick,
      label: best.label,
      kind: "RESULT",
      score: clamp(rankScore, 25, 90)
    },
    rankScore,
    baseRankScore: rankScore,
    dataQuality: market.bookmakers >= 5 ? "high" : market.bookmakers >= 2 ? "medium" : "limited",
    projectedGoals: null,
    advice: "",
    underOver: "",
    winner: best.pick,
    winnerComment: "Inferred from current bookmaker odds",
    percent: {
      home: formatPercent(market.probabilities.home),
      draw: formatPercent(market.probabilities.draw),
      away: formatPercent(market.probabilities.away)
    },
    form: { home: "", away: "" },
    reasons: [
      `Odds-implied split: ${formatPercent(market.probabilities.home)}/${formatPercent(market.probabilities.draw)}/${formatPercent(market.probabilities.away)}`,
      `Best current price: ${best.pick} @ ${selectedPrice.odd} (${selectedPrice.bookmaker})`,
      `Bookmakers sampled: ${market.bookmakers}`,
      `Market edge over next outcome: ${formatPercent(best.probability - next.probability)}`
    ]
  };
  const verdict = evaluateOddsCandidate({ candidate, market, best, next, config: agentConfig });
  if (!verdict.passed) return null;
  return {
    ...candidate,
    reasons: [
      ...candidate.reasons,
      `Agent verdict: PASS - ${verdict.reasons.join("; ")}`
    ]
  };
}

function buildAsianHandicapCandidate({ fixture, oddsResponse, agentConfig }) {
  const market = summarizeAsianHandicapOdds({
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    oddsResponse
  });
  if (!market) return null;

  const homePick = formatHandicapPick(fixture.teams.home.name, market.homeLine);
  const awayPick = formatHandicapPick(fixture.teams.away.name, -market.homeLine);
  const options = [
    {
      key: "home",
      pick: homePick,
      label: `Likely ${homePick}`,
      probability: market.probabilities.home
    },
    {
      key: "away",
      pick: awayPick,
      label: `Likely ${awayPick}`,
      probability: market.probabilities.away
    }
  ].sort((a, b) => b.probability - a.probability);
  const [best, next] = options;
  const rankScore = Math.round(best.probability * 100);
  const selectedPrice = market.bestPrices[best.key];
  const selectedHandicapLine = best.key === "home" ? market.homeLine : -market.homeLine;
  const candidate = {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league?.country ?? "International",
    league: fixture.league?.name ?? "Unknown competition",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    side: `AH_${best.key.toUpperCase()}`,
    label: best.label,
    marketType: "AH",
    selection: best.key,
    handicapLine: selectedHandicapLine,
    selectedOdd: selectedPrice.odd,
    selectedBookmaker: selectedPrice.bookmaker,
    impliedProbability: round(best.probability, 4),
    marketEdge: round(best.probability - next.probability, 4),
    mainSignal: {
      market: "Asian Handicap odds",
      pick: best.pick,
      label: best.label,
      kind: "HANDICAP",
      score: clamp(rankScore, 25, 90)
    },
    rankScore,
    baseRankScore: rankScore,
    dataQuality: market.bookmakers >= 5 ? "high" : market.bookmakers >= 2 ? "medium" : "limited",
    projectedGoals: null,
    advice: "",
    underOver: "",
    winner: best.pick,
    winnerComment: "Inferred from current Asian Handicap odds",
    percent: {
      home: formatPercent(market.probabilities.home),
      draw: "",
      away: formatPercent(market.probabilities.away)
    },
    form: { home: "", away: "" },
    reasons: [
      `Asian Handicap line: ${formatHandicapPick(fixture.teams.home.name, market.homeLine)} / ${formatHandicapPick(fixture.teams.away.name, -market.homeLine)}`,
      `Odds-implied split: ${formatPercent(market.probabilities.home)}/${formatPercent(market.probabilities.away)}`,
      `Best current price: ${best.pick} @ ${selectedPrice.odd} (${selectedPrice.bookmaker})`,
      `Bookmakers sampled: ${market.bookmakers}`,
      `Market edge over next side: ${formatPercent(best.probability - next.probability)}`
    ]
  };
  const verdict = evaluateOddsCandidate({ candidate, market, best, next, config: agentConfig });
  if (!verdict.passed) return null;
  return {
    ...candidate,
    reasons: [
      ...candidate.reasons,
      `Agent verdict: PASS - ${verdict.reasons.join("; ")}`
    ]
  };
}

function compareOddsCandidates(a, b) {
  const kickoffDifference = new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
  const qualityDifference = qualityRank(b.dataQuality) - qualityRank(a.dataQuality);
  return qualityDifference || b.rankScore - a.rankScore || kickoffDifference;
}

function applyModelSignals(candidate, modelSignals) {
  if (!modelSignals || candidate.marketType !== "1X2") {
    return {
      ...candidate,
      modelSignals: { status: modelSignals ? "unsupported-market" : "unavailable" }
    };
  }

  const valueBet = (modelSignals.valueBets ?? [])
    .find((item) => item.marketType === "1X2" && item.selection === candidate.selection);
  const probability = (modelSignals.probabilities ?? [])
    .find((item) => item.marketType === "1X2")?.probabilities?.[candidate.selection];

  const reasons = [];
  let adjustment = 0;
  const model = {
    status: "checked",
    valueBet: null,
    probability: probability ?? null,
    adjustment: 0
  };

  if (valueBet) {
    const fairProbability = valueBet.fairOdd ? 1 / valueBet.fairOdd : null;
    const fairEdge = fairProbability === null ? null : fairProbability - candidate.impliedProbability;
    model.valueBet = {
      isValue: valueBet.isValue,
      odd: valueBet.odd,
      fairOdd: valueBet.fairOdd,
      bookmaker: valueBet.bookmaker,
      stake: valueBet.stake,
      fairEdge: fairEdge === null ? null : round(fairEdge, 4)
    };
    if (valueBet.isValue || (valueBet.fairOdd && candidate.selectedOdd > valueBet.fairOdd)) {
      adjustment += 5;
      reasons.push(
        `SportsMonks value bet agrees: fair odd ${valueBet.fairOdd ?? "n/a"}, best price ${candidate.selectedOdd}`
      );
    } else {
      reasons.push(
        `SportsMonks value check: no clear value at fair odd ${valueBet.fairOdd ?? "n/a"}`
      );
    }
  }

  if (probability !== undefined && probability !== null) {
    const probabilityEdge = probability - candidate.impliedProbability;
    model.probabilityEdge = round(probabilityEdge, 4);
    if (probabilityEdge >= 0.04) {
      adjustment += 3;
      reasons.push(
        `SportsMonks probability edge: ${formatPercent(probability)} vs market ${formatPercent(candidate.impliedProbability)}`
      );
    } else {
      reasons.push(
        `SportsMonks probability: ${formatPercent(probability)} vs market ${formatPercent(candidate.impliedProbability)}`
      );
    }
  }

  if (!reasons.length) {
    return {
      ...candidate,
      modelSignals: { status: "none" },
      reasons: [...candidate.reasons, "SportsMonks model layer: no matching value/probability signal"]
    };
  }

  adjustment = clamp(adjustment, 0, 8);
  model.adjustment = adjustment;
  return {
    ...candidate,
    rankScore: clamp(candidate.rankScore + adjustment, 25, 95),
    mainSignal: {
      ...candidate.mainSignal,
      score: clamp(candidate.mainSignal.score + adjustment, 25, 95)
    },
    modelSignals: model,
    reasons: [...candidate.reasons, ...reasons]
  };
}

function applyCalibration(candidate, calibrationStats) {
  const stats = calibrationStats?.forCandidate?.(candidate);
  if (!stats) {
    return {
      ...candidate,
      calibration: { status: "collecting", samples: 0 },
      reasons: [...candidate.reasons, "Calibration: collecting local result history"]
    };
  }

  const hitRate = stats.decisions ? stats.wins / stats.decisions : 0;
  const roi = stats.staked ? stats.profit / stats.staked : 0;
  const adjustment = clamp(Math.round(roi * 20), -8, 8);
  const rankScore = clamp(candidate.rankScore + adjustment, 25, 95);
  return {
    ...candidate,
    rankScore,
    mainSignal: {
      ...candidate.mainSignal,
      score: clamp(candidate.mainSignal.score + adjustment, 25, 95)
    },
    calibration: {
      status: "ready",
      scope: stats.scope,
      samples: stats.samples,
      decisions: stats.decisions,
      hitRate: round(hitRate, 3),
      roi: round(roi, 3),
      adjustment
    },
    reasons: [
      ...candidate.reasons,
      `Calibration: ${stats.scope} ${stats.decisions} settled picks, ${formatPercent(hitRate)} hit rate, ${formatSignedPercent(roi)} ROI`
    ]
  };
}

export function rankDigestCandidates(candidates, limit = 12) {
  return candidates
    .filter((candidate) => candidate && candidate.dataQuality !== "limited")
    .sort((a, b) => {
      const kickoffDifference = new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
      const qualityDifference = qualityRank(b.dataQuality) - qualityRank(a.dataQuality);
      return kickoffDifference || qualityDifference || b.rankScore - a.rankScore;
    })
    .slice(0, limit);
}

function estimateOver25Probability({ projectedGoals, advice = "", underOver = "" }) {
  let probability = projectedGoals === null
    ? 0.5
    : poissonOverProbability(projectedGoals, 2);
  const text = `${advice} ${underOver}`.toLowerCase();
  if (/over\s*2\.5|over 2\.5/.test(text)) probability += 0.12;
  if (/under\s*2\.5|under 2\.5/.test(text)) probability -= 0.12;
  if (/over\s*1\.5/.test(text)) probability += 0.04;
  if (/under\s*3\.5/.test(text)) probability -= 0.03;
  return clamp(probability, 0.25, 0.75);
}

function chooseMainSignal({
  home,
  away,
  totalSide,
  totalLabel,
  overProbability,
  percent,
  winner,
  advice = "",
  underOver = ""
}) {
  const resultSignal = buildResultSignal({ home, away, percent, winner });
  if (resultSignal) return resultSignal;

  const totalsSignal = {
    market: "Total goals 2.5",
    pick: totalSide === "OVER_2_5" ? "Over 2.5" : "Under 2.5",
    label: totalLabel,
    kind: "TOTALS",
    score: Math.round(Math.max(overProbability, 1 - overProbability) * 100)
  };
  const text = `${advice} ${underOver}`.toLowerCase();
  if (text.includes(totalsSignal.pick.toLowerCase())) {
    totalsSignal.score += 3;
  }

  return { ...totalsSignal, score: clamp(totalsSignal.score, 25, 78) };
}

function buildResultSignal({ home, away, percent, winner }) {
  const options = [
    { key: "home", label: `Likely ${home} win`, pick: home },
    { key: "draw", label: "Likely draw", pick: "Draw" },
    { key: "away", label: `Likely ${away} win`, pick: away }
  ].map((option) => ({ ...option, score: percentageNumber(percent[option.key]) }));
  options.sort((a, b) => b.score - a.score);
  const [best, next] = options;
  const winnerName = winner?.name ?? "";
  const winnerMatches =
    winnerName &&
    (normalizeName(winnerName) === normalizeName(home) ||
      normalizeName(winnerName) === normalizeName(away));

  if (best.score < 50 && !winnerMatches) return null;
  if (best.score - next.score < 8 && !winnerMatches) return null;
  if (winnerMatches && normalizeName(winnerName) !== normalizeName(best.pick)) return null;

  return {
    market: "1X2 match result",
    pick: best.pick,
    label: best.label,
    kind: "RESULT",
    score: clamp(winnerMatches ? best.score + 10 : best.score, 25, 78)
  };
}

function calculateProjectedGoals(response) {
  const teams = response?.teams ?? {};
  const metrics = [];
  for (const side of ["home", "away"]) {
    const goals = teams[side]?.league?.goals;
    addNumber(metrics, goals?.for?.average?.total);
    addNumber(metrics, goals?.against?.average?.total);
    addNumber(metrics, goals?.for?.average?.home);
    addNumber(metrics, goals?.for?.average?.away);
    addNumber(metrics, goals?.against?.average?.home);
    addNumber(metrics, goals?.against?.average?.away);
  }

  const homeAttack = numberOrNull(teams.home?.league?.goals?.for?.average?.home);
  const awayDefense = numberOrNull(teams.away?.league?.goals?.against?.average?.away);
  const awayAttack = numberOrNull(teams.away?.league?.goals?.for?.average?.away);
  const homeDefense = numberOrNull(teams.home?.league?.goals?.against?.average?.home);
  const homeExpected = average(
    [homeAttack, awayDefense].filter((value) => value !== null)
  );
  const awayExpected = average(
    [awayAttack, homeDefense].filter((value) => value !== null)
  );

  if (homeExpected !== null && awayExpected !== null) {
    return {
      projectedGoals: homeExpected + awayExpected,
      expectedHomeGoals: homeExpected,
      expectedAwayGoals: awayExpected,
      dataPoints: metrics.length
    };
  }
  const averageTeamGoals = average(metrics);
  const projectedGoals = averageTeamGoals === null ? null : averageTeamGoals * 2;
  return {
    projectedGoals,
    expectedHomeGoals: projectedGoals === null ? null : projectedGoals / 2,
    expectedAwayGoals: projectedGoals === null ? null : projectedGoals / 2,
    dataPoints: metrics.length
  };
}

function buildReasons({ projectedGoals, underOver, advice, percent, winner, comparison }) {
  const reasons = [];
  if (percent.home || percent.draw || percent.away) {
    reasons.push(`Result split: ${percent.home}/${percent.draw}/${percent.away}`);
  }
  if (winner?.name) {
    reasons.push(`API winner: ${winner.name}${winner.comment ? ` (${winner.comment})` : ""}`);
  }
  if (advice) reasons.push(advice);
  if (underOver) reasons.push(`API goals view: ${underOver}`);
  if (projectedGoals !== null) {
    reasons.push(`Modelled total: ${round(projectedGoals, 2)} goals`);
  }
  const goalsComparison = comparison.goals;
  if (goalsComparison?.home && goalsComparison?.away) {
    reasons.push(`Goals comparison: ${goalsComparison.home} vs ${goalsComparison.away}`);
  }
  return reasons.slice(0, 4);
}

function parsePercentages(percent = {}) {
  return {
    home: percent.home ?? "",
    draw: percent.draw ?? "",
    away: percent.away ?? ""
  };
}

function summarizeMatchWinnerOdds({ home, away, oddsResponse }) {
  const snapshots = [];
  const bestPrices = {
    home: null,
    draw: null,
    away: null
  };
  const priceLists = {
    home: [],
    draw: [],
    away: []
  };

  for (const fixtureOdds of oddsResponse) {
    for (const bookmaker of fixtureOdds.bookmakers ?? []) {
      const bet = (bookmaker.bets ?? []).find((item) => isMatchWinnerMarket(item.name));
      const prices = parseMatchWinnerPrices({ bet, home, away });
      if (!prices) continue;

      for (const key of ["home", "draw", "away"]) {
        priceLists[key].push(prices[key]);
        if (!bestPrices[key] || prices[key] > bestPrices[key].odd) {
          bestPrices[key] = {
            odd: prices[key],
            bookmaker: bookmaker.name ?? "Unknown bookmaker"
          };
        }
      }

      const implied = {
        home: 1 / prices.home,
        draw: 1 / prices.draw,
        away: 1 / prices.away
      };
      const total = implied.home + implied.draw + implied.away;
      if (!Number.isFinite(total) || total <= 0) continue;
      snapshots.push({
        home: implied.home / total,
        draw: implied.draw / total,
        away: implied.away / total
      });
    }
  }

  if (!snapshots.length || !bestPrices.home || !bestPrices.draw || !bestPrices.away) {
    return null;
  }

  return {
    probabilities: {
      home: average(snapshots.map((item) => item.home)),
      draw: average(snapshots.map((item) => item.draw)),
      away: average(snapshots.map((item) => item.away))
    },
    bestPrices,
    priceSpreads: {
      home: priceSpread(priceLists.home),
      draw: priceSpread(priceLists.draw),
      away: priceSpread(priceLists.away)
    },
    bookmakers: snapshots.length
  };
}

function summarizeAsianHandicapOdds({ home, away, oddsResponse }) {
  const marketsByLine = new Map();

  for (const fixtureOdds of oddsResponse) {
    for (const bookmaker of fixtureOdds.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        if (!isAsianHandicapMarket(bet.name)) continue;
        const pricesByLine = parseAsianHandicapPrices({ bet, home, away });
        for (const [homeLine, prices] of pricesByLine) {
          if (!marketsByLine.has(homeLine)) {
            marketsByLine.set(homeLine, {
              homeLine,
              snapshots: [],
              bestPrices: { home: null, away: null },
              priceLists: { home: [], away: [] }
            });
          }
          const market = marketsByLine.get(homeLine);
          for (const key of ["home", "away"]) {
            market.priceLists[key].push(prices[key]);
            if (!market.bestPrices[key] || prices[key] > market.bestPrices[key].odd) {
              market.bestPrices[key] = {
                odd: prices[key],
                bookmaker: bookmaker.name ?? "Unknown bookmaker"
              };
            }
          }

          const implied = {
            home: 1 / prices.home,
            away: 1 / prices.away
          };
          const total = implied.home + implied.away;
          if (!Number.isFinite(total) || total <= 0) continue;
          market.snapshots.push({
            home: implied.home / total,
            away: implied.away / total
          });
        }
      }
    }
  }

  const markets = [...marketsByLine.values()]
    .filter((market) => market.snapshots.length && market.bestPrices.home && market.bestPrices.away)
    .map((market) => ({
      homeLine: market.homeLine,
      probabilities: {
        home: average(market.snapshots.map((item) => item.home)),
        away: average(market.snapshots.map((item) => item.away))
      },
      bestPrices: market.bestPrices,
      priceSpreads: {
        home: priceSpread(market.priceLists.home),
        away: priceSpread(market.priceLists.away)
      },
      bookmakers: market.snapshots.length
    }));

  if (!markets.length) return null;
  return markets.sort((a, b) => {
    const aEdge = Math.abs(a.probabilities.home - a.probabilities.away);
    const bEdge = Math.abs(b.probabilities.home - b.probabilities.away);
    return bEdge - aEdge || b.bookmakers - a.bookmakers;
  })[0];
}

function priceSpread(values) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function isMatchWinnerMarket(name = "") {
  const normalized = String(name).toLowerCase();
  return (
    /match winner|1x2|full.?time result|winner/.test(normalized) &&
    !/double chance|half|period|corner|card|1st|2nd/.test(normalized)
  );
}

function parseMatchWinnerPrices({ bet, home, away }) {
  if (!bet) return null;
  const prices = {};
  for (const value of bet.values ?? []) {
    const key = matchWinnerKey(value.value, { home, away });
    const odd = Number.parseFloat(value.odd);
    if (!key || !Number.isFinite(odd) || odd <= 1) continue;
    prices[key] = odd;
  }
  return prices.home && prices.draw && prices.away ? prices : null;
}

function matchWinnerKey(value, { home, away }) {
  const normalized = normalizeName(value);
  if (["home", "1"].includes(normalized) || normalized === normalizeName(home)) return "home";
  if (["draw", "x"].includes(normalized)) return "draw";
  if (["away", "2"].includes(normalized) || normalized === normalizeName(away)) return "away";
  return null;
}

function isAsianHandicapMarket(name = "") {
  const normalized = String(name).toLowerCase();
  return /asian handicap|handicap/.test(normalized) && !/corner|card|1st|2nd|half|period/.test(normalized);
}

function parseAsianHandicapPrices({ bet, home, away }) {
  const partials = new Map();
  for (const value of bet.values ?? []) {
    const parsed = parseAsianHandicapValue(value.value, { home, away });
    const odd = Number.parseFloat(value.odd);
    if (!parsed || !Number.isFinite(odd) || odd <= 1) continue;

    const homeLine = parsed.side === "home" ? parsed.line : -parsed.line;
    if (!partials.has(homeLine)) partials.set(homeLine, {});
    partials.get(homeLine)[parsed.side] = odd;
  }

  const complete = new Map();
  for (const [homeLine, prices] of partials) {
    if (prices.home && prices.away) complete.set(homeLine, prices);
  }
  return complete;
}

function parseAsianHandicapValue(value, { home, away }) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const side = handicapSide(match[1], { home, away });
  const line = Number.parseFloat(match[2]);
  if (!side || !Number.isFinite(line)) return null;
  return { side, line };
}

function handicapSide(value, { home, away }) {
  const normalized = normalizeName(value);
  if (["home", "1"].includes(normalized) || normalized === normalizeName(home)) return "home";
  if (["away", "2"].includes(normalized) || normalized === normalizeName(away)) return "away";
  return null;
}

function formatHandicapPick(team, line) {
  return `${team} ${formatSignedLine(line)}`;
}

function formatSignedLine(line) {
  if (Object.is(line, -0) || line === 0) return "0";
  return `${line > 0 ? "+" : ""}${line}`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value) {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function percentageNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function countComparisonSignals(comparison) {
  return Object.values(comparison).filter(
    (value) => value && (value.home !== undefined || value.away !== undefined)
  ).length;
}

function countResultPredictionSignals({ percent, winner }) {
  return [percent.home, percent.draw, percent.away, winner?.name].filter(Boolean).length;
}

function poissonOverProbability(lambda, threshold) {
  let cumulative = 0;
  for (let goals = 0; goals <= threshold; goals++) {
    cumulative += (Math.exp(-lambda) * lambda ** goals) / factorial(goals);
  }
  return 1 - cumulative;
}

function factorial(value) {
  let result = 1;
  for (let number = 2; number <= value; number++) result *= number;
  return result;
}

function qualityRank(value) {
  return { limited: 0, medium: 1, high: 2 }[value] ?? 0;
}

function addNumber(target, value) {
  const parsed = numberOrNull(value);
  if (parsed !== null) target.push(parsed);
}

function numberOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
