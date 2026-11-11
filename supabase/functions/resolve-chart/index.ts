// POST /resolve-chart. Works signed in or out (login is optional in perfit).
// 1. Upsert brand + product.  2. Cache lookup by (product, raw_hash).
// 3. Miss with a parsed chart → normalize, store.  4. Miss with an image/text → LLM extraction once, store.
// Every returned chart carries its quality flags; nothing that failed sanity checks is returned unflagged.

import { findChart, storeChart, upsertBrand, upsertProduct } from '../_shared/catalog.ts';
import { DEFAULT_CONFIG, hashChart, normalizeChart, type RawSizeChart } from '../_shared/engine.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { getExtractor, PROMPT_VERSION, underDailyCap } from '../_shared/llm.ts';
import { parse, ResolveChartInput } from '../_shared/schemas.ts';
import { adminClient, getUser } from '../_shared/supabase.ts';

type Status = 'hit' | 'stored' | 'extracted' | 'miss' | 'unavailable' | 'unusable';

function reply(status: Status, productId: string, chartId: string | null, raw: RawSizeChart | null, extra: Record<string, unknown> = {}) {
  const chart = raw ? normalizeChart(raw, DEFAULT_CONFIG) : null;
  return json({ status, productId, chartId, chart, rawChart: raw, ...extra });
}

Deno.serve(handle(async (req) => {
  await getUser(req); // validates a token if one is sent; anonymous is fine
  const input = parse(ResolveChartInput, await readJson(req));
  const db = adminClient();

  const brandId = await upsertBrand(db, input.brand);
  const productId = await upsertProduct(db, input, brandId);

  // ---- parsed chart from the page
  if (input.chart) {
    const raw = input.chart as RawSizeChart;
    const rawHash = await hashChart(raw);
    const hit = await findChart(db, productId, rawHash);
    if (hit) return reply('hit', productId, hit.id, hit.raw_payload);

    const normalized = normalizeChart(raw, DEFAULT_CONFIG);
    if (normalized.sizes.length === 0 || !normalized.sizes.some((s) => s.points.chest)) {
      return reply('unusable', productId, null, null, { reason: 'chart has no readable chest values', flags: normalized.flags });
    }
    const chartId = await storeChart(db, {
      productId, brandId, category: input.category, fitTypeRaw: input.fitTypeRaw, rawHash, raw, normalized,
    });
    return reply('stored', productId, chartId, raw);
  }

  // ---- image or text the parsers could not read: LLM, once per input
  if (input.image || input.chartText) {
    const inputHash = await hashChart({ image: input.image?.url ?? null, text: input.chartText ?? null });
    const hit = await findChart(db, productId, inputHash);
    if (hit) return reply('hit', productId, hit.id, hit.raw_payload);

    const extractor = getExtractor();
    if (!extractor) return reply('unavailable', productId, null, null, { reason: 'llm_not_configured' });
    if (!(await underDailyCap(db))) return reply('unavailable', productId, null, null, { reason: 'llm_daily_cap' });

    const log = { product_id: productId, provider: extractor.provider, model: extractor.model, prompt_version: PROMPT_VERSION, input_hash: inputHash };
    let result;
    try {
      result = await extractor.extract({ imageUrl: input.image?.url, text: input.chartText, title: input.title });
    } catch (e) {
      await db.from('llm_extractions').insert({ ...log, status: 'error', error: String(e).slice(0, 1000) });
      throw new HttpError(502, 'llm_failed', 'Could not read this size chart right now.');
    }
    const normalized = result.chart ? normalizeChart(result.chart, DEFAULT_CONFIG) : null;
    if (!result.chart || !normalized || !normalized.sizes.some((s) => s.points.chest)) {
      await db.from('llm_extractions').insert({ ...log, status: 'rejected', output: result.raw, latency_ms: result.latencyMs });
      return reply('unusable', productId, null, null, { reason: 'no chart found in the image/text' });
    }
    const chartId = await storeChart(db, {
      productId, brandId, category: input.category, fitTypeRaw: input.fitTypeRaw, rawHash: inputHash, raw: result.chart, normalized,
    });
    await db.from('llm_extractions').insert({ ...log, chart_id: chartId, status: 'ok', output: result.raw, latency_ms: result.latencyMs });
    return reply('extracted', productId, chartId, result.chart);
  }

  // ---- nothing on the page: newest stored chart for this product, if any
  const latest = await findChart(db, productId);
  return latest ? reply('hit', productId, latest.id, latest.raw_payload) : reply('miss', productId, null, null);
}));
