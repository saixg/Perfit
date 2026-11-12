// Myntra adapter. Myntra server-renders `window.__myx = {...}` into an inline <script>, and
// pdpData.sizes[].measurements carries every value with its unit and GARMENT/BODY type.
//
// Content scripts live in an isolated world and can't read window.__myx, so the adapter parses
// the script's text instead. After an in-app (SPA) navigation that script is stale, so when its
// product id doesn't match the URL, the adapter fetches the product page's HTML and parses that.

import type { Basis, Category, ProductSpec, RawMeasurement, RawSizeChart, RawSizeRow, Unit } from '@perfit/engine';
import type { AdapterResult, PageContext, SiteAdapter, SizeOffer } from './types.ts';

/**
 * Everything that breaks when Myntra changes its page. Plain JSON on purpose: the blueprint keeps
 * selectors in remote config so a fix doesn't need a store release (remote loading lands with M3).
 */
export const MYNTRA_CONFIG = {
  version: '1',
  scriptMarker: 'window.__myx',
  productIdPattern: '/(\\d{5,10})/buy(?:[/?#]|$)',
  mountSelectors: ['#sizeButtonsContainer', '.size-buttons-size-container'],
  sizeButtonSelector: '.size-buttons-size-button',
  sizeButtonLabelSelector: '.size-buttons-unified-size',
  /** analytics.articleType → category. Anything else is out of scope (kurtas, jackets...). */
  articleTypes: { shirts: 'shirt', tshirts: 'tshirt', 'lounge tshirts': 'tshirt' } as Record<string, Category>,
  genders: ['men', 'unisex'],
};

// ------------------------------------------------------------------ the bits of pdpData we read

export interface MyntraMeasurement {
  type?: string;
  measurementType?: string;
  name: string;
  value?: string | number | null;
  minValue?: string | number | null;
  maxValue?: string | number | null;
  unit?: string;
}

export interface MyntraSize {
  label: string;
  available?: boolean;
  measurements?: MyntraMeasurement[] | null;
  allSizesList?: { scaleCode?: string; sizeValue?: string }[] | null;
}

export interface MyntraPdp {
  id: number | string;
  name?: string;
  brand?: { name?: string } | null;
  analytics?: { articleType?: string; gender?: string } | null;
  articleAttributes?: Record<string, string> | null;
  sizechart?: { sizeChartUrl?: string | null } | null;
  sizeChartDisclaimerText?: string | null;
  sizes?: MyntraSize[] | null;
}

// ------------------------------------------------------------------ parsing the inline script

