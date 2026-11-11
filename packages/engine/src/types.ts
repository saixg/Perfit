// Core types for the perfit fit engine.
// All normalized lengths are CENTIMETRES, FULL CIRCUMFERENCE (chest/waist/neck),
// matching the database. Raw adapter input may be in any unit / half-measure.

export type Unit = 'in' | 'cm';
export type Category = 'shirt' | 'tshirt';
export type FitType = 'slim' | 'regular' | 'relaxed' | 'oversized';
export type FitPref = 'snug' | 'regular' | 'relaxed';
export type Basis = 'body' | 'garment' | 'unknown';
export type BasisCertainty = 'stated' | 'inferred' | 'unknown';
export type ChartSource = 'structured_json' | 'html_table' | 'llm_image' | 'brand_default';
export type Point = 'chest' | 'waist' | 'shoulder' | 'length' | 'sleeve' | 'neck';
/** Points that take part in scoring (spec step 4). */
export type ScoredPoint = 'chest' | 'shoulder' | 'length';
export const SCORED_POINTS: readonly ScoredPoint[] = ['chest', 'shoulder', 'length'];

// ---------------------------------------------------------------- raw input

/** One measurement cell as an adapter saw it. */
export interface RawMeasurement {
  /** Column header or JSON name, e.g. "Chest", "Across Shoulder", "Pit to pit (cm)". */
  name: string;
  /** Either a number, or a raw string like "41.75", "38-40", "106 cm". */
  value: number | string | null;
  /** Per-value basis when the site states it (Myntra measurementType). */
  basis?: Basis;
  /** Unit for this value when the site states it per value. */
  unit?: Unit;
}

export interface RawSizeRow {
  /** Size label as the retailer shows it: "M", "38", "XL". */
  label: string;
  /** Brand's own label when different (Myntra: size "38" is brand "S"). */
  brandLabel?: string;
  measurements: RawMeasurement[];
}

export interface RawSizeChart {
  source: ChartSource;
  /** Chart-level unit if stated ("Measurements are in Inches"). */
  unit?: Unit;
  /** Chart-level basis if explicitly stated by a label. */
  statedBasis?: Basis;
  /** Free text that may state the basis: "Garment Measurement", "To fit chest". */
  basisLabel?: string;
  sizes: RawSizeRow[];
}

/** What a site adapter produces from one product page. */
export interface ProductSpec {
  retailer: string;
  productId: string;
  brand?: string;
  title?: string;
  category: Category;
  /** Normalized fit type; leave undefined if the page doesn't say. */
  fitType?: FitType;
  /** The page's raw fit text, e.g. "Slim Fit" (used by parseFitType). */
  fitTypeRaw?: string;
  hasStretch?: boolean;
  chart: RawSizeChart | null;
}

// ---------------------------------------------------------------- profile

export interface BodyMeasurements {
  /** How the numbers were obtained; sets profile-quality confidence. */
  source: 'manual' | 'photo' | 'brand_size';
  heightCm?: number;
  weightKg?: number;
  chestCm?: number;
  waistCm?: number;
  shoulderCm?: number;
  neckCm?: number;
  armCm?: number;
}

export type GarmentVerdict = 'perfect' | 'slightly_tight' | 'slightly_loose';

/** A shirt the user owns and likes, measured flat (chest stored as FULL circumference). */
export interface ReferenceGarment {
  category: Category;
  fitType: FitType;
  chestCm: number;
  shoulderCm?: number;
  lengthCm?: number;
  sleeveCm?: number;
  brand?: string;
  sizeLabel?: string;
  verdict: GarmentVerdict;
}

export interface FitProfile {
  unitPref: Unit;
  fitPref: FitPref;
  body?: BodyMeasurements;
  referenceGarments?: ReferenceGarment[];
  /** Explicit preferred garment length (cm), overrides reference/height. */
  preferredLengthCm?: number;
  /** Learned chest-ease offset from purchase feedback (cm), spec step 7. */
  feedbackOffsetCm?: number;
}

// ---------------------------------------------------------------- normalized chart

export interface Measure {
  /** cm, full circumference for girths. min === max for single values. */
  min: number;
  max: number;
  basis: Basis;
}

export interface NormalizedSize {
  label: string;
  brandLabel?: string;
  /** Position in size order, 0 = smallest. */
  order: number;
  points: Partial<Record<Point, Measure>>;
}

export type QualityFlag =
  | 'unit_ambiguous'
  | 'unparsed_value'
  | 'duplicate_size'
  | 'chest_step_small'
  | 'chest_step_large'
  | `non_monotonic:${Point}`
  | 'fit_type_assumed';

export interface NormalizedChart {
  source: ChartSource;
  unit: Unit;
  unitInferred: boolean;
  basis: Basis;
  basisCertainty: BasisCertainty;
  basisReason: string;
  sizes: NormalizedSize[];
  flags: QualityFlag[];
  /** Non-failure notes about transformations applied (e.g. half → full). */
  notes: string[];
}

// ---------------------------------------------------------------- results

export type PointStatus = 'tight' | 'ok' | 'loose';

export interface PointResult {
  point: ScoredPoint;
  /** How the chart value was read. */
  reading: 'garment' | 'body';
  /** Chart value for this size (mid of range), cm. */
  chartCm: number;
  chartMinCm: number;
  chartMaxCm: number;
  /** User's reference value: body (chest/shoulder) or preferred length, cm. */
  userCm: number;
  /** Garment readings: chart − user. Body readings: undefined. */
  roomCm?: number;
  /** Acceptable band (cm) the compared value must fall in. */
  bandLo: number;
  bandHi: number;
  penalty: number;
  status: PointStatus;
}

export interface SizeScore {
  label: string;
  brandLabel?: string;
  order: number;
  score: number;
  points: PointResult[];
  /** Tiebreak: distance of chest from the centre of its band (cm). */
  centreDistance: number;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface ConfidenceParts {
  chartSource: number;
  basisCertainty: number;
  profileQuality: number;
  coverage: number;
  margin: number;
  /** Product of per-flag penalties from sanity checks (1 = clean). */
  chartQuality: number;
}

export type Display =
  | { kind: 'single'; size: string }
  | { kind: 'between'; sizes: [string, string] };

export interface ResolvedProfile {
  chestCm: number;
  shoulderCm?: number;
  preferredLengthCm?: number;
  /** Chest band shift: reference-garment calibration + verdict + feedback (cm). */
  offsetCm: number;
  quality: number;
  qualitySource: 'reference_garment' | 'tape' | 'photo' | 'brand_size';
  lengthSource: 'explicit' | 'reference_garment' | 'height' | 'none';
  shoulderSource: 'body' | 'reference_garment' | 'none';
  reference?: ReferenceGarment;
}

export interface RecommendationOk {
  status: 'ok';
  engineVersion: string;
  size: string;
  runnerUp?: string;
  display: Display;
  confidence: number;
  band: ConfidenceBand;
  confidenceParts: ConfidenceParts;
  category: Category;
  fitType: FitType;
  perSize: SizeScore[];
  perPoint: PointResult[];
  explanation: string[];
  chart: NormalizedChart;
  profile: ResolvedProfile;
}

export type InsufficientReason =
  | 'no_chart'
  | 'no_sizes'
  | 'no_chest_in_chart'
  | 'no_body_chest';

export interface RecommendationInsufficient {
  status: 'insufficient';
  engineVersion: string;
  reason: InsufficientReason;
  message: string;
}

export type Recommendation = RecommendationOk | RecommendationInsufficient;
