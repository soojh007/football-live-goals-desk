import fs from "node:fs";
import path from "node:path";
import { buildCalibrationStats, candidateKey } from "./calibration.js";

export class CalibrationStore {
  constructor(directory = path.resolve("data")) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  appendDigestCandidates(report) {
    for (const candidate of report.candidates ?? []) {
      this.append("digest-candidates", {
        reportGeneratedAt: report.generatedAt,
        windowStart: report.windowStart,
        windowEnd: report.windowEnd,
        ...trackingCandidate(candidate)
      });
    }
  }

  appendSettledResult(result) {
    this.append("calibration-results", result);
  }

  loadPendingCandidates({ now = new Date(), settleAfterHours = 3 } = {}) {
    const settled = new Set(this.loadSettledResults().map((result) => result.key));
    const cutoff = now.getTime() - settleAfterHours * 60 * 60_000;
    const pendingByKey = new Map();

    for (const candidate of this.loadCandidates()) {
      const key = candidate.key ?? candidateKey(candidate);
      if (settled.has(key)) continue;
      const kickoff = new Date(candidate.kickoff).getTime();
      if (!Number.isFinite(kickoff) || kickoff > cutoff) continue;
      pendingByKey.set(key, { ...candidate, key });
    }

    return [...pendingByKey.values()];
  }

  loadSettledResults() {
    return this.readJsonl("calibration-results");
  }

  loadCalibrationStats(options) {
    return buildCalibrationStats(this.loadSettledResults(), options);
  }

  loadCandidates() {
    return this.readJsonl("digest-candidates");
  }

  append(kind, payload) {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(this.directory, `${kind}-${day}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...payload })}\n`);
  }

  readJsonl(kind) {
    const records = [];
    for (const file of this.filesForKind(kind)) {
      const content = fs.readFileSync(file, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          // Ignore malformed local history lines instead of breaking the digest.
        }
      }
    }
    return records;
  }

  filesForKind(kind) {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory)
      .filter((file) => file.startsWith(`${kind}-`) && file.endsWith(".jsonl"))
      .sort()
      .map((file) => path.join(this.directory, file));
  }
}

function trackingCandidate(candidate) {
  return {
    key: candidateKey(candidate),
    fixtureId: candidate.fixtureId,
    kickoff: candidate.kickoff,
    country: candidate.country,
    league: candidate.league,
    home: candidate.home,
    away: candidate.away,
    marketType: candidate.marketType,
    selection: candidate.selection,
    handicapLine: candidate.handicapLine ?? null,
    selectedOdd: candidate.selectedOdd,
    selectedBookmaker: candidate.selectedBookmaker,
    impliedProbability: candidate.impliedProbability,
    marketEdge: candidate.marketEdge,
    baseRankScore: candidate.baseRankScore ?? candidate.rankScore,
    rankScore: candidate.rankScore
  };
}
