// MV3 service worker. Owns every network call (Supabase) and the local chart cache, so product
// pages seen before still work offline. Holds no secret: only the public publishable key.

import { hashChart, type RawSizeChart } from '@perfit/engine';
import { CHART_CACHE_TTL_MS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../shared/config.ts';
import type { Message, ResolveChartRequest, ResolveChartResponse } from '../shared/messages.ts';
import { chartKey, type CachedChart } from '../shared/storage.ts';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'openOptions') {
    void chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg.type === 'resolveChart') {
    resolveChart(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) } satisfies ResolveChartResponse));
    return true; // async response
  }
  return false;
});

interface ResolveReply {
  status: string;
  chartId: string | null;
  rawChart: RawSizeChart | null;
}

async function resolveChart(req: ResolveChartRequest): Promise<ResolveChartResponse> {
  const key = chartKey(req.retailer, req.retailerProductId);
  const cached = (await chrome.storage.local.get(key))[key] as CachedChart | undefined;
  const pageHash = req.chart ? await hashChart(req.chart) : null;

  // Same chart as last time and still fresh: nobody pays for another round trip.
  if (cached && cached.rawHash === pageHash && Date.now() - cached.fetchedAt < CHART_CACHE_TTL_MS) {
    return { ok: true, status: 'local', fromCache: true, cached };
  }

  const { type: _type, ...body } = req;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-chart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as ResolveReply & { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    const next: CachedChart = {
      chartId: data.chartId,
      rawChart: data.rawChart,
      rawHash: data.rawChart ? await hashChart(data.rawChart) : null,
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ [key]: next });
    return { ok: true, status: data.status, fromCache: false, cached: next };
  } catch (e) {
    // Offline or server down: an older cached chart is still better than nothing.
    if (cached) return { ok: true, status: 'stale', fromCache: true, cached };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
