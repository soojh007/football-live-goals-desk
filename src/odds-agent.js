const DEFAULT_CONFIG = {
  enabled: true,
  minimumBookmakers: 3,
  minimumTopProbability: 0.45,
  minimumEdge: 0.08,
  minimumOdd: 1.5,
  maximumOdd: 3.5,
  maximumPriceSpread: 0.35
};

export function evaluateOddsCandidate({ candidate, market, best, next, config = {} }) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  if (!settings.enabled) {
    return {
      passed: true,
      reasons: ["Agent disabled"]
    };
  }

  const selectedPrice = market.bestPrices[best.key];
  const spread = market.priceSpreads[best.key] ?? 0;
  const failures = [];
  const passes = [];

  if (market.bookmakers < settings.minimumBookmakers) {
    failures.push(`only ${market.bookmakers} bookmakers`);
  } else {
    passes.push(`${market.bookmakers} bookmakers`);
  }

  if (best.probability < settings.minimumTopProbability) {
    failures.push(`top probability ${formatPercent(best.probability)} below ${formatPercent(settings.minimumTopProbability)}`);
  } else {
    passes.push(`${formatPercent(best.probability)} top probability`);
  }

  const edge = best.probability - next.probability;
  if (edge < settings.minimumEdge) {
    failures.push(`edge ${formatPercent(edge)} below ${formatPercent(settings.minimumEdge)}`);
  } else {
    passes.push(`${formatPercent(edge)} edge`);
  }

  if (selectedPrice.odd < settings.minimumOdd || selectedPrice.odd > settings.maximumOdd) {
    failures.push(`price ${selectedPrice.odd} outside ${settings.minimumOdd}-${settings.maximumOdd}`);
  } else {
    passes.push(`price ${selectedPrice.odd} in range`);
  }

  if (spread > settings.maximumPriceSpread) {
    failures.push(`bookmaker spread ${spread.toFixed(2)} above ${settings.maximumPriceSpread}`);
  } else {
    passes.push(`spread ${spread.toFixed(2)}`);
  }

  return {
    passed: failures.length === 0,
    reasons: failures.length ? failures : passes.slice(0, 4),
    candidate
  };
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}
