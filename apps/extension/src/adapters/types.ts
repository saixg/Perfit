// A site adapter turns one retailer's product page into a ProductSpec. It never does fit logic.

import type { ProductSpec } from '@perfit/engine';

/** A size the shopper can pick on the page, with stock. */
export interface SizeOffer {
  label: string;
  brandLabel?: string;
  available: boolean;
}

export type AdapterResult =
  | {
    kind: 'ok';
    spec: ProductSpec;
    offers: SizeOffer[];
    /** Fabric text, sent to resolve-chart for the catalog. */
    fabric?: string;
    /** A chart image the parsers can't read (resolve-chart's LLM fallback). */
    chartImageUrl?: string;
  }
  /** A page perfit doesn't cover (not a men's shirt/T-shirt): the widget stays hidden. */
  | { kind: 'unsupported'; reason: 'category' | 'gender'; detail: string }
  /** A covered page whose data couldn't be read: the widget says "chart not found", never guesses. */
  | { kind: 'error'; reason: 'data_not_found' | 'parse_failed'; detail: string };

export interface PageContext {
  doc: Document;
  url: URL;
  /** Same-origin fetch of a page's HTML (used when an SPA navigation left stale data in the DOM). */
  fetchHtml: (url: string) => Promise<string>;
}

export interface SiteAdapter {
  id: string;
  /** Bump when parsing changes so stored charts can be traced to the adapter that read them. */
  version: string;
  matches(url: URL): boolean;
  /** Retailer product id when the URL is a product page, else null. */
  productIdFromUrl(url: URL): string | null;
  read(ctx: PageContext): Promise<AdapterResult>;
  /** Element the widget is inserted after; null until the page has rendered it. */
  mountAnchor(doc: Document): Element | null;
  /** The page's own size buttons, keyed by their visible label, for highlighting the pick. */
  sizeButtons(doc: Document): Map<string, HTMLElement>;
}
