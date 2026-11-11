import type { Category, ChartSource, FitPref, FitType, ScoredPoint } from './types.ts';
import { inch } from './units.ts';

/** Bump on ANY change that can alter a recommendation (spec step 7). */
export const ENGINE_VERSION = '0.1.0';

export interface Band { lo: number; hi: number }
export interface Tau { tight: number; loose: number }

/**
 * Every tunable number lives here so calibration never touches logic.
 * All lengths in cm (authored via inch()).
 */
export interface EngineConfig {
  version: string;
  /** Chest ease = garment chest − body chest, full circumference. */
  chestEase: Record<Category, Record<FitType, Band>>;
  /** Garment shoulder − body shoulder. */
  shoulderEase: Band;
  /** Allowed deviation of garment length from preferred length. */
  lengthTolerance: number;
  tau: Record<ScoredPoint, Tau>;
  weights: Record<ScoredPoint, number>;
  /** User preference nudges the product's ease band (decided: product label wins, preference shifts). */
  fitPrefShift: Record<FitPref, number>;
  /** Reference garment verdict adjusts the personal offset. */
  verdictShift: { slightly_tight: number; slightly_loose: number };
  /** Half-width given to single-value BODY chart entries ("To fit chest 40"). */
  bodyPointTolerance: number;
  /** Default preferred length = height × ratio when nothing better exists. */
  lengthFromHeightRatio: Record<Category, number>;
  confidence: {
    chartSource: Record<ChartSource, number>;
    basis: { stated: number; inferred: number; unknown: number };
    profile: { reference_garment: number; tape: number; photo: number; brand_size: number };
    /** Multiplier applied once per distinct quality flag. */
    flagFactor: number;
    flagFloor: number;
    marginBase: number;
    marginSlope: number;
    high: number;
    medium: number;
  };
  sanity: { chestStepMin: number; chestStepMax: number };
  feedback: { step: number; cap: number };
}

const band = (lo: number, hi: number): Band => ({ lo: inch(lo), hi: inch(hi) });

export const DEFAULT_CONFIG: EngineConfig = {
  version: ENGINE_VERSION,
  // Regular/relaxed shirt bands follow a published 3–4 / 5–6 in guide; the rest
  // are starting assumptions to calibrate with feedback (see blueprint).
  chestEase: {
    shirt: {
      slim: band(2.0, 3.5),
      regular: band(3.0, 5.0),
      relaxed: band(5.0, 7.0),
      oversized: band(7.0, 12.0),
    },
    tshirt: {
      slim: band(0.5, 2.0),
      regular: band(2.0, 4.0),
      relaxed: band(4.0, 6.0),
      oversized: band(6.0, 12.0),
    },
  },
  shoulderEase: band(-0.5, 1.0),
  lengthTolerance: inch(1),
  tau: {
    chest: { tight: inch(1), loose: inch(2) },
    shoulder: { tight: inch(0.5), loose: inch(1) },
    length: { tight: inch(1), loose: inch(1) },
  },
  weights: { chest: 0.55, shoulder: 0.25, length: 0.2 },
  fitPrefShift: { snug: inch(-0.5), regular: 0, relaxed: inch(0.5) },
  verdictShift: { slightly_tight: inch(0.5), slightly_loose: inch(-0.5) },
  bodyPointTolerance: inch(0.5),
  // ~0.41 × height ≈ 28.2 in for a 175 cm man; a starting guess.
  lengthFromHeightRatio: { shirt: 0.41, tshirt: 0.395 },
  confidence: {
    chartSource: { structured_json: 1.0, html_table: 0.95, llm_image: 0.8, brand_default: 0.6 },
    basis: { stated: 1.0, inferred: 0.9, unknown: 0.75 },
    profile: { reference_garment: 0.95, tape: 0.9, photo: 0.75, brand_size: 0.7 },
    flagFactor: 0.9,
    flagFloor: 0.5,
    marginBase: 0.7,
    marginSlope: 0.3,
    high: 0.8,
    medium: 0.6,
  },
  sanity: { chestStepMin: inch(1), chestStepMax: inch(4) },
  feedback: { step: inch(0.5), cap: inch(2) },
};

export const bandMid = (b: Band): number => (b.lo + b.hi) / 2;
