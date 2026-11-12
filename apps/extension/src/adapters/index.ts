import { myntraAdapter } from './myntra.ts';
import type { SiteAdapter } from './types.ts';

/** Snitch, AJIO, Amazon.in and Flipkart join this list in later milestones. */
export const ADAPTERS: SiteAdapter[] = [myntraAdapter];

export const adapterFor = (url: URL): SiteAdapter | undefined => ADAPTERS.find((a) => a.matches(url));

export type { AdapterResult, SiteAdapter, SizeOffer } from './types.ts';
