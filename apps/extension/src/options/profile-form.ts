// Form state ⇄ FitProfile. Pure, so it is unit-tested without a browser.

import { fromCm, toCm, type Category, type FitPref, type FitType, type GarmentVerdict, type Unit } from '@perfit/engine';
import type { StoredProfile } from '../shared/storage.ts';

/** Inputs stay strings while typing; converted once on save. */
export interface ProfileForm {
  unit: Unit;
  fitPref: FitPref;
  chest: string;
  shoulder: string;
  heightCm: string;
  length: string;
  hasRef: boolean;
  refCategory: Category;
  refFit: FitType;
  refPitToPit: string;
  refShoulder: string;
  refLength: string;
  refVerdict: GarmentVerdict;
  consent: boolean;
}

export const EMPTY_FORM: ProfileForm = {
  unit: 'in', fitPref: 'regular', chest: '', shoulder: '', heightCm: '', length: '',
  hasRef: false, refCategory: 'shirt', refFit: 'regular', refPitToPit: '', refShoulder: '', refLength: '',
  refVerdict: 'perfect', consent: false,
};

const num = (s: string): number | undefined => {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const show = (cm: number | undefined, unit: Unit) => (cm == null ? '' : String(Number(fromCm(cm, unit).toFixed(unit === 'in' ? 2 : 1))));

export function formFromProfile(p: StoredProfile | null): ProfileForm {
  if (!p) return EMPTY_FORM;
  const u = p.unitPref;
  const ref = p.referenceGarments?.[0];
  return {
    unit: u,
    fitPref: p.fitPref,
    chest: show(p.body?.chestCm, u),
    shoulder: show(p.body?.shoulderCm, u),
    heightCm: p.body?.heightCm != null ? String(Math.round(p.body.heightCm)) : '',
    length: show(p.preferredLengthCm, u),
    hasRef: !!ref,
    refCategory: ref?.category ?? 'shirt',
    refFit: ref?.fitType ?? 'regular',
    refPitToPit: ref ? show(ref.chestCm / 2, u) : '',
    refShoulder: show(ref?.shoulderCm, u),
    refLength: show(ref?.lengthCm, u),
    refVerdict: ref?.verdict ?? 'perfect',
    consent: !!p.consentAt,
  };
}

/** Plausible adult ranges in cm; a value outside is almost always a unit mix-up. */
const RANGES: Record<string, [number, number, string]> = {
  chest: [64, 178, 'Chest'],
  shoulder: [30, 65, 'Shoulder'],
  length: [50, 100, 'Preferred length'],
  refPitToPit: [35, 90, 'Pit-to-pit'],
  refShoulder: [30, 65, 'Shirt shoulder'],
  refLength: [50, 100, 'Shirt length'],
};

export type FormResult = { ok: true; profile: StoredProfile } | { ok: false; errors: string[] };

export function profileFromForm(f: ProfileForm, prev: StoredProfile | null, now = new Date()): FormResult {
  const errors: string[] = [];
  const cm = (field: keyof typeof RANGES & keyof ProfileForm): number | undefined => {
    const v = num(f[field] as string);
    if (v == null) return undefined;
    const [lo, hi, name] = RANGES[field]!;
    const c = Number.isNaN(v) ? NaN : toCm(v, f.unit);
    if (Number.isNaN(c) || c < lo || c > hi) {
      errors.push(`${name} looks off for ${f.unit === 'in' ? 'inches' : 'cm'}. Check the number and the unit.`);
      return undefined;
    }
    return c;
  };

  const chestCm = cm('chest');
  const shoulderCm = cm('shoulder');
  const preferredLengthCm = cm('length');
  const h = num(f.heightCm);
  if (h != null && (Number.isNaN(h) || h < 120 || h > 230)) errors.push('Height should be in cm, between 120 and 230.');
  const heightCm = h != null && !Number.isNaN(h) && h >= 120 && h <= 230 ? h : undefined;

  let ref: NonNullable<StoredProfile['referenceGarments']>[number] | undefined;
  if (f.hasRef) {
    const pit = cm('refPitToPit');
    if (pit == null && !f.refPitToPit.trim()) errors.push("Add your shirt's pit-to-pit width, or untick the shirt section.");
    if (pit != null) {
      ref = {
        category: f.refCategory, fitType: f.refFit, chestCm: pit * 2,
        shoulderCm: cm('refShoulder'), lengthCm: cm('refLength'), verdict: f.refVerdict,
      };
    }
  }

  if (chestCm == null && !ref && !errors.length) errors.push('Add your chest measurement or a shirt that fits you well.');
  if (!f.consent) errors.push('Tick the consent box so perfit may store your measurements on this device.');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    profile: {
      unitPref: f.unit,
      fitPref: f.fitPref,
      body: { source: 'manual', chestCm, shoulderCm, heightCm },
      referenceGarments: ref ? [ref] : [],
      preferredLengthCm,
      feedbackOffsetCm: prev?.feedbackOffsetCm ?? 0,
      consentAt: prev?.consentAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
}

/** Convert every length field when the unit toggle flips, so the numbers keep their meaning. */
export function switchUnit(f: ProfileForm, next: Unit): ProfileForm {
  if (next === f.unit) return f;
  const conv = (s: string) => {
    const v = num(s);
    return v == null || Number.isNaN(v) ? s : String(Number(fromCm(toCm(v, f.unit), next).toFixed(next === 'in' ? 2 : 1)));
  };
  return {
    ...f, unit: next, chest: conv(f.chest), shoulder: conv(f.shoulder), length: conv(f.length),
    refPitToPit: conv(f.refPitToPit), refShoulder: conv(f.refShoulder), refLength: conv(f.refLength),
  };
}
