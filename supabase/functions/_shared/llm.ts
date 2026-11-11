// LLM fallback for charts the parsers can't read. The LLM only READS the chart; the engine decides the size.
// Provider is still open (NVIDIA / Groq / Gemma…). All of them speak the OpenAI-compatible
// chat-completions API, so one implementation covers them; switching is just three secrets:
//   LLM_BASE_URL   e.g. https://integrate.api.nvidia.com/v1 | https://api.groq.com/openai/v1
//   LLM_API_KEY
//   LLM_MODEL      a vision-capable model for images
// Optional: LLM_PROVIDER (label for logs), LLM_DAILY_CAP (default 200 calls/day).

import type { SupabaseClient } from './supabase.ts';
import type { RawSizeChart } from './engine.ts';
import { RawSizeChartSchema } from './schemas.ts';

export const PROMPT_VERSION = 'chart-extract-v1';

export interface ExtractionInput { imageUrl?: string; text?: string; title?: string }
export interface ExtractionResult { chart: RawSizeChart | null; raw: unknown; latencyMs: number }

export interface ChartExtractor {
  provider: string;
  model: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

const SYSTEM_PROMPT = `You read clothing size charts. Return ONLY JSON, no prose, matching:
{"unit":"in"|"cm"|null,"statedBasis":"body"|"garment"|null,"basisLabel":string|null,
 "sizes":[{"label":string,"brandLabel":string|null,"measurements":[{"name":string,"value":string}]}]}
Rules: copy numbers exactly as printed (keep ranges like "38-40"); use the column header as "name";
"statedBasis" only if the chart literally says garment/product or body/"to fit"; never guess missing values;
if there is no size chart, return {"sizes":[]}.`;

export function getExtractor(): ChartExtractor | null {
  const baseUrl = Deno.env.get('LLM_BASE_URL');
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL');
  if (!baseUrl || !apiKey || !model) return null;
  const provider = Deno.env.get('LLM_PROVIDER') ?? new URL(baseUrl).hostname;

  return {
    provider,
    model,
    async extract(input) {
      const content: unknown[] = [{ type: 'text', text: `Product: ${input.title ?? 'shirt'}\n${input.text ?? 'Read the size chart in this image.'}` }];
      if (input.imageUrl) content.push({ type: 'image_url', image_url: { url: input.imageUrl } });
      const t0 = Date.now();
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = await res.json();
      const text: string = body?.choices?.[0]?.message?.content ?? '';
      const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      return { chart: toRawChart(raw), raw, latencyMs };
    },
  };
}

/** Validate model output into a RawSizeChart; null when it isn't a usable chart. */
function toRawChart(raw: any): RawSizeChart | null {
  if (!raw || !Array.isArray(raw.sizes) || raw.sizes.length === 0) return null;
  const candidate = {
    source: 'llm_image',
    unit: raw.unit ?? undefined,
    statedBasis: raw.statedBasis ?? undefined,
    basisLabel: raw.basisLabel ?? undefined,
    sizes: raw.sizes.map((s: any) => ({
      label: String(s?.label ?? ''),
      brandLabel: s?.brandLabel ?? undefined,
      measurements: Array.isArray(s?.measurements)
        ? s.measurements.map((m: any) => ({ name: String(m?.name ?? ''), value: m?.value == null ? null : String(m.value) }))
        : [],
    })),
  };
  const r = RawSizeChartSchema.safeParse(candidate);
  return r.success ? (r.data as RawSizeChart) : null;
}

/** Daily budget cap: counts real provider calls (ok/error/rejected) since UTC midnight. */
export async function underDailyCap(db: SupabaseClient): Promise<boolean> {
  const cap = Number(Deno.env.get('LLM_DAILY_CAP') ?? 200);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db.from('llm_extractions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since.toISOString())
    .in('status', ['ok', 'error', 'rejected']);
  if (error) throw new Error(`cap check: ${error.message}`);
  return (count ?? 0) < cap;
}
