// Build the engine's FitProfile from the signed-in user's rows (RLS-scoped client).

import type { SupabaseClient } from './supabase.ts';
import type { FitProfile } from './engine.ts';

const opt = (v: number | null | undefined) => (v == null ? undefined : Number(v));

export async function loadProfile(db: SupabaseClient, userId: string): Promise<{ profile: FitProfile; measurementVersion: number | null }> {
  const [p, m, g] = await Promise.all([
    db.from('profiles').select('unit_pref, default_fit_pref, feedback_offset_cm').eq('user_id', userId).maybeSingle(),
    db.from('body_measurements').select('*').eq('user_id', userId).eq('is_active', true).maybeSingle(),
    db.from('reference_garments').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  for (const r of [p, m, g]) if (r.error) throw new Error(`profile load: ${r.error.message}`);

  const prof = p.data;
  const body = m.data;
  return {
    measurementVersion: body?.version ?? null,
    profile: {
      unitPref: prof?.unit_pref ?? 'in',
      fitPref: prof?.default_fit_pref ?? 'regular',
      feedbackOffsetCm: opt(prof?.feedback_offset_cm),
      body: body ? {
        source: body.source,
        heightCm: opt(body.height_cm),
        weightKg: opt(body.weight_kg),
        chestCm: opt(body.chest_cm),
        waistCm: opt(body.waist_cm),
        shoulderCm: opt(body.shoulder_cm),
        neckCm: opt(body.neck_cm),
        armCm: opt(body.arm_cm),
      } : undefined,
      referenceGarments: (g.data ?? []).map((r: any) => ({
        category: r.category,
        fitType: r.fit_type,
        chestCm: Number(r.chest_cm),
        shoulderCm: opt(r.shoulder_cm),
        lengthCm: opt(r.length_cm),
        sleeveCm: opt(r.sleeve_cm),
        brand: r.brand_name ?? undefined,
        sizeLabel: r.size_label ?? undefined,
        verdict: r.verdict,
      })),
    },
  };
}
