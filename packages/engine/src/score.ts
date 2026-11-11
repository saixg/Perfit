// Spec steps 3 (room per point) and 4 (score every size).

import type { Band, EngineConfig, Tau } from './config.ts';
import type {
  Category, FitPref, FitType, Measure, NormalizedSize, PointResult, PointStatus, ResolvedProfile,
  ScoredPoint, SizeScore,
} from './types.ts';

/**
 * Asymmetric squared penalty. `tightBy` / `looseBy` are how far (cm) the value sits
 * beyond the tight / loose edge of its band; at most one is positive.
 */
export function penalty(tightBy: number, looseBy: number, tau: Tau): number {
  if (tightBy > 0) return (tightBy / tau.tight) ** 2;
  if (looseBy > 0) return (looseBy / tau.loose) ** 2;
  return 0;
}

const status = (tightBy: number, looseBy: number): PointStatus =>
  tightBy > 1e-9 ? 'tight' : looseBy > 1e-9 ? 'loose' : 'ok';

const mid = (m: Measure) => (m.min + m.max) / 2;

/** Garment reading: room = garment − user, compared with [lo, hi]. Below lo is tight. */
function garmentPoint(point: ScoredPoint, m: Measure, userCm: number, b: Band, tau: Tau): PointResult {
  const room = mid(m) - userCm;
  const tightBy = b.lo - room;
  const looseBy = room - b.hi;
  return {
    point, reading: 'garment', chartCm: mid(m), chartMinCm: m.min, chartMaxCm: m.max, userCm,
    roomCm: room, bandLo: b.lo, bandHi: b.hi,
    penalty: penalty(tightBy, looseBy, tau), status: status(tightBy, looseBy),
  };
}

/** Body reading: the user's body must fall inside the chart's range. Above max is tight. */
function bodyPoint(point: ScoredPoint, m: Measure, userCm: number, tolerance: number, tau: Tau): PointResult {
  const lo = m.max > m.min ? m.min : m.min - tolerance;
  const hi = m.max > m.min ? m.max : m.max + tolerance;
  const tightBy = userCm - hi;
  const looseBy = lo - userCm;
  return {
    point, reading: 'body', chartCm: mid(m), chartMinCm: m.min, chartMaxCm: m.max, userCm,
    bandLo: lo, bandHi: hi,
    penalty: penalty(tightBy, looseBy, tau), status: status(tightBy, looseBy),
  };
}

export interface ScoreContext {
  category: Category;
  fitType: FitType;
  fitPref: FitPref;
  profile: ResolvedProfile;
  config: EngineConfig;
  /** Force a reading (used for the "score both" path when basis is unknown). */
  forceReading?: 'garment' | 'body';
}

/** The chest band after applying the personal offset and preference shift. */
export function chestBand(ctx: Pick<ScoreContext, 'category' | 'fitType' | 'fitPref' | 'profile' | 'config'>): Band {
  const base = ctx.config.chestEase[ctx.category][ctx.fitType];
  const shift = ctx.profile.offsetCm + ctx.config.fitPrefShift[ctx.fitPref];
  return { lo: base.lo + shift, hi: base.hi + shift };
}

export function scorePoints(size: NormalizedSize, ctx: ScoreContext): PointResult[] {
  const { config, profile } = ctx;
  const out: PointResult[] = [];
  const readingOf = (m: Measure): 'garment' | 'body' =>
    ctx.forceReading ?? (m.basis === 'body' ? 'body' : 'garment');

  const chest = size.points.chest;
  if (chest) {
    out.push(readingOf(chest) === 'body'
      ? bodyPoint('chest', chest, profile.chestCm, config.bodyPointTolerance, config.tau.chest)
      : garmentPoint('chest', chest, profile.chestCm, chestBand(ctx), config.tau.chest));
  }

  // Oversized / drop-shoulder styles skip the shoulder check.
  const shoulder = size.points.shoulder;
  if (shoulder && profile.shoulderCm != null && ctx.fitType !== 'oversized') {
    out.push(readingOf(shoulder) === 'body'
      ? bodyPoint('shoulder', shoulder, profile.shoulderCm, config.bodyPointTolerance, config.tau.shoulder)
      : garmentPoint('shoulder', shoulder, profile.shoulderCm, config.shoulderEase, config.tau.shoulder));
  }

  // Length is always a garment measure: compare with preferred length ± tolerance.
  const length = size.points.length;
  if (length && profile.preferredLengthCm != null) {
    const t = config.lengthTolerance;
    out.push(garmentPoint('length', length, profile.preferredLengthCm, { lo: -t, hi: t }, config.tau.length));
  }
  return out;
}

/** Weighted mean of penalties; missing points are dropped and weights re-normalized. */
export function weightedScore(points: PointResult[], config: EngineConfig): number {
  let num = 0;
  let den = 0;
  for (const p of points) {
    const w = config.weights[p.point];
    num += w * p.penalty;
    den += w;
  }
  return den > 0 ? num / den : Number.POSITIVE_INFINITY;
}

export function scoreSize(size: NormalizedSize, ctx: ScoreContext): SizeScore {
  const points = scorePoints(size, ctx);
  const chest = points.find((p) => p.point === 'chest');
  const centre = chest ? (chest.bandLo + chest.bandHi) / 2 : 0;
  const compared = chest ? (chest.reading === 'garment' ? chest.roomCm! : chest.userCm) : 0;
  return {
    label: size.label,
    brandLabel: size.brandLabel,
    order: size.order,
    score: weightedScore(points, ctx.config),
    points,
    centreDistance: chest ? Math.abs(compared - centre) : Number.POSITIVE_INFINITY,
  };
}

/** Lowest score wins; ties go to the size whose chest sits nearest the band centre. */
export function rankSizes(scores: SizeScore[]): SizeScore[] {
  return [...scores].sort((a, b) =>
    Math.abs(a.score - b.score) > 1e-9 ? a.score - b.score : a.centreDistance - b.centreDistance);
}
