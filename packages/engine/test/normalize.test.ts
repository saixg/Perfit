import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, inch, normalizeChart, parseDelimited, parseFitType, parseLength, parseValue,
  tableToRawChart, type RawSizeChart,
} from '../src/index.ts';
import { ajioAlphaTribeRegular, myntraBearHouseSlim } from '../fixtures/charts.ts';

const norm = (grid: string[][], opts = {}) => normalizeChart(tableToRawChart(grid, opts), DEFAULT_CONFIG);
const chestIn = (c: ReturnType<typeof norm>, label: string) =>
  c.sizes.find((s) => s.label === label)!.points.chest!.max / 2.54;

describe('parsing', () => {
  it('parses values, ranges and embedded units', () => {
    expect(parseValue('41.75')).toEqual({ min: 41.75, max: 41.75, isRange: false, unit: undefined });
    expect(parseValue('38 - 40')).toMatchObject({ min: 38, max: 40, isRange: true });
    expect(parseValue('38–40 in')).toMatchObject({ min: 38, max: 40, unit: 'in' });
    expect(parseValue('106 cm')).toMatchObject({ min: 106, unit: 'cm' });
    expect(parseValue('-')).toBeNull();
    expect(parseValue(null)).toBeNull();
  });

  it('parses user-typed lengths', () => {
    expect(parseLength('42 in')).toEqual({ value: 42, unit: 'in' });
    expect(parseLength('106cm')).toEqual({ value: 106, unit: 'cm' });
    expect(parseLength('42')).toEqual({ value: 42 });
    expect(parseLength('abc')).toBeNull();
  });

  it('maps fit labels', () => {
    expect(parseFitType('Slim Fit')).toBe('slim');
    expect(parseFitType('Muscle Fit')).toBe('slim');
    expect(parseFitType('Boxy Oversized')).toBe('oversized');
    expect(parseFitType('Relaxed Fit')).toBe('relaxed');
    expect(parseFitType('Regular Fit')).toBe('regular');
    expect(parseFitType('Casual')).toBeUndefined();
  });

  it('parses pasted tab/comma tables', () => {
    expect(parseDelimited('Size\tChest\nM\t41')).toEqual([['Size', 'Chest'], ['M', '41']]);
    expect(parseDelimited('Size,Chest\nM,41\n')).toEqual([['Size', 'Chest'], ['M', '41']]);
  });
});

describe('step 1: units and half-measures', () => {
  it('infers cm from chest values 70–165', () => {
    const c = norm([['Size', 'Chest', 'Length'], ['M', '104', '72'], ['L', '109', '74']]);
    expect(c.unit).toBe('cm');
    expect(c.unitInferred).toBe(true);
    expect(c.sizes[0]!.points.chest!.max).toBeCloseTo(104);
  });

  it('infers inches from chest values 28–64', () => {
    expect(norm([['Size', 'Chest'], ['M', '41'], ['L', '43']]).unit).toBe('in');
  });

  it('doubles pit-to-pit columns', () => {
    const c = norm([['Size', 'Pit to pit (cm)', 'Length (cm)'], ['M', '52', '72'], ['L', '55', '74']]);
    expect(c.unit).toBe('cm');
    expect(c.sizes[0]!.points.chest!.max).toBeCloseTo(104);
    expect(c.sizes[0]!.points.length!.max).toBeCloseTo(72); // lengths are never doubled
  });

  it('doubles adult chest values below 28 in', () => {
    const c = norm([['Size', 'Chest', 'Length'], ['M', '21', '28'], ['L', '22.5', '29']], { unit: 'in' });
    expect(chestIn(c, 'M')).toBeCloseTo(42);
    expect(c.notes.join(' ')).toMatch(/half-chest/);
  });

  it('orders sizes by the size ladder, not page order', () => {
    const c = norm([['Size', 'Chest'], ['XL', '47'], ['S', '39'], ['2XL', '49'], ['M', '41']]);
    expect(c.sizes.map((s) => s.label)).toEqual(['S', 'M', 'XL', '2XL']);
  });
});

describe('step 1.3: sanity checks flag, never fix', () => {
  it('flags non-monotonic values and large steps', () => {
    const c = norm([['Size', 'Chest', 'Length'], ['S', '39', '28'], ['M', '45', '27'], ['L', '45.5', '29']]);
    expect(c.flags).toContain('non_monotonic:length');
    expect(c.flags).toContain('chest_step_large');
    expect(c.flags).toContain('chest_step_small');
    expect(chestIn(c, 'M')).toBeCloseTo(45); // data untouched
  });

  it('flags duplicate sizes', () => {
    expect(norm([['Size', 'Chest'], ['M', '41'], ['M', '42']]).flags).toContain('duplicate_size');
  });
});

describe('step 2: body vs garment', () => {
  it('rule 1: Myntra per-value measurementType', () => {
    const c = normalizeChart(myntraBearHouseSlim.chart!, DEFAULT_CONFIG);
    expect(c).toMatchObject({ basis: 'garment', basisCertainty: 'stated' });
    expect(c.sizes[0]!.brandLabel).toBe('S');
  });

  it('rule 1: AJIO "Garment Measurement" label', () => {
    expect(normalizeChart(ajioAlphaTribeRegular.chart!, DEFAULT_CONFIG)).toMatchObject({ basis: 'garment', basisCertainty: 'stated' });
  });

  it('rule 1: "To fit chest" header', () => {
    expect(norm([['Size', 'To Fit Chest'], ['M', '40'], ['L', '42']])).toMatchObject({ basis: 'body', basisCertainty: 'stated' });
  });

  it('rule 1: a "To fit waist" column does not flip a garment chest', () => {
    const raw: RawSizeChart = {
      source: 'structured_json', unit: 'in',
      sizes: [{ label: 'M', measurements: [
        { name: 'Chest', value: 42, basis: 'garment' }, { name: 'To Fit Waist', value: 34, basis: 'body' },
      ] }],
    };
    const c = normalizeChart(raw, DEFAULT_CONFIG);
    expect(c.basis).toBe('garment');
    expect(c.sizes[0]!.points.waist!.basis).toBe('body');
  });

  it('rule 2: ranges mean body', () => {
    expect(norm([['Size', 'Chest'], ['M', '38-40'], ['L', '40-42']])).toMatchObject({ basis: 'body', basisCertainty: 'inferred' });
  });

  it('rule 3: numeric label vs chest', () => {
    expect(norm([['Size', 'Chest'], ['38', '40.25'], ['40', '42.25']]).basis).toBe('garment');
    expect(norm([['Size', 'Chest'], ['38', '38'], ['40', '40']]).basis).toBe('body');
  });

  it('rule 4: unknown when nothing answers', () => {
    expect(norm([['Size', 'Chest'], ['M', '41'], ['L', '43']])).toMatchObject({ basis: 'unknown', basisCertainty: 'unknown' });
  });

  it('converts units correctly', () => {
    expect(norm([['Size', 'Chest'], ['M', '41']], { unit: 'in' }).sizes[0]!.points.chest!.max).toBeCloseTo(inch(41));
  });
});
