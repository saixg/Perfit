// Turns a stored FitProfile into the numbers the scorer needs (spec step 3, "Reference garment").

import { bandMid, type EngineConfig } from './config.ts';
import type {
  Category, FitProfile, FitType, NormalizedChart, ReferenceGarment, ResolvedProfile,
} from './types.ts';

const VERDICT_RANK = { perfect: 0, slightly_tight: 1, slightly_loose: 1 } as const;

/** Best reference garment for this category: "perfect" verdicts first, then input order. */
export function pickReference(profile: FitProfile, category: Category): ReferenceGarment | undefined {
  const refs = (profile.referenceGarments ?? []).filter((g) => g.category === category);
  return [...refs].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])[0];
}

/**
 * Resolve body chest, shoulder, preferred length and the personal chest offset.
 * Returns null when no chest can be determined (no body chest and no reference garment).
 */
export function resolveProfile(profile: FitProfile, category: Category, config: EngineConfig): ResolvedProfile | null {
  const ref = pickReference(profile, category);
  const body = profile.body;
  const verdictAdj = ref && ref.verdict !== 'perfect' ? config.verdictShift[ref.verdict] : 0;

  let chestCm: number | undefined = body?.chestCm;
  let offsetCm = 0;
  if (ref) {
    const refMid = bandMid(config.chestEase[ref.category][ref.fitType]);
    if (chestCm != null) {
      // Offset = (your shirt's chest − your body chest) − middle of that shirt's band.
      offsetCm = ref.chestCm - chestCm - refMid;
    } else {
      // No body numbers: body chest ≈ reference chest − middle of its band.
      chestCm = ref.chestCm - refMid;
    }
    offsetCm += verdictAdj;
  }
  if (chestCm == null) return null;
  offsetCm += profile.feedbackOffsetCm ?? 0;

  let shoulderCm: number | undefined = body?.shoulderCm;
  let shoulderSource: ResolvedProfile['shoulderSource'] = shoulderCm != null ? 'body' : 'none';
  if (shoulderCm == null && ref?.shoulderCm != null) {
    shoulderCm = ref.shoulderCm - bandMid(config.shoulderEase);
    shoulderSource = 'reference_garment';
  }

  let preferredLengthCm: number | undefined;
  let lengthSource: ResolvedProfile['lengthSource'] = 'none';
  if (profile.preferredLengthCm != null) { preferredLengthCm = profile.preferredLengthCm; lengthSource = 'explicit'; }
  else if (ref?.lengthCm != null) { preferredLengthCm = ref.lengthCm; lengthSource = 'reference_garment'; }
  else if (body?.heightCm != null) {
    preferredLengthCm = body.heightCm * config.lengthFromHeightRatio[category];
    lengthSource = 'height';
  }

  const qualitySource: ResolvedProfile['qualitySource'] = ref
    ? 'reference_garment'
    : body?.source === 'photo' ? 'photo' : body?.source === 'brand_size' ? 'brand_size' : 'tape';

  return {
    chestCm,
    shoulderCm,
    preferredLengthCm,
    offsetCm,
    quality: config.confidence.profile[qualitySource],
    qualitySource,
    lengthSource,
    shoulderSource,
    reference: ref,
  };
}

/**
 * "H&M L fits me well" (lite): solve body chest backwards from a cached chart.
 * Garment chart: chart chest − middle of ease band. Body chart: middle of the range.
 */
export function bodyChestFromKnownSize(
  chart: NormalizedChart, sizeLabel: string, category: Category, fitType: FitType, config: EngineConfig,
): number | null {
  const size = chart.sizes.find((s) => s.label.toUpperCase() === sizeLabel.trim().toUpperCase()
    || s.brandLabel?.toUpperCase() === sizeLabel.trim().toUpperCase());
  const chest = size?.points.chest;
  if (!chest) return null;
  const mid = (chest.min + chest.max) / 2;
  return chest.basis === 'body' ? mid : mid - bandMid(config.chestEase[category][fitType]);
}

/** Spec step 7: feedback nudges the learned offset by ±0.5 in, capped at ±2 in. */
export function applyFeedback(
  currentOffsetCm: number, overall: 'perfect' | 'tight' | 'loose' | 'returned', config: EngineConfig,
): number {
  const delta = overall === 'tight' ? config.feedback.step : overall === 'loose' ? -config.feedback.step : 0;
  return Math.max(-config.feedback.cap, Math.min(config.feedback.cap, currentOffsetCm + delta));
}
