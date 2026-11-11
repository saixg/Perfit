import { ALL_PRODUCTS } from '@perfit/engine/fixtures';
import type { Basis, Category, ChartSource, ProductSpec, Unit } from '@perfit/engine';

export interface ChartPreset {
  id: string;
  name: string;
  text: string;
  unit: Unit | 'auto';
  basis: Basis | 'auto';
  basisLabel?: string;
  source: ChartSource;
  category: Category;
  fitRaw: string;
}

/** Flatten a ProductSpec chart into editable TSV, keeping per-value basis as a chart-level option. */
function toPreset(id: string, p: ProductSpec): ChartPreset {
  const chart = p.chart!;
  const names = [...new Set(chart.sizes.flatMap((s) => s.measurements.map((m) => m.name)))];
  const hasBrand = chart.sizes.some((s) => s.brandLabel);
  const header = ['Size', ...(hasBrand ? ['Brand size'] : []), ...names];
  const rows = chart.sizes.map((s) => [
    s.label, ...(hasBrand ? [s.brandLabel ?? ''] : []),
    ...names.map((n) => String(s.measurements.find((m) => m.name === n)?.value ?? '')),
  ]);
  const tagged = chart.sizes.flatMap((s) => s.measurements).find((m) => m.basis && m.basis !== 'unknown')?.basis;
  return {
    id,
    name: `${p.brand} · ${p.retailer}`,
    text: [header, ...rows].map((r) => r.join('\t')).join('\n'),
    unit: chart.unit ?? 'auto',
    basis: tagged ?? chart.statedBasis ?? 'auto',
    basisLabel: chart.basisLabel,
    source: chart.source,
    category: p.category,
    fitRaw: p.fitTypeRaw ?? '',
  };
}

export const PRESETS: ChartPreset[] = Object.entries(ALL_PRODUCTS).map(([id, p]) => toPreset(id, p));
