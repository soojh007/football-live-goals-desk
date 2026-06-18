const ELIGIBLE_STATUSES = new Set(["NS", "TBD"]);

export function selectDigestFixtures(fixtures, { maxAnalyses = 40, now = new Date() } = {}) {
  const eligible = fixtures.filter((fixture) => {
    const status = fixture.fixture?.status?.short;
    const kickoff = new Date(fixture.fixture?.date ?? 0);
    return (
      fixture.fixture?.id &&
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
  { maxAnalyses = 15, start = new Date(), end } = {}
) {
  const endTime = end instanceof Date ? end.getTime() : start.getTime() + 3 * 60 * 60_000;
  const eligible = fixtures.filter((fixture) => {
    const status = fixture.fixture?.status?.short;
    const kickoff = new Date(fixture.fixture?.date ?? 0).getTime();
    return (
      fixture.fixture?.id &&
      ELIGIBLE_STATUSES.has(status) &&
      kickoff >= start.getTime() &&
      kickoff <= endTime &&
      fixture.teams?.home?.id &&
      fixture.teams?.away?.id
    );
  });

  return selectAcrossCountries(eligible, maxAnalyses);
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
  const rankScore = Math.round(
    Math.max(overProbability, 1 - overProbability) * 100
  );
  const dataPoints = goalModel.dataPoints + countComparisonSignals(comparison);

  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league?.country ?? "International",
    league: fixture.league?.name ?? "Unknown competition",
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    side,
    label,
    mainSignal: {
      market: "Total goals 2.5",
      pick: side === "OVER_2_5" ? "Over 2.5" : "Under 2.5",
      label
    },
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
      comparison
    })
  };
}

export function rankDigestCandidates(candidates, limit = 12) {
  return candidates
    .filter((candidate) => candidate && candidate.dataQuality !== "limited")
    .sort((a, b) => {
      const qualityDifference = qualityRank(b.dataQuality) - qualityRank(a.dataQuality);
      return qualityDifference || b.rankScore - a.rankScore;
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
      dataPoints: metrics.length
    };
  }
  const averageTeamGoals = average(metrics);
  return {
    projectedGoals: averageTeamGoals === null ? null : averageTeamGoals * 2,
    dataPoints: metrics.length
  };
}

function buildReasons({ projectedGoals, underOver, advice, percent, comparison }) {
  const reasons = [];
  if (projectedGoals !== null) {
    reasons.push(`Modelled total: ${round(projectedGoals, 2)} goals`);
  }
  if (underOver) reasons.push(`API view: ${underOver}`);
  if (advice) reasons.push(advice);
  if (percent.home || percent.draw || percent.away) {
    reasons.push(`Result split: ${percent.home}/${percent.draw}/${percent.away}`);
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

function countComparisonSignals(comparison) {
  return Object.values(comparison).filter(
    (value) => value && (value.home !== undefined || value.away !== undefined)
  ).length;
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
