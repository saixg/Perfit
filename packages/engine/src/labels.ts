import type { FitType, Point } from './types.ts';

const ALPHA_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', '6XL', '7XL'];
const ALPHA_ALIASES: Record<string, string> = {
  '3XS': 'XXXS', '2XS': 'XXS', SMALL: 'S', MEDIUM: 'M', LARGE: 'L',
  '2XL': 'XXL', '3XL': 'XXXL', XXXXL: '4XL', XXXXXL: '5XL',
};

/** Rank a size label: alpha sizes by the standard ladder, numeric sizes by value. */
export function sizeRank(label: string): number | null {
  const clean = label.trim().toUpperCase().replace(/\s+/g, '');
  const canonical = ALPHA_ALIASES[clean] ?? clean;
  const idx = ALPHA_ORDER.indexOf(canonical);
  if (idx >= 0) return 1000 + idx;
  const num = numericLabel(label);
  return num ?? null;
}

/** "38" → 38, "40 (M)" → 40. Only plausible adult shirt chest labels (30–60). */
export function numericLabel(label: string): number | null {
  const m = label.trim().match(/^(\d{2}(?:\.\d)?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 30 && n <= 60 ? n : null;
}

/** Map a column header / JSON key to a measurement point. Order matters: sleeve before length. */
export function headerToPoint(name: string): Point | null {
  const h = name.toLowerCase();
  if (/sleeve/.test(h)) return 'sleeve';
  if (/shoulder/.test(h)) return 'shoulder';
  if (/chest|bust|pit.?to.?pit|\bp2p\b/.test(h)) return 'chest';
  if (/waist/.test(h)) return 'waist';
  if (/neck|collar/.test(h)) return 'neck';
  if (/length/.test(h)) return 'length';
  return null;
}

/** Column says it's a half (flat) measurement: width, pit-to-pit, ½. */
export function headerIsHalf(name: string): boolean {
  return /width|pit.?to.?pit|\bp2p\b|½|1\/2|\bhalf\b|\bflat\b/i.test(name);
}

/** Column header explicitly names a unit. */
export function headerUnit(name: string): 'in' | 'cm' | undefined {
  if (/\(\s*cm\s*\)|\bcms?\b|centimet/i.test(name)) return 'cm';
  if (/\(\s*in\s*\)|\binch(es)?\b|"/i.test(name)) return 'in';
  return undefined;
}

/** "Slim Fit" → slim; "Boxy" → oversized. Undefined when unknown. */
export function parseFitType(raw: string | undefined | null): FitType | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/over\s?-?sized|boxy|drop.?shoulder/.test(s)) return 'oversized';
  if (/relax|loose|comfort/.test(s)) return 'relaxed';
  if (/slim|muscle|skinny|tailored|super.?slim|extra.?slim/.test(s)) return 'slim';
  if (/regular|classic|straight|standard/.test(s)) return 'regular';
  return undefined;
}
