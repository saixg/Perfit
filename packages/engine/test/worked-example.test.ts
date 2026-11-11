// The blueprint's worked example must reproduce exactly. If this breaks, the spec and engine disagree.
import { describe, expect, it } from 'vitest';
import { exampleUser, snitchSlimCorduroy } from '../fixtures/charts.ts';
import { recommend } from '../src/index.ts';

describe('blueprint worked example: Snitch slim corduroy + example user', () => {
  const rec = recommend(exampleUser, snitchSlimCorduroy);
  if (rec.status !== 'ok') throw new Error(rec.message);

  it('infers a garment chart from its length/shoulder columns', () => {
    expect(rec.chart.basis).toBe('garment');
    expect(rec.chart.basisCertainty).toBe('inferred');
    expect(rec.chart.flags).toEqual([]);
    expect(rec.fitType).toBe('slim');
  });

  it('scores every size as in the spec table', () => {
    const score = Object.fromEntries(rec.perSize.map((s) => [s.label, s.score]));
    expect(score.XS).toBeCloseTo(10.0, 2);
    expect(score.S).toBeCloseTo(1.2375, 4);
    expect(score.M).toBeCloseTo(0, 9);
    expect(score.L).toBeCloseTo(0.921875, 4);
    expect(score.XL).toBeCloseTo(4.2, 4);
  });

  it('chest penalties match the table', () => {
    const chestPen = Object.fromEntries(rec.perSize.map((s) => [s.label, s.points.find((p) => p.point === 'chest')!.penalty]));
    expect(chestPen.XS).toBeCloseTo(16, 6);
    expect(chestPen.S).toBeCloseTo(2.25, 6);
    expect(chestPen.M).toBe(0);
    expect(chestPen.L).toBeCloseTo(1.5625, 6);
    expect(chestPen.XL).toBeCloseTo(6.25, 6);
  });

  it('recommends M with runner-up L at ~0.75 medium confidence', () => {
    expect(rec.size).toBe('M');
    expect(rec.runnerUp).toBe('L');
    expect(rec.display).toEqual({ kind: 'single', size: 'M' });
    expect(rec.confidence).toBeCloseTo(0.75, 2);
    expect(rec.band).toBe('medium');
    expect(rec.confidenceParts).toMatchObject({ chartSource: 0.95, basisCertainty: 0.9, profileQuality: 0.9, coverage: 1 });
  });

  it('explains with the numbers', () => {
    expect(rec.explanation[0]).toBe('M fits best.');
    expect(rec.explanation).toContain('Chest 41.75 in gives you 2.75 in of room, right for a slim fit.');
    expect(rec.explanation).toContain('Length 28 in matches your preferred length.');
    expect(rec.explanation).toContain('L would be 3.25 in roomier.');
  });

  it('is deterministic', () => {
    expect(recommend(exampleUser, snitchSlimCorduroy)).toEqual(rec);
  });
});
