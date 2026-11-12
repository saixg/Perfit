// Typed messages between the content script / options page and the service worker.
// Only the service worker talks to Supabase: content scripts run under the retailer's origin.

import type { Category, RawSizeChart } from '@perfit/engine';
import type { CachedChart } from './storage.ts';

export interface ResolveChartRequest {
  type: 'resolveChart';
  retailer: string;
  retailerProductId: string;
  url: string;
  title?: string;
  brand?: string;
  category: Category;
  fitTypeRaw?: string;
  fabric?: string;
  hasStretch?: boolean;
  chart?: RawSizeChart;
  image?: { url: string };
}

export type ResolveChartResponse =
  | { ok: true; status: string; fromCache: boolean; cached: CachedChart }
  | { ok: false; error: string };

export type Message = ResolveChartRequest | { type: 'openOptions' };

export function send<R>(msg: Message): Promise<R> {
  return chrome.runtime.sendMessage(msg) as Promise<R>;
}
