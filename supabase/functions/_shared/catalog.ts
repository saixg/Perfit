// Catalog writes (service role). Users can read the catalog but never write it directly.

import type { SupabaseClient } from './supabase.ts';
import {
  DEFAULT_CONFIG, ENGINE_VERSION, type NormalizedChart, type Point, type RawSizeChart,
} from './engine.ts';
import { parseFitType } from './engine.ts';
import type { ResolveChartInput } from './schemas.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** Like check, but a missing row is an error too. */
function must<T>(r: { data: unknown; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data == null) throw new Error(`${what}: no row returned`);
  return r.data as T;
}
type IdRow = { id: string };

export async function upsertBrand(db: SupabaseClient, name: string | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  // name_key is generated; conflict on it means "same brand, different spelling".
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!key) return null;
  const found = check(await db.from('brands').select('id').eq('name_key', key).maybeSingle(), 'brand lookup');
  if (found) return (found as { id: string }).id;
  const ins = await db.from('brands').insert({ name: name.trim() }).select('id').single();
  if (ins.error?.code === '23505') { // raced with another request
    return must<IdRow>(await db.from('brands').select('id').eq('name_key', key).single(), 'brand reread').id;
  }
  return must<IdRow>(ins, 'brand insert').id;
}

export async function upsertProduct(db: SupabaseClient, input: ResolveChartInput, brandId: string | null): Promise<string> {
  const row = {
    retailer_id: input.retailer,
    retailer_product_id: input.retailerProductId,
    brand_id: brandId,
    title: input.title ?? null,
    category: input.category,
    fit_type: parseFitType(input.fitTypeRaw) ?? null,
    fit_type_raw: input.fitTypeRaw ?? null,
    fabric: input.fabric ?? null,
    has_stretch: input.hasStretch ?? null,
    url: input.url ?? null,
    last_seen_at: new Date().toISOString(),
  };
  const r = await db.from('products')
    .upsert(row, { onConflict: 'retailer_id,retailer_product_id' })
    .select('id').single();
  return must<IdRow>(r, 'product upsert').id;
}

export interface StoredChart { id: string; raw_payload: RawSizeChart; created_at: string }

export async function findChart(db: SupabaseClient, productId: string, rawHash?: string): Promise<StoredChart | null> {
  let q = db.from('size_charts').select('id, raw_payload, created_at').eq('product_id', productId);
  if (rawHash) q = q.eq('raw_hash', rawHash);
  const r = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  return check(r, 'chart lookup') as StoredChart | null;
}

/** Insert a chart and its per-size × point entries. Idempotent on (product_id, raw_hash). */
export async function storeChart(
  db: SupabaseClient,
  args: { productId: string; brandId: string | null; category: string; fitTypeRaw?: string; rawHash: string; raw: RawSizeChart; normalized: NormalizedChart },
): Promise<string> {
  const { normalized: n } = args;
  const ins = await db.from('size_charts').insert({
    product_id: args.productId,
    brand_id: args.brandId,
    category: args.category,
    fit_type: parseFitType(args.fitTypeRaw) ?? null,
    basis: n.basis,
    basis_certainty: n.basisCertainty,
    basis_confidence: DEFAULT_CONFIG.confidence.basis[n.basisCertainty],
    source: n.source,
    unit: n.unit,
    extractor_version: ENGINE_VERSION,
    raw_hash: args.rawHash,
    raw_payload: args.raw,
    quality_flags: n.flags,
  }).select('id').single();

  if (ins.error?.code === '23505') { // same chart stored by a concurrent request
    const existing = await findChart(db, args.productId, args.rawHash);
    if (existing) return existing.id;
  }
  const chartId = must<IdRow>(ins, 'chart insert').id;

  const entries = n.sizes.flatMap((s) =>
    (Object.entries(s.points) as [Point, { min: number; max: number; basis: string }][]).map(([point, m]) => ({
      chart_id: chartId,
      size_label: s.label,
      size_order: s.order,
      alt_labels: s.brandLabel ? { brand: s.brandLabel } : {},
      point,
      basis: m.basis,
      min_cm: Math.round(m.min * 100) / 100,
      max_cm: Math.round(m.max * 100) / 100,
    })));
  if (entries.length) check(await db.from('size_chart_entries').insert(entries), 'entries insert');
  return chartId;
}
