import { describe, expect, it } from 'vitest';
import {
  ajioAlphaTribeRegular, amazonNoberoLinen, exampleUser, myntraBearHouseSlim, snitchSlimCorduroy,
} from '../fixtures/charts.ts';
import {
  applyFeedback, bodyChestFromKnownSize, DEFAULT_CONFIG, inch, normalizeChart, recommend, resolveProfile,
  tableToRawChart, type FitProfile, type ProductSpec, type RecommendationOk,
} from '../src/index.ts';

const ok = (r: ReturnType<typeof recommend>): RecommendationOk => {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.reason}`);
  return r;
};

describe('chart variants', () => {
  it('AJIO: stated garment, regular fit, chest-only coverage', () => {
    const r = ok(recommend({ ...exampleUser, body: { source: 'manual', chestCm: inch(38) } }, ajioAlphaTribeRegular));
    // room: M 3, L 5, XL 7 vs regular band 3–5 → M and L both 0; tiebreak: L sits at 5 (edge), M at 3 (edge) — equal,
    // so stable order keeps the first. Both are valid; assert the band logic rather than the tie.
    expect(r.chart.basisCertainty).toBe('stated');
    expect(['M', 'L']).toContain(r.size);
    expect(r.confidenceParts.coverage).toBeCloseTo(1 / 3);
    expect(r.band).toBe('low'); // chest-only charts can't be trusted much
    expect(r.display.kind).toBe('between');
  });

  it('Amazon: unknown basis averages both readings and says so', () => {
    const r = ok(recommend(exampleUser, amazonNoberoLinen));
    expect(r.chart.basis).toBe('unknown');
    expect(r.confidenceParts.basisCertainty).toBe(0.75);
    expect(r.chart.flags).toContain('fit_type_assumed');
    expect(r.explanation.join(' ')).toMatch(/averaged/);
    expect(r.explanation.join(' ')).toMatch(/regular fit was assumed/);
  });

  it('Myntra: single-size structured chart works and is labelled stated', () => {
    const r = ok(recommend(exampleUser, myntraBearHouseSlim));
    expect(r.size).toBe('38');
    expect(r.confidenceParts.chartSource).toBe(1);
    expect(r.confidenceParts.basisCertainty).toBe(1);
    expect(r.confidenceParts.margin).toBe(1);
  });

  it('body chart: picks the range containing the user', () => {
    const p: ProductSpec = {
      retailer: 'x', productId: '1', category: 'shirt', fitType: 'regular',
      chart: tableToRawChart([['Size', 'To fit chest'], ['S', '36-38'], ['M', '38-40'], ['L', '40-42']], { unit: 'in' }),
    };
    const r = ok(recommend(exampleUser, p));
    expect(r.size).toBe('M');
    expect(r.perPoint[0]!.reading).toBe('body');
    expect(r.explanation[1]).toMatch(/fits a 38–40 in chest, which matches your 39 in/);
  });

  it('oversized skips the shoulder check', () => {
    const r = ok(recommend(exampleUser, { ...snitchSlimCorduroy, fitTypeRaw: 'Oversized' }));
    expect(r.perPoint.map((p) => p.point)).not.toContain('shoulder');
    expect(r.confidenceParts.coverage).toBe(1);
    expect(r.size).toBe('XL'); // 8.5 in of room is inside the 7–12 band
  });

  it('a sanity flag lowers confidence', () => {
    const bad: ProductSpec = {
      ...snitchSlimCorduroy,
      chart: tableToRawChart([['Size', 'Chest', 'Shoulder', 'Length'], ['S', '39.5', '17', '27'], ['M', '41.75', '18', '26'], ['L', '45', '19', '29']], { unit: 'in' }),
    };
    const r = ok(recommend(exampleUser, bad));
    expect(r.chart.flags).toContain('non_monotonic:length');
    expect(r.confidenceParts.chartQuality).toBeCloseTo(0.9);
  });
});

describe('profile inputs', () => {
  it('reference garment calibrates the personal offset', () => {
    // Favourite regular shirt: 44 in chest; body 39 in ⇒ room 5, regular mid 4 ⇒ offset +1 in.
    const profile: FitProfile = {
      unitPref: 'in', fitPref: 'regular',
      body: { source: 'manual', chestCm: inch(39) },
      referenceGarments: [{ category: 'shirt', fitType: 'regular', chestCm: inch(44), lengthCm: inch(29), verdict: 'perfect' }],
    };
    const r = resolveProfile(profile, 'shirt', DEFAULT_CONFIG)!;
    expect(r.offsetCm / 2.54).toBeCloseTo(1);
    expect(r.qualitySource).toBe('reference_garment');
    expect(r.preferredLengthCm! / 2.54).toBeCloseTo(29);
    expect(r.lengthSource).toBe('reference_garment');
  });

  it('reference garment alone estimates body chest', () => {
    const profile: FitProfile = {
      unitPref: 'in', fitPref: 'regular',
      referenceGarments: [{ category: 'shirt', fitType: 'slim', chestCm: inch(41.75), verdict: 'slightly_tight' }],
    };
    const r = resolveProfile(profile, 'shirt', DEFAULT_CONFIG)!;
    expect(r.chestCm / 2.54).toBeCloseTo(41.75 - 2.75);
    expect(r.offsetCm / 2.54).toBeCloseTo(0.5); // slightly tight ⇒ wants more room
  });

  it('length falls back to height', () => {
    const r = resolveProfile({ unitPref: 'cm', fitPref: 'regular', body: { source: 'manual', chestCm: 100, heightCm: 175 } }, 'shirt', DEFAULT_CONFIG)!;
    expect(r.lengthSource).toBe('height');
    expect(r.preferredLengthCm).toBeCloseTo(175 * 0.41);
  });

  it('fit preference shifts the band', () => {
    const snug = ok(recommend({ ...exampleUser, fitPref: 'snug' }, snitchSlimCorduroy));
    const relaxed = ok(recommend({ ...exampleUser, fitPref: 'relaxed' }, snitchSlimCorduroy));
    const bandLo = (r: RecommendationOk) => r.perPoint.find((p) => p.point === 'chest')!.bandLo / 2.54;
    expect(bandLo(snug)).toBeCloseTo(1.5);
    expect(bandLo(relaxed)).toBeCloseTo(2.5);
  });

  it('known brand size solves body chest backwards', () => {
    const chart = normalizeChart(ajioAlphaTribeRegular.chart!, DEFAULT_CONFIG);
    expect(bodyChestFromKnownSize(chart, 'L', 'shirt', 'regular', DEFAULT_CONFIG)! / 2.54).toBeCloseTo(43 - 4);
    expect(bodyChestFromKnownSize(chart, 'XXS', 'shirt', 'regular', DEFAULT_CONFIG)).toBeNull();
  });

  it('feedback nudges ±0.5 in, capped at ±2 in', () => {
    let off = 0;
    off = applyFeedback(off, 'tight', DEFAULT_CONFIG);
    expect(off / 2.54).toBeCloseTo(0.5);
    for (let i = 0; i < 10; i++) off = applyFeedback(off, 'tight', DEFAULT_CONFIG);
    expect(off / 2.54).toBeCloseTo(2);
    expect(applyFeedback(off, 'perfect', DEFAULT_CONFIG)).toBe(off);
  });
});

describe('insufficient inputs and purity', () => {
  it('reports why it cannot answer', () => {
    expect(recommend(exampleUser, { ...snitchSlimCorduroy, chart: null })).toMatchObject({ status: 'insufficient', reason: 'no_chart' });
    expect(recommend({ unitPref: 'in', fitPref: 'regular' }, snitchSlimCorduroy)).toMatchObject({ reason: 'no_body_chest' });
    expect(recommend(exampleUser, {
      ...snitchSlimCorduroy, chart: tableToRawChart([['Size', 'Length'], ['M', '28']], { unit: 'in' }),
    })).toMatchObject({ reason: 'no_chest_in_chart' });
  });

  it('never mutates a cached normalized chart', () => {
    const cached = normalizeChart(amazonNoberoLinen.chart!, DEFAULT_CONFIG);
    const before = JSON.stringify(cached);
    recommend(exampleUser, amazonNoberoLinen, DEFAULT_CONFIG, cached);
    expect(JSON.stringify(cached)).toBe(before);
  });

  it('cm users get cm explanations', () => {
    const r = ok(recommend({ ...exampleUser, unitPref: 'cm' }, snitchSlimCorduroy));
    expect(r.explanation).toContain('Chest 106 cm gives you 7 cm of room, right for a slim fit.');
  });
});
