// Spec step 5: confidence = chart source × basis certainty × profile quality × coverage × margin
// (× chart quality: one factor per sanity flag, so bad seller data visibly lowers trust).

import type { EngineConfig } from './config.ts';
import type {
  ConfidenceBand, ConfidenceParts, FitType, NormalizedChart, ResolvedProfile, SizeScore,
} from './types.ts';

export function wantedPoints(fitType: FitType): number {
  return fitType === 'oversized' ? 2 : 3; // oversized skips shoulder by design
}

export function computeConfidence(
  chart: NormalizedChart,
  profile: ResolvedProfile,
  best: SizeScore,
  runnerUp: SizeScore | undefined,
  fitType: FitType,
  config: EngineConfig,
): { confidence: number; band: ConfidenceBand; parts: ConfidenceParts } {
  const c = config.confidence;
  const coverage = Math.min(1, best.points.length / wantedPoints(fitType));
  const margin = runnerUp ? Math.min(1, c.marginBase + c.marginSlope * (runnerUp.score - best.score)) : 1;
  const chartQuality = Math.max(c.flagFloor, c.flagFactor ** chart.flags.length);
  const parts: ConfidenceParts = {
    chartSource: c.chartSource[chart.source],
    basisCertainty: c.basis[chart.basisCertainty],
    profileQuality: profile.quality,
    coverage,
    margin,
    chartQuality,
  };
  const confidence = parts.chartSource * parts.basisCertainty * parts.profileQuality
    * parts.coverage * parts.margin * parts.chartQuality;
  const band: ConfidenceBand = confidence >= c.high ? 'high' : confidence >= c.medium ? 'medium' : 'low';
  return { confidence, band, parts };
}
