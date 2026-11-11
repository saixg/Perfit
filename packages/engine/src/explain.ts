// Spec step 6: explanations are templates over per-point numbers. No LLM, so no hallucination.

import type {
  ConfidenceBand, Display, FitType, NormalizedChart, PointResult, ResolvedProfile, SizeScore, Unit,
} from './types.ts';
import { fmtLen } from './units.ts';

export interface ExplainInput {
  best: SizeScore;
  runnerUp?: SizeScore;
  display: Display;
  band: ConfidenceBand;
  fitType: FitType;
  fitTypeAssumed: boolean;
  chart: NormalizedChart;
  profile: ResolvedProfile;
  unit: Unit;
}

const FIT_WORD: Record<FitType, string> = {
  slim: 'slim', regular: 'regular', relaxed: 'relaxed', oversized: 'oversized',
};

function chestSentence(p: PointResult, fit: string, u: Unit): string {
  const g = fmtLen(p.chartCm, u);
  if (p.reading === 'body') {
    const range = p.chartMaxCm > p.chartMinCm
      ? `${fmtLen(p.chartMinCm, u).replace(` ${u}`, '')}–${fmtLen(p.chartMaxCm, u)}`
      : fmtLen(p.chartCm, u);
    const verdict = p.status === 'ok' ? 'which matches' : p.status === 'tight' ? 'but yours is larger at' : 'but yours is smaller at';
    return `The chart says this size fits a ${range} chest, ${verdict}${p.status === 'ok' ? ' your' : ''} ${fmtLen(p.userCm, u)}.`;
  }
  const room = p.roomCm!;
  if (room < 0) return `Chest ${g} is ${fmtLen(-room, u)} smaller than your chest, so it will be tight.`;
  if (p.status === 'ok') return `Chest ${g} gives you ${fmtLen(room, u)} of room, right for a ${fit} fit.`;
  if (p.status === 'tight') return `Chest ${g} gives you only ${fmtLen(room, u)} of room, snug for a ${fit} fit.`;
  return `Chest ${g} gives you ${fmtLen(room, u)} of room, roomier than a typical ${fit} fit.`;
}

function shoulderSentence(p: PointResult, u: Unit): string {
  const g = fmtLen(p.chartCm, u);
  if (p.status === 'ok') return `Shoulder ${g} sits right on yours.`;
  return p.status === 'tight'
    ? `Shoulder ${g} is narrower than yours and may pull.`
    : `Shoulder ${g} is wider than yours, so the seam will drop a little.`;
}

function lengthSentence(p: PointResult, profile: ResolvedProfile, u: Unit): string {
  const g = fmtLen(p.chartCm, u);
  const target = profile.lengthSource === 'reference_garment' ? 'your favourite shirt'
    : profile.lengthSource === 'explicit' ? 'your preferred length' : 'what suits your height';
  if (p.status === 'ok') return `Length ${g} matches ${target}.`;
  const diff = fmtLen(Math.abs(p.roomCm!), u);
  return p.status === 'tight' ? `Length ${g} is ${diff} shorter than ${target}.` : `Length ${g} is ${diff} longer than ${target}.`;
}

export function explain(x: ExplainInput): string[] {
  const u = x.unit;
  const out: string[] = [];
  const fit = FIT_WORD[x.fitType];

  out.push(x.display.kind === 'single'
    ? `${x.best.label} fits best.`
    : `Between ${x.display.sizes[0]} and ${x.display.sizes[1]}: ${x.best.label} is slightly ahead.`);

  for (const p of x.best.points) {
    if (p.point === 'chest') out.push(chestSentence(p, fit, u));
    else if (p.point === 'shoulder') out.push(shoulderSentence(p, u));
    else if (p.point === 'length') out.push(lengthSentence(p, x.profile, u));
  }

  const bc = x.best.points.find((p) => p.point === 'chest');
  const rc = x.runnerUp?.points.find((p) => p.point === 'chest');
  if (x.runnerUp && bc && rc) {
    const d = rc.chartCm - bc.chartCm;
    if (Math.abs(d) > 1e-6) {
      out.push(`${x.runnerUp.label} would be ${fmtLen(Math.abs(d), u)} ${d > 0 ? 'roomier' : 'snugger'}.`);
    }
  }

  // Caveats: always say why confidence is not high.
  if (x.chart.basisCertainty === 'unknown') {
    out.push("The chart doesn't say whether it measures the body or the garment, so both readings were averaged.");
  }
  if (x.fitTypeAssumed) out.push("The page doesn't state a fit type, so a regular fit was assumed.");
  if (x.chart.flags.some((f) => f.startsWith('non_monotonic') || f.startsWith('chest_step'))) {
    out.push("This chart's numbers look inconsistent between sizes; treat it with care.");
  }
  if (x.profile.shoulderSource === 'none' && x.chart.sizes.some((s) => s.points.shoulder)) {
    out.push('Add your shoulder width to make this more precise.');
  }
  return out;
}
