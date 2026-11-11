// Spec steps 1 (normalize) and 2 (body vs garment).
// Rule: transformations are noted, failures are flagged, data is never silently "fixed".

import type { EngineConfig } from './config.ts';
import { headerIsHalf, headerToPoint, headerUnit, numericLabel, sizeRank } from './labels.ts';
import type {
  Basis, BasisCertainty, Measure, NormalizedChart, NormalizedSize, Point, QualityFlag,
  RawSizeChart, Unit,
} from './types.ts';
import { CM_PER_IN, toCm } from './units.ts';

const GIRTHS: ReadonlySet<Point> = new Set(['chest', 'waist', 'neck']);
const GARMENT_ONLY_POINTS: readonly Point[] = ['length', 'shoulder', 'sleeve'];

interface ParsedValue { min: number; max: number; unit?: Unit; isRange: boolean }

/** "41.75" | "38-40" | "38 – 40" | "106 cm" | 41.75 → parsed numbers. */
export function parseValue(v: number | string | null | undefined): ParsedValue | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { min: v, max: v, isRange: false } : null;
  const s = v.trim().toLowerCase();
  if (!s || s === '-' || s === 'na' || s === 'n/a') return null;
  const unit: Unit | undefined = /cm/.test(s) ? 'cm' : /in|"/.test(s) ? 'in' : undefined;
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const isRange = nums.length >= 2 && /\d\s*(?:-|–|—|to)\s*\d/.test(s);
  const a = Number(nums[0]);
  const b = isRange ? Number(nums[1]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b), unit, isRange };
}

interface Cell {
  point: Point;
  header: string;
  parsed: ParsedValue;
  basis?: Basis;
  unit?: Unit;
  half: boolean;
}

interface Row { label: string; brandLabel?: string; cells: Cell[]; rowIndex: number }

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function normalizeChart(raw: RawSizeChart, config: EngineConfig): NormalizedChart {
  const flags = new Set<QualityFlag>();
  const notes: string[] = [];

  // ---- collect cells
  const rows: Row[] = [];
  const seen = new Set<string>();
  raw.sizes.forEach((r, rowIndex) => {
    const key = r.label.trim().toUpperCase();
    if (seen.has(key)) { flags.add('duplicate_size'); return; }
    seen.add(key);
    const cells: Cell[] = [];
    for (const m of r.measurements) {
      const point = headerToPoint(m.name);
      if (!point) continue;
      const parsed = parseValue(m.value);
      if (!parsed) { if (m.value != null && m.value !== '') flags.add('unparsed_value'); continue; }
      cells.push({
        point, header: m.name, parsed, basis: m.basis,
        unit: m.unit ?? parsed.unit ?? headerUnit(m.name),
        half: GIRTHS.has(point) && headerIsHalf(m.name),
      });
    }
    rows.push({ label: r.label.trim(), brandLabel: r.brandLabel?.trim(), cells, rowIndex });
  });

  // ---- Step 1.1: unit
  let unit: Unit;
  let unitInferred = false;
  const cellUnits = new Set(rows.flatMap((r) => r.cells.map((c) => c.unit)).filter(Boolean));
  if (raw.unit) unit = raw.unit;
  else if (cellUnits.size === 1) unit = [...cellUnits][0] as Unit;
  else {
    unitInferred = true;
    const chestFull = rows.flatMap((r) => r.cells.filter((c) => c.point === 'chest')
      .map((c) => ((c.parsed.min + c.parsed.max) / 2) * (c.half ? 2 : 1)));
    if (chestFull.length) {
      const med = median(chestFull);
      if (med < 28) unit = 'in';            // likely half-inches; handled in 1.2
      else if (med <= 64) unit = 'in';
      else if (med >= 70) unit = 'cm';
      else { unit = med <= 67 ? 'in' : 'cm'; flags.add('unit_ambiguous'); }
    } else {
      const all = rows.flatMap((r) => r.cells.map((c) => c.parsed.max));
      unit = all.some((v) => v > 64) ? 'cm' : 'in';
      if (all.length) notes.push('unit inferred without a chest column');
    }
    notes.push(`unit inferred as ${unit}`);
  }

  // ---- Step 1.2: half → full. Header-declared halves, or adult chest < 28 in.
  const chestIn = rows.flatMap((r) => r.cells.filter((c) => c.point === 'chest' && !c.half)
    .map((c) => (c.unit ?? unit) === 'cm' ? c.parsed.max / CM_PER_IN : c.parsed.max));
  const adultLabels = rows.every((r) => sizeRank(r.label) != null);
  const inferHalfChest = chestIn.length > 0 && median(chestIn) < 28 && adultLabels;
  if (inferHalfChest) notes.push('chest values below 28 in for adult sizes: read as half-chest and doubled');
  if (rows.some((r) => r.cells.some((c) => c.half))) notes.push('half-measure columns doubled to full circumference');

  // ---- build sizes in cm
  const sizes: (NormalizedSize & { rowIndex: number; hasRange: boolean })[] = rows.map((r) => {
    const points: Partial<Record<Point, Measure>> = {};
    let hasRange = false;
    for (const c of r.cells) {
      if (points[c.point]) continue; // first column wins (e.g. "Chest" before "Chest (cm)")
      const u = c.unit ?? unit;
      const k = c.half || (inferHalfChest && c.point === 'chest') ? 2 : 1;
      points[c.point] = { min: toCm(c.parsed.min * k, u), max: toCm(c.parsed.max * k, u), basis: c.basis ?? 'unknown' };
      if (c.parsed.isRange) hasRange = true;
    }
    return { label: r.label, brandLabel: r.brandLabel, order: 0, points, rowIndex: r.rowIndex, hasRange };
  });

  // ---- size order: known ladders, else page order
  const ranks = sizes.map((s) => sizeRank(s.label));
  if (ranks.every((x) => x != null)) sizes.sort((a, b) => sizeRank(a.label)! - sizeRank(b.label)!);
  else sizes.sort((a, b) => a.rowIndex - b.rowIndex);
  sizes.forEach((s, i) => { s.order = i; });

  // ---- Step 2: body vs garment
  const { basis, certainty, reason } = detectBasis(raw, rows, sizes);
  for (const s of sizes) {
    for (const p of Object.keys(s.points) as Point[]) {
      const m = s.points[p]!;
      if (m.basis === 'unknown') m.basis = basis;
    }
  }

  // ---- Step 1.3: sanity checks (flag only)
  const mid = (m: Measure) => (m.min + m.max) / 2;
  for (const p of ['chest', 'waist', 'shoulder', 'length', 'sleeve', 'neck'] as Point[]) {
    const vals = sizes.map((s) => s.points[p]).filter((m): m is Measure => !!m).map(mid);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i]! < vals[i - 1]! - 1e-6) { flags.add(`non_monotonic:${p}`); break; }
    }
  }
  const chestVals = sizes.map((s) => s.points.chest).filter((m): m is Measure => !!m).map(mid);
  for (let i = 1; i < chestVals.length; i++) {
    const step = chestVals[i]! - chestVals[i - 1]!;
    if (step >= 0 && step < config.sanity.chestStepMin - 1e-6) flags.add('chest_step_small');
    if (step > config.sanity.chestStepMax + 1e-6) flags.add('chest_step_large');
  }

  return {
    source: raw.source,
    unit,
    unitInferred,
    basis,
    basisCertainty: certainty,
    basisReason: reason,
    sizes: sizes.map(({ rowIndex: _r, hasRange: _h, ...s }) => s),
    flags: [...flags],
    notes,
  };
}

