// POST /recommend (signed in). Runs the SAME engine server-side and logs the result, so every answer
// can be replayed after an engine change. It never overrides the client's answer in the MVP.
// The stored RAW chart is re-normalized with the current engine: replay reflects today's logic.

import { recommend, type FitProfile, type ProductSpec, type RawSizeChart } from '../_shared/engine.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { loadProfile } from '../_shared/profile.ts';
import { parse, RecommendInput } from '../_shared/schemas.ts';
import { requireUser } from '../_shared/supabase.ts';

Deno.serve(handle(async (req) => {
  const { userId, client: db } = await requireUser(req);
  const input = parse(RecommendInput, await readJson(req));

  const { data: chart, error } = await db.from('size_charts')
    .select('id, product_id, raw_payload, products!inner(id, retailer_id, retailer_product_id, category, fit_type, fit_type_raw, has_stretch, title)')
    .eq('id', input.chartId)
    .maybeSingle();
  if (error) throw new Error(`chart load: ${error.message}`);
  if (!chart) throw new HttpError(404, 'chart_not_found', 'No chart with that id.');
  const p = chart.products as unknown as {
    id: string; retailer_id: string; retailer_product_id: string; category: 'shirt' | 'tshirt';
    fit_type: ProductSpec['fitType'] | null; fit_type_raw: string | null; has_stretch: boolean | null; title: string | null;
  };

  let profile: FitProfile;
  let measurementVersion: number | null = null;
  if (input.profile) {
    profile = input.profile as FitProfile;
  } else {
    ({ profile, measurementVersion } = await loadProfile(db, userId));
  }

  const spec: ProductSpec = {
    retailer: p.retailer_id,
    productId: p.retailer_product_id,
    title: p.title ?? undefined,
    category: p.category,
    fitType: p.fit_type ?? undefined,
    fitTypeRaw: p.fit_type_raw ?? undefined,
    hasStretch: p.has_stretch ?? undefined,
    chart: chart.raw_payload as RawSizeChart,
  };
  const rec = recommend(profile, spec);
  if (rec.status !== 'ok') return json({ recommendationId: null, recommendation: rec });

  const ins = await db.from('recommendations').insert({
    user_id: userId,
    product_id: p.id,
    chart_id: chart.id,
    measurement_version: measurementVersion,
    engine_version: rec.engineVersion,
    origin: 'server',
    recommended_size: rec.size,
    runner_up_size: rec.runnerUp ?? null,
    confidence: Math.round(rec.confidence * 10_000) / 10_000,
    band: rec.band,
    per_point: rec.perPoint,
    profile_snapshot: profile,
  }).select('id').single();
  if (ins.error) throw new Error(`recommendation insert: ${ins.error.message}`);

  return json({
    recommendationId: ins.data.id,
    recommendation: rec,
    agreesWithClient: input.clientResult ? input.clientResult.size === rec.size : null,
  });
}));
