// chrome.storage.local is the source of truth while signed out (login is optional in perfit).
// Content script, service worker and options page all read and write through these helpers.

import type { FitProfile, RawSizeChart } from '@perfit/engine';

export interface StoredProfile extends FitProfile {
  /** ISO time the user agreed to store measurements on this device (DPDP consent). */
  consentAt: string;
  updatedAt: string;
}

export type FitOverall = 'perfect' | 'tight' | 'loose' | 'returned';
export type FitWord = 'tight' | 'ok' | 'loose';

/** One row of the dogfood log: what perfit said, what was bought, how it fit. */
export interface Purchase {
  id: string;
  retailer: string;
  productId: string;
  url: string;
  title?: string;
  brand?: string;
  category: string;
  fitType: string;
  recommendedSize: string;
  runnerUp?: string;
  confidence: number;
  band: string;
  engineVersion: string;
  boughtSize: string;
  boughtAt: string;
  fit?: {
    overall: FitOverall;
    perPoint?: Partial<Record<'chest' | 'shoulder' | 'length', FitWord>>;
    at: string;
    /** Offset change this verdict applied, so it can be shown and undone later. */
    offsetDeltaCm: number;
  };
}

export interface CachedChart {
  chartId: string | null;
  rawChart: RawSizeChart | null;
  rawHash: string | null;
  fetchedAt: number;
}

export const KEYS = { profile: 'profile', purchases: 'purchases' } as const;
export const chartKey = (retailer: string, productId: string) => `chart:${retailer}:${productId}`;

export async function getProfile(): Promise<StoredProfile | null> {
  const r = await chrome.storage.local.get(KEYS.profile);
  return (r[KEYS.profile] as StoredProfile | undefined) ?? null;
}

export async function setProfile(p: StoredProfile): Promise<void> {
  await chrome.storage.local.set({ [KEYS.profile]: { ...p, updatedAt: new Date().toISOString() } });
}

export async function getPurchases(): Promise<Purchase[]> {
  const r = await chrome.storage.local.get(KEYS.purchases);
  return (r[KEYS.purchases] as Purchase[] | undefined) ?? [];
}

export async function savePurchase(p: Purchase): Promise<void> {
  const all = await getPurchases();
  const i = all.findIndex((x) => x.id === p.id);
  if (i >= 0) all[i] = p;
  else all.unshift(p);
  await chrome.storage.local.set({ [KEYS.purchases]: all });
}

export async function removePurchase(id: string): Promise<void> {
  const all = await getPurchases();
  await chrome.storage.local.set({ [KEYS.purchases]: all.filter((x) => x.id !== id) });
}

/** The "delete my data" button: profile, log and chart cache, everything. */
export async function deleteAllData(): Promise<void> {
  await chrome.storage.local.clear();
}

/** Subscribe to changes of one key from any extension context. Returns an unsubscribe function. */
export function onKeyChange<T>(key: string, fn: (value: T | undefined) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && key in changes) fn(changes[key]!.newValue as T | undefined);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