function detectBasis(
  raw: RawSizeChart,
  rows: Row[],
  sizes: (NormalizedSize & { hasRange: boolean })[],
): { basis: Basis; certainty: BasisCertainty; reason: string } {
  // Rule 1: explicit labels — per-value (Myntra measurementType), chart-level, or text.
  const chestBases = rows.flatMap((r) => r.cells.filter((c) => c.point === 'chest' && c.basis && c.basis !== 'unknown')
    .map((c) => c.basis!));
  if (chestBases.length) {
    const b = chestBases[0]!;
    return { basis: b, certainty: 'stated', reason: `chest values are tagged ${b.toUpperCase()} by the site` };
  }
  if (raw.statedBasis && raw.statedBasis !== 'unknown') {
    return { basis: raw.statedBasis, certainty: 'stated', reason: `chart is labelled as ${raw.statedBasis} measurements` };
  }
  // Only the chart label and CHEST headers count: "To fit waist" next to a garment chest must not flip the chart.
  const chestHeaders = rows.flatMap((r) => r.cells.filter((c) => c.point === 'chest').map((c) => c.header));
  const text = [raw.basisLabel ?? '', ...new Set(chestHeaders)].join(' | ');
  if (/garment|product measurement|actual (?:garment|product)/i.test(text)) {
    return { basis: 'garment', certainty: 'stated', reason: 'chart says "garment measurement"' };
  }
  if (/to\s*fit|body measurement|fits? (?:chest|body)/i.test(text)) {
    return { basis: 'body', certainty: 'stated', reason: 'chart says "to fit" / body measurement' };
  }

  // Rule 2: ranges ⇒ body; garment-only columns ⇒ garment.
  if (sizes.some((s) => s.hasRange && s.points.chest && s.points.chest.max > s.points.chest.min)) {
    return { basis: 'body', certainty: 'inferred', reason: 'chest is given as ranges, typical of body charts' };
  }
  const cols = GARMENT_ONLY_POINTS.filter((p) => sizes.some((s) => s.points[p]));
  if (cols.length) {
    return { basis: 'garment', certainty: 'inferred', reason: `chart lists ${cols.join(', ')}, which body charts rarely do` };
  }

  // Rule 3: numeric size label vs chest value.
  const diffs: number[] = [];
  for (const s of sizes) {
    const n = numericLabel(s.label);
    const c = s.points.chest;
    if (n != null && c) diffs.push(c.max / CM_PER_IN - n);
  }
  if (diffs.length) {
    const d = median(diffs);
    if (d >= 1) return { basis: 'garment', certainty: 'inferred', reason: `chest is ~${d.toFixed(1)} in above the size number, so it measures the garment` };
    if (Math.abs(d) < 0.75) return { basis: 'body', certainty: 'inferred', reason: 'chest equals the size number, so it is a body ("to fit") value' };
  }

  // Rule 4: unknown. resolve-chart may classify with an LLM and set statedBasis upstream.
  return { basis: 'unknown', certainty: 'unknown', reason: 'chart does not say whether it measures the body or the garment' };
}