/** Parse the JSON object out of a `window.__myx = {...}` script body. Null if absent or broken. */
export function parseMyxScript(text: string): { pdpData?: MyntraPdp } | null {
  const at = text.indexOf(MYNTRA_CONFIG.scriptMarker);
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Find and parse the __myx script inside a full HTML document string. */
export function pdpFromHtml(html: string): MyntraPdp | null {
  const at = html.indexOf(`${MYNTRA_CONFIG.scriptMarker} =`);
  if (at < 0) return null;
  const end = html.indexOf('</script>', at);
  return parseMyxScript(html.slice(at, end < 0 ? undefined : end))?.pdpData ?? null;
}

export function pdpFromDocument(doc: Document): MyntraPdp | null {
  for (const s of Array.from(doc.scripts)) {
    const text = s.textContent ?? '';
    if (text.includes(`${MYNTRA_CONFIG.scriptMarker} =`)) return parseMyxScript(text)?.pdpData ?? null;
  }
  return null;
}

// ------------------------------------------------------------------ pdpData → ProductSpec

const present = (v: string | undefined | null): string | undefined => {
  const s = v?.trim();
  return s && !/^(na|n\/a|-)$/i.test(s) ? s : undefined;
};

function unitOf(u: string | undefined): Unit | undefined {
  if (!u) return undefined;
  if (/^(in|inch|inches)$/i.test(u.trim())) return 'in';
  if (/^(cm|cms|centimet(er|re)s?)$/i.test(u.trim())) return 'cm';
  return undefined;
}

function basisOf(t: string | undefined): Basis | undefined {
  if (!t) return undefined;
  if (/garment/i.test(t)) return 'garment';
  if (/body/i.test(t)) return 'body';
  return undefined;
}

function measurementValue(m: MyntraMeasurement): number | string | null {
  const lo = m.minValue ?? m.value;
  const hi = m.maxValue ?? m.value;
  if (lo == null || lo === '') return null;
  // A real range ("To fit 38-40") stays a string so the engine sees it as a range (→ body hint).
  if (hi != null && String(hi) !== String(lo)) return `${lo}-${hi}`;
  const n = Number(lo);
  return Number.isFinite(n) ? n : String(lo);
}

const STRETCH = /elastane|lycra|spandex|stretch/i;

export function pdpToResult(pdp: MyntraPdp): AdapterResult {
  const attrs = pdp.articleAttributes ?? {};
  const articleType = (pdp.analytics?.articleType ?? '').trim().toLowerCase();
  const gender = (pdp.analytics?.gender ?? '').trim().toLowerCase();

  const category = MYNTRA_CONFIG.articleTypes[articleType];
  if (!category) return { kind: 'unsupported', reason: 'category', detail: pdp.analytics?.articleType ?? 'unknown' };
  if (gender && !MYNTRA_CONFIG.genders.includes(gender)) {
    return { kind: 'unsupported', reason: 'gender', detail: pdp.analytics?.gender ?? '' };
  }

  const sizes = pdp.sizes ?? [];
  const offers: SizeOffer[] = sizes.map((s) => ({
    label: s.label,
    brandLabel: brandLabelOf(s),
    available: s.available !== false,
  }));

  const rows: RawSizeRow[] = sizes
    .filter((s) => (s.measurements?.length ?? 0) > 0)
    .map((s) => ({
      label: s.label,
      brandLabel: brandLabelOf(s),
      measurements: s.measurements!.map((m): RawMeasurement => ({
        name: m.name,
        value: measurementValue(m),
        basis: basisOf(m.measurementType ?? m.type),
        unit: unitOf(m.unit),
      })),
    }));

  const basisText = present(attrs['Body or Garment Size']) ?? present(pdp.sizeChartDisclaimerText);
  const chart: RawSizeChart | null = rows.length
    ? {
      source: 'structured_json',
      statedBasis: basisOf(basisText),
      basisLabel: basisText,
      sizes: rows,
    }
    : null;

  const fabric = [attrs['Fabrics'], attrs['Fabric'], attrs['Fabric 2'], attrs['Fabric Type']]
    .map(present).filter(Boolean).join(', ') || undefined;
  const fitTypeRaw = present(attrs['Fit']) ?? present(attrs['Brand Fit Name']);

  const spec: ProductSpec = {
    retailer: 'myntra',
    productId: String(pdp.id),
    brand: present(pdp.brand?.name),
    title: present(pdp.name),
    category,
    fitTypeRaw,
    hasStretch: fabric ? STRETCH.test(fabric) : undefined,
    chart,
  };
  return { kind: 'ok', spec, offers, fabric, chartImageUrl: present(pdp.sizechart?.sizeChartUrl) };
}

function brandLabelOf(s: MyntraSize): string | undefined {
  const b = s.allSizesList?.find((x) => x.scaleCode === 'brand_size')?.sizeValue?.trim();
  return b && b !== s.label ? b : undefined;
}

// ------------------------------------------------------------------ the adapter

const productRe = new RegExp(MYNTRA_CONFIG.productIdPattern);

export const myntraAdapter: SiteAdapter = {
  id: 'myntra',
  version: `myntra-${MYNTRA_CONFIG.version}`,

  matches: (url) => /(^|\.)myntra\.com$/.test(url.hostname),

  productIdFromUrl: (url) => url.pathname.match(productRe)?.[1] ?? null,

  async read({ doc, url, fetchHtml }: PageContext): Promise<AdapterResult> {
    const wanted = this.productIdFromUrl(url);
    let pdp = pdpFromDocument(doc);
    if (!pdp || String(pdp.id) !== wanted) {
      try {
        pdp = pdpFromHtml(await fetchHtml(url.href));
      } catch (e) {
        return { kind: 'error', reason: 'data_not_found', detail: `fetch failed: ${String(e)}` };
      }
    }
    if (!pdp) return { kind: 'error', reason: 'data_not_found', detail: 'no window.__myx.pdpData on the page' };
    if (wanted && String(pdp.id) !== wanted) {
      return { kind: 'error', reason: 'data_not_found', detail: `page data is for ${pdp.id}, URL is ${wanted}` };
    }
    try {
      return pdpToResult(pdp);
    } catch (e) {
      return { kind: 'error', reason: 'parse_failed', detail: String(e) };
    }
  },

  mountAnchor(doc) {
    for (const sel of MYNTRA_CONFIG.mountSelectors) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return null;
  },

  sizeButtons(doc) {
    const out = new Map<string, HTMLElement>();
    doc.querySelectorAll<HTMLElement>(MYNTRA_CONFIG.sizeButtonSelector).forEach((b) => {
      const label = buttonLabel(b.querySelector(MYNTRA_CONFIG.sizeButtonLabelSelector) ?? b);
      if (label) out.set(label.toUpperCase(), b);
    });
    return out;
  },
};

/**
 * The size label is the element's OWN text: on some products Myntra nests the price inside it
 * (`<p>38<div>Rs. 1198</div></p>`, seen live Nov 12, 2026), so textContent would read "38 Rs. 1198".
 */
export function buttonLabel(el: Element): string {
  const own = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3) // text nodes only
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();
  return own || (el.textContent ?? '').trim().split(/\s+/)[0] || '';
}
