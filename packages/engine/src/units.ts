import type { Unit } from './types.ts';

export const CM_PER_IN = 2.54;
/** Write config values in inches, store them in cm. */
export const inch = (v: number): number => v * CM_PER_IN;
export const toCm = (v: number, unit: Unit): number => (unit === 'in' ? v * CM_PER_IN : v);
export const fromCm = (cm: number, unit: Unit): number => (unit === 'in' ? cm / CM_PER_IN : cm);

/** Format a cm length in the user's unit: "41.75 in", "106 cm". Trailing zeros trimmed. */
export function fmtLen(cm: number, unit: Unit, opts: { signed?: boolean } = {}): string {
  const v = fromCm(cm, unit);
  const decimals = unit === 'in' ? 2 : 1;
  let s = Number(v.toFixed(decimals)).toString();
  if (opts.signed && v > 0) s = '+' + s;
  if (s === '-0') s = '0';
  return `${s} ${unit}`;
}

/** Parse a user-typed length: "42 in", "106cm", "42\"", "42". Bare numbers return unit undefined. */
export function parseLength(input: string): { value: number; unit?: Unit } | null {
  const m = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(in|inch|inches|"|cm|cms)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  const u = m[2];
  if (!u) return { value };
  return { value, unit: u.startsWith('c') ? 'cm' : 'in' };
}
