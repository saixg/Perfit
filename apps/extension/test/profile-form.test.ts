import { inch } from '@perfit/engine';
import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, formFromProfile, profileFromForm, switchUnit } from '../src/options/profile-form.ts';

const NOW = new Date('2026-11-12T10:00:00Z');

describe('profile form', () => {
  it('builds a cm profile from inch inputs and round-trips', () => {
    const r = profileFromForm({ ...EMPTY_FORM, chest: '39', shoulder: '17.5', length: '28', consent: true }, null, NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.profile.body?.chestCm).toBeCloseTo(inch(39));
    expect(r.profile.preferredLengthCm).toBeCloseTo(inch(28));
    expect(r.profile.consentAt).toBe(NOW.toISOString());
    expect(formFromProfile(r.profile)).toMatchObject({ chest: '39', shoulder: '17.5', length: '28', consent: true });
  });

  it('doubles pit-to-pit into a full-circumference reference chest', () => {
    const r = profileFromForm({ ...EMPTY_FORM, hasRef: true, refPitToPit: '21', refFit: 'slim', consent: true }, null, NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.profile.referenceGarments?.[0]).toMatchObject({ fitType: 'slim', chestCm: inch(42) });
    expect(r.profile.body?.chestCm).toBeUndefined();
  });

  it('catches unit mix-ups, a missing chest and missing consent', () => {
    const cmInInches = profileFromForm({ ...EMPTY_FORM, chest: '102', consent: true }, null, NOW);
    expect(cmInInches.ok === false && cmInInches.errors[0]).toMatch(/Chest looks off/);
    const nothing = profileFromForm({ ...EMPTY_FORM }, null, NOW);
    expect(nothing.ok === false && nothing.errors).toEqual([
      'Add your chest measurement or a shirt that fits you well.',
      'Tick the consent box so perfit may store your measurements on this device.',
    ]);
  });

  it('keeps the learned offset and original consent time on re-save', () => {
    const prev = { unitPref: 'in', fitPref: 'regular', feedbackOffsetCm: 1.27, consentAt: '2026-01-01T00:00:00Z', updatedAt: '' } as const;
    const r = profileFromForm({ ...EMPTY_FORM, chest: '40', consent: true }, prev, NOW);
    expect(r.ok && [r.profile.feedbackOffsetCm, r.profile.consentAt]).toEqual([1.27, '2026-01-01T00:00:00Z']);
  });

  it('converts typed numbers when the unit flips', () => {
    expect(switchUnit({ ...EMPTY_FORM, chest: '40', refPitToPit: 'abc' }, 'cm')).toMatchObject({ unit: 'cm', chest: '101.6', refPitToPit: 'abc' });
  });
});
