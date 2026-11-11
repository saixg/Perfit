// recommend(profile, product, config): the engine's single entry point.
// Pure: no network, no DOM, no clock, no randomness. Same input ⇒ same output.

import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { computeConfidence } from './confidence.ts';
import { explain } from './explain.ts';
import { parseFitType } from './labels.ts';
import { normalizeChart } from './normalize.ts';
import { resolveProfile } from './profile.ts';
import { rankSizes, scoreSize, type ScoreContext } from './score.ts';
import type {
  Display, FitProfile, FitType, NormalizedChart, ProductSpec, Recommendation, SizeScore,
} from './types.ts';

const insufficient = (
  config: EngineConfig, reason: Extract<Recommendation, { status: 'insufficient' }>['reason'], message: string,
): Recommendation => ({ status: 'insufficient', engineVersion: config.version, reason, message });

export function recommend(
  profile: FitProfile,
  product: ProductSpec,
  config: EngineConfig = DEFAULT_CONFIG,
  /** Pass an already-normalized chart (e.g. from the server cache) to skip normalization. */
  normalized?: NormalizedChart,
): Recommendation {
  if (!product.chart && !normalized) return insufficient(config, 'no_chart', 'No size chart found on this page.');
  let chart = normalized ?? normalizeChart(product.chart!, config);
  if (chart.sizes.length === 0) return insufficient(config, 'no_sizes', 'The size chart has no readable sizes.');
  if (!chart.sizes.some((s) => s.points.chest)) {
    return insufficient(config, 'no_chest_in_chart', "The size chart doesn't list chest, so perfit can't compare it.");
  }

  const resolved = resolveProfile(profile, product.category, config);
  if (!resolved) {
    return insufficient(config, 'no_body_chest', 'Add your chest measurement or a shirt that fits you to get a size.');
  }

  const parsedFit: FitType | undefined = product.fitType ?? parseFitType(product.fitTypeRaw);
  const fitType: FitType = parsedFit ?? 'regular';
  const fitTypeAssumed = parsedFit == null;
  if (fitTypeAssumed && !chart.flags.includes('fit_type_assumed')) {
    chart = { ...chart, flags: [...chart.flags, 'fit_type_assumed'] }; // copy: never mutate a cached chart
  }

  const ctx: ScoreContext = {
    category: product.category, fitType, fitPref: profile.fitPref, profile: resolved, config,
  };
  const sizes = chart.sizes.filter((s) => s.points.chest);

  let scores: SizeScore[];
  if (chart.basis === 'unknown') {
    // Rule 4 fallback: score both readings and average; report the garment reading's details.
    scores = sizes.map((s) => {
      const g = scoreSize(s, { ...ctx, forceReading: 'garment' });
      const b = scoreSize(s, { ...ctx, forceReading: 'body' });
      return { ...g, score: (g.score + b.score) / 2 };
    });
  } else {
    scores = sizes.map((s) => scoreSize(s, ctx));
  }

  const ranked = rankSizes(scores);
  const best = ranked[0]!;
  const runnerUp = ranked[1];
  const { confidence, band, parts } = computeConfidence(chart, resolved, best, runnerUp, fitType, config);

  const display: Display = band === 'low' && runnerUp
    ? { kind: 'between', sizes: best.order < runnerUp.order ? [best.label, runnerUp.label] : [runnerUp.label, best.label] }
    : { kind: 'single', size: best.label };

  const explanation = explain({
    best, runnerUp, display, band, fitType, fitTypeAssumed, chart, profile: resolved, unit: profile.unitPref,
  });

  return {
    status: 'ok',
    engineVersion: config.version,
    size: best.label,
    runnerUp: runnerUp?.label,
    display,
    confidence,
    band,
    confidenceParts: parts,
    category: product.category,
    fitType,
    perSize: [...scores].sort((a, b) => a.order - b.order),
    perPoint: best.points,
    explanation,
    chart,
    profile: resolved,
  };
}
