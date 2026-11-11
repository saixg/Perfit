// POST /feedback (signed in). Two steps, matching the widget:
//   1. "I bought this"   → { recommendationId | productId, boughtSize }          creates a row
//   2. "How did it fit?" → { feedbackId, overall, perPoint? }                   completes it
// The first time `overall` is set to tight/loose, the learned offset moves ±0.5 in (cap ±2 in).

import { applyFeedback, DEFAULT_CONFIG } from '../_shared/engine.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { FeedbackInput, parse } from '../_shared/schemas.ts';
import { requireUser } from '../_shared/supabase.ts';

Deno.serve(handle(async (req) => {
  const { userId, client: db } = await requireUser(req); // RLS-scoped: users only touch their own rows
  const input = parse(FeedbackInput, await readJson(req));

  let feedbackId: string;
  let previousOverall: string | null = null;

  if (input.feedbackId) {
    const cur = await db.from('feedback').select('id, overall').eq('id', input.feedbackId).maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) throw new HttpError(404, 'feedback_not_found', 'No feedback with that id.');
    previousOverall = cur.data.overall;
    const upd = await db.from('feedback').update({
      ...(input.overall ? { overall: input.overall } : {}),
      ...(input.perPoint ? { per_point: input.perPoint } : {}),
      ...(input.boughtSize ? { bought_size: input.boughtSize } : {}),
    }).eq('id', input.feedbackId).select('id').single();
    if (upd.error) throw new Error(upd.error.message);
    feedbackId = upd.data.id;
  } else {
    let productId = input.productId ?? null;
    if (input.recommendationId) {
      const r = await db.from('recommendations').select('product_id').eq('id', input.recommendationId).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      if (!r.data) throw new HttpError(404, 'recommendation_not_found', 'No recommendation with that id.');
      productId = r.data.product_id;
    }
    const ins = await db.from('feedback').insert({
      user_id: userId,
      recommendation_id: input.recommendationId ?? null,
      product_id: productId,
      bought_size: input.boughtSize!,
      overall: input.overall ?? null,
      per_point: input.perPoint ?? {},
    }).select('id').single();
    if (ins.error) {
      if (ins.error.code === '23503') throw new HttpError(400, 'unknown_product', 'Unknown productId.');
      throw new Error(ins.error.message);
    }
    feedbackId = ins.data.id;
  }

  // Learning: apply once, when the fit verdict is first given.
  let feedbackOffsetCm: number | null = null;
  if (input.overall && previousOverall == null) {
    const prof = await db.from('profiles').select('feedback_offset_cm').eq('user_id', userId).maybeSingle();
    if (prof.error) throw new Error(prof.error.message);
    const next = applyFeedback(Number(prof.data?.feedback_offset_cm ?? 0), input.overall, DEFAULT_CONFIG);
    const up = await db.from('profiles').upsert({ user_id: userId, feedback_offset_cm: next }, { onConflict: 'user_id' });
    if (up.error) throw new Error(up.error.message);
    feedbackOffsetCm = next;
  }

  return json({ feedbackId, feedbackOffsetCm });
}));
