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
  return (
    filters.countries.has(normalizeFilterValue(fixture.league?.country)) ||
    filters.leagues.has(normalizeFilterValue(fixture.league?.name))
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
