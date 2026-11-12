// Saved-page tests: real Myntra pdpData captured on Nov 12, 2026, through the adapter and engine.

import { recommend } from '@perfit/engine';
import { exampleUser } from '@perfit/engine/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { myntraAdapter, parseMyxScript, pdpFromHtml, pdpToResult, type MyntraPdp } from '../src/adapters/myntra.ts';
import bearHouse from './fixtures/myntra-19347680-bearhouse-slim-shirt.json';
import pepe from './fixtures/myntra-40345594-pepe-slim-tshirt.json';

const BEAR_URL = 'https://www.myntra.com/shirts/the+bear+house/the-bear-house-men-beige-solid-slim-fit-cotton-shirt/19347680/buy';
const PEPE_URL = 'https://www.myntra.com/tshirts/pepe+jeans/pepe-jeans-men-printed-pure-cotton-slim-fit-t-shirt/40345594/buy';

/** Wrap pdpData the way Myntra serves it: an inline script assigning window.__myx. */
const pageHtml = (pdp: unknown) =>
  `<html><head></head><body><div id="mountRoot"></div><script>window.__myx = ${JSON.stringify({ pdpData: pdp, dataExpired: false })}</script></body></html>`;

function ok(pdp: unknown) {
  const r = pdpToResult(pdp as MyntraPdp);
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.kind}: ${JSON.stringify(r)}`);
  return r;
}

describe('myntra: URL handling', () => {
  it('reads the product id from product URLs only', () => {
    expect(myntraAdapter.productIdFromUrl(new URL(BEAR_URL))).toBe('19347680');
    expect(myntraAdapter.productIdFromUrl(new URL(`${BEAR_URL}?skuId=1`))).toBe('19347680');
    expect(myntraAdapter.productIdFromUrl(new URL('https://www.myntra.com/men-tshirts'))).toBeNull();
    expect(myntraAdapter.matches(new URL(BEAR_URL))).toBe(true);
    expect(myntraAdapter.matches(new URL('https://www.ajio.com/x/p/1'))).toBe(false);
  });
});

describe('myntra: script parsing', () => {
  it('parses window.__myx from a script body and from full HTML', () => {
    expect(parseMyxScript(`window.__myx = ${JSON.stringify({ pdpData: { id: 1 } })}`)?.pdpData?.id).toBe(1);
    expect(pdpFromHtml(pageHtml(bearHouse.pdpData))?.id).toBe(19347680);
    expect(parseMyxScript('window.__myx = {broken')).toBeNull();
    expect(pdpFromHtml('<html>nothing here</html>')).toBeNull();
  });
});

describe('myntra: Bear House slim shirt (numeric sizes, brand sizes, GARMENT)', () => {
  const r = ok(bearHouse.pdpData);

  it('builds a structured, garment-stated, inch chart', () => {
    expect(r.spec).toMatchObject({
      retailer: 'myntra', productId: '19347680', brand: 'THE BEAR HOUSE', category: 'shirt', fitTypeRaw: 'Slim Fit', hasStretch: false,
    });
    expect(r.spec.chart?.source).toBe('structured_json');
    expect(r.spec.chart?.statedBasis).toBe('garment');
    expect(r.spec.chart?.sizes).toHaveLength(6);
    expect(r.spec.chart?.sizes[0]).toEqual({
      label: '38', brandLabel: 'S',
      measurements: [
        { name: 'Chest', value: 40.25, basis: 'garment', unit: 'in' },
        { name: 'Front Length', value: 29.25, basis: 'garment', unit: 'in' },
        { name: 'Across Shoulder', value: 16.75, basis: 'garment', unit: 'in' },
      ],
    });
    expect(r.offers.map((o) => `${o.label}/${o.brandLabel}`)).toEqual(['38/S', '40/M', '42/L', '44/XL', '46/XXL', '48/3XL']);
  });

  it('recommends 40 (M) for the blueprint example user with a stated basis', () => {
    const rec = recommend(exampleUser, r.spec);
    expect(rec.status).toBe('ok');
    if (rec.status !== 'ok') return;
    expect(rec.chart.basisCertainty).toBe('stated');
    expect(rec.chart.flags).toEqual([]);
    expect(rec.size).toBe('40');
    expect(rec.perSize.find((s) => s.label === '40')?.brandLabel).toBe('M');
  });
});

describe('myntra: Pepe Jeans slim T-shirt (alpha sizes, out-of-stock sizes, bad seller data)', () => {
  const r = ok(pepe.pdpData);

  it('maps Tshirts to tshirt and keeps stock state', () => {
    expect(r.spec.category).toBe('tshirt');
    expect(r.offers.filter((o) => !o.available).map((o) => o.label)).toEqual(['XL', '3XL']);
    expect(r.spec.chart?.sizes[0]?.measurements.map((m) => m.name)).toContain('Sleeve-Length');
  });

  it('passes the seller values through untouched, and the bad 3XL length cannot win', () => {
    expect(r.spec.chart?.sizes[5]?.measurements[1]).toMatchObject({ name: 'Front Length', value: 58.27 });
    const rec = recommend(exampleUser, r.spec);
    if (rec.status !== 'ok') throw new Error(rec.message);
    // KNOWN GAP (engine 0.1.0): 25.2 → 58.27 in still "rises", and step checks are chest-only, so no flag.
    // Update this when the engine gains a length-step check.
    expect(rec.chart.flags).toEqual([]);
    expect(rec.perSize.find((s) => s.label === '3XL')!.score).toBeGreaterThan(100);
    // The example user's 28 in preferred length is a shirt length; tees run shorter, so L beats M on length.
    expect([rec.size, rec.runnerUp]).toEqual(['L', 'M']);
  });
});

describe('myntra: scope and failure states', () => {
  it('ignores categories and genders outside the MVP', () => {
    const kurta = { ...bearHouse.pdpData, analytics: { ...bearHouse.pdpData.analytics, articleType: 'Kurtas' } };
    expect(pdpToResult(kurta as MyntraPdp)).toMatchObject({ kind: 'unsupported', reason: 'category' });
    const women = { ...bearHouse.pdpData, analytics: { ...bearHouse.pdpData.analytics, gender: 'Women' } };
    expect(pdpToResult(women as MyntraPdp)).toMatchObject({ kind: 'unsupported', reason: 'gender' });
  });

  it('returns a null chart (not a guess) when sizes carry no measurements', () => {
    const bare = { ...bearHouse.pdpData, sizes: bearHouse.pdpData.sizes.map((s) => ({ ...s, measurements: [] })) };
    const res = ok(bare);
    expect(res.spec.chart).toBeNull();
    expect(recommend(exampleUser, res.spec)).toMatchObject({ status: 'insufficient', reason: 'no_chart' });
  });

  it('keeps BODY ranges as range strings with body basis', () => {
    const body = {
      ...bearHouse.pdpData,
      sizes: [{ label: '40', available: true, measurements: [{ name: 'To Fit Chest', minValue: '38', maxValue: '40', unit: 'Inches', measurementType: 'BODY' }] }],
    };
    expect(ok(body).spec.chart?.sizes[0]?.measurements[0]).toEqual({ name: 'To Fit Chest', value: '38-40', basis: 'body', unit: 'in' });
  });
});

describe('myntra: reading a live document', () => {
  const load = (html: string) => {
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
  };

  it('uses the inline script when it matches the URL, without fetching', async () => {
    load(pageHtml(bearHouse.pdpData));
    const fetchHtml = vi.fn();
    const r = await myntraAdapter.read({ doc: document, url: new URL(BEAR_URL), fetchHtml });
    expect(r.kind).toBe('ok');
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('fetches the page when an SPA navigation left another product in the script', async () => {
    load(pageHtml(bearHouse.pdpData));
    const fetchHtml = vi.fn(async () => pageHtml(pepe.pdpData));
    const r = await myntraAdapter.read({ doc: document, url: new URL(PEPE_URL), fetchHtml });
    expect(fetchHtml).toHaveBeenCalledWith(PEPE_URL);
    expect(r.kind === 'ok' && r.spec.productId).toBe('40345594');
  });

  it('reports data_not_found instead of using the wrong product', async () => {
    load(pageHtml(bearHouse.pdpData));
    const r = await myntraAdapter.read({ doc: document, url: new URL(PEPE_URL), fetchHtml: async () => pageHtml(bearHouse.pdpData) });
    expect(r).toMatchObject({ kind: 'error', reason: 'data_not_found' });
  });

  it('finds the mount point and size buttons', () => {
    load(`<div id="sizeButtonsContainer"><button class="size-buttons-size-button"><p class="size-buttons-unified-size">M</p></button>
      <button class="size-buttons-size-button"><p class="size-buttons-unified-size">xl</p></button></div>`);
    expect(myntraAdapter.mountAnchor(document)?.id).toBe('sizeButtonsContainer');
    expect([...myntraAdapter.sizeButtons(document).keys()]).toEqual(['M', 'XL']);
  });

  it('ignores the price Myntra nests inside the size label (live markup, Nov 12 2026)', () => {
    // Built with DOM calls: an HTML parser would hoist the <div> out of the <p>, React doesn't.
    const btn = document.createElement('button');
    btn.className = 'size-buttons-size-button';
    const p = document.createElement('p');
    p.className = 'size-buttons-unified-size';
    p.append(document.createComment(' react-text: 129 '), '38', document.createComment(' /react-text '));
    const price = document.createElement('div');
    price.className = 'size-buttons-sku-price';
    price.textContent = ' Rs. 1198';
    p.append(price);
    btn.append(p);
    document.body.replaceChildren(btn);
    expect([...myntraAdapter.sizeButtons(document).keys()]).toEqual(['38']);
  });
});
