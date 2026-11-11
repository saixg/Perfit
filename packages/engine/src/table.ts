// Shared helper for HTML-table charts (Snitch, AJIO, Amazon.in) and the playground's paste box.
// Adapters do the DOM work (table → string[][]); this turns the grid into a RawSizeChart.

import { headerToPoint } from './labels.ts';
import type { Basis, ChartSource, RawSizeChart, Unit } from './types.ts';

export interface TableOptions {
  source?: ChartSource;
  unit?: Unit;
  statedBasis?: Basis;
  basisLabel?: string;
}

/**
 * First row = headers. The size column is the first column whose header looks like
 * "Size"/"Brand size", or the first column that isn't a measurement.
 */
export function tableToRawChart(grid: string[][], opts: TableOptions = {}): RawSizeChart {
  const rows = grid.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  const header = rows[0] ?? [];
  let sizeCol = header.findIndex((h) => /^(brand\s*)?size\b|^size\s*label/i.test(h));
  if (sizeCol < 0) sizeCol = header.findIndex((h) => headerToPoint(h) == null);
  if (sizeCol < 0) sizeCol = 0;
  const brandCol = header.findIndex((h, i) => i !== sizeCol && /brand\s*size/i.test(h));

  return {
    source: opts.source ?? 'html_table',
    unit: opts.unit,
    statedBasis: opts.statedBasis,
    basisLabel: opts.basisLabel,
    sizes: rows.slice(1).map((r) => ({
      label: r[sizeCol] ?? '',
      brandLabel: brandCol >= 0 ? r[brandCol] : undefined,
      measurements: header
        .map((name, i) => ({ name, value: r[i] ?? null }))
        .filter((_, i) => i !== sizeCol && i !== brandCol),
    })).filter((s) => s.label !== ''),
  };
}

/** Parse pasted text (tab-, comma- or 2+-space-separated) into a grid. */
export function parseDelimited(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = lines.some((l) => l.includes('\t')) ? /\t/ : lines.some((l) => l.includes(',')) ? /,/ : /\s{2,}|\s+/;
  return lines.map((l) => l.split(sep).map((c) => c.trim()));
}
