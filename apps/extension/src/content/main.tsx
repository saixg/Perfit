// Content script controller: find the adapter → read the page → run the engine locally → render.
// In parallel the service worker asks resolve-chart; if the server holds a different (verified)
// chart, the widget re-runs on that. Re-runs on SPA navigation and on profile/log changes.

import { applyFeedback, canonicalJson, DEFAULT_CONFIG, recommend, type RawSizeChart } from '@perfit/engine';
import { render } from 'preact';
import { adapterFor, type AdapterResult, type SiteAdapter } from '../adapters/index.ts';
import { send, type ResolveChartResponse } from '../shared/messages.ts';
import {
  getProfile, getPurchases, KEYS, onKeyChange, removePurchase, savePurchase, setProfile,
  type FitOverall, type Purchase, type StoredProfile,
} from '../shared/storage.ts';
import { WIDGET_CSS } from './styles.ts';
import { Widget, type View, type WidgetActions } from './widget.tsx';

const HOST_ID = 'perfit-widget-host';
const HIGHLIGHT_ATTR = 'data-perfit-pick';
const URL_POLL_MS = 700;
const ANCHOR_WAIT_MS = 15_000;

type Ok = Extract<AdapterResult, { kind: 'ok' }>;

interface PageState {
  key: string;
  url: string;
  adapter: SiteAdapter;
  result: AdapterResult | null;
  /** Chart from resolve-chart when it differs from the page's. */
  serverChart: RawSizeChart | null;
}

let state: PageState | null = null;
let shadow: ShadowRoot | null = null;
let runId = 0;

// ------------------------------------------------------------------ mounting

function ensureHost(anchor: Element): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    shadow.append(style, document.createElement('div'));
  }
  // Myntra's React re-renders can drop or move nodes: keep the host right after the anchor.
  if (anchor.nextElementSibling !== host) anchor.after(host);
  return shadow ?? host.shadowRoot!;
}

function unmount() {
  const host = document.getElementById(HOST_ID);
  if (host) {
    render(null, host.shadowRoot!.lastElementChild!);
    host.remove();
  }
  shadow = null;
  clearHighlight();
}

function waitForAnchor(adapter: SiteAdapter, id: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = adapter.mountAnchor(document);
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = adapter.mountAnchor(document);
      if (el || id !== runId) { obs.disconnect(); clearTimeout(timer); resolve(id === runId ? el : null); }
    });
    const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, ANCHOR_WAIT_MS);
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

function clearHighlight() {
  document.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}]`).forEach((b) => {
    b.style.removeProperty('outline');
    b.style.removeProperty('outline-offset');
    b.removeAttribute(HIGHLIGHT_ATTR);
  });
}

/** Outline the page's own button for the picked size. Inline style only: no retailer classes touched. */
function highlight(adapter: SiteAdapter, label: string | null) {
  clearHighlight();
  if (!label) return;
  const btn = adapter.sizeButtons(document).get(label.toUpperCase());
  if (!btn) return;
  btn.setAttribute(HIGHLIGHT_ATTR, '');
  btn.style.setProperty('outline', '2px solid #0f766e');
  btn.style.setProperty('outline-offset', '2px');
}

// ------------------------------------------------------------------ view

async function computeView(s: PageState): Promise<View> {
  const r = s.result;
  if (!r) return { kind: 'loading' };
  if (r.kind === 'error') return { kind: 'chart_missing', detail: `(${r.reason}) ${r.detail}` };
  if (r.kind !== 'ok') return { kind: 'loading' }; // unsupported pages never reach render

  const profile = await getProfile();
  if (!profile) return { kind: 'no_profile' };

  const spec = s.serverChart ? { ...r.spec, chart: s.serverChart } : r.spec;
  if (!spec.chart) {
    return { kind: 'chart_missing', detail: "This product's sizes have no measurements, and perfit has no saved chart for it yet." };
  }
  const rec = recommend(profile, spec, DEFAULT_CONFIG);
  if (rec.status !== 'ok') return { kind: 'insufficient', message: rec.message };

  const purchase = (await getPurchases()).find((p) => p.retailer === spec.retailer && p.productId === spec.productId);
  return { kind: 'ok', rec, offers: r.offers, unit: profile.unitPref, purchase, serverUpdated: !!s.serverChart };
}

async function paint() {
  const s = state;
  if (!s || s.result?.kind === 'unsupported') return;
  const anchor = s.adapter.mountAnchor(document);
  if (!anchor) return;
  const view = await computeView(s);
  if (s !== state) return; // navigated meanwhile
  const root = ensureHost(anchor);
  render(<Widget view={view} actions={actions} />, root.lastElementChild!);
  highlight(s.adapter, view.kind === 'ok' && view.rec.display.kind === 'single' ? view.rec.size : null);
}

// ------------------------------------------------------------------ actions

const actions: WidgetActions = {
  openProfile: () => void send({ type: 'openOptions' }),

  async bought(size) {
    const r = state?.result;
    if (r?.kind !== 'ok') return;
    const view = await computeView(state!);
    if (view.kind !== 'ok') return;
    const { rec } = view;
    const p: Purchase = {
      id: crypto.randomUUID(),
      retailer: r.spec.retailer,
      productId: r.spec.productId,
      url: location.href,
      title: r.spec.title,
      brand: r.spec.brand,
      category: rec.category,
      fitType: rec.fitType,
      recommendedSize: rec.size,
      runnerUp: rec.runnerUp,
      confidence: Number(rec.confidence.toFixed(3)),
      band: rec.band,
      engineVersion: rec.engineVersion,
      boughtSize: size,
      boughtAt: new Date().toISOString(),
    };
    await savePurchase(p); // storage listener repaints
  },

  async fit(overall: FitOverall) {
    const r = state?.result;
    if (r?.kind !== 'ok') return;
    const purchase = (await getPurchases()).find((p) => p.retailer === r.spec.retailer && p.productId === r.spec.productId);
    const profile = await getProfile();
    if (!purchase || !profile) return;
    // Changing an earlier verdict first undoes what it applied, so the offset never double-counts.
    const base = (profile.feedbackOffsetCm ?? 0) - (purchase.fit?.offsetDeltaCm ?? 0);
    const next = applyFeedback(base, overall, DEFAULT_CONFIG);
    await setProfile({ ...profile, feedbackOffsetCm: next });
    await savePurchase({ ...purchase, fit: { overall, at: new Date().toISOString(), offsetDeltaCm: next - base } });
  },

  async undoBought() {
    const r = state?.result;
    if (r?.kind !== 'ok') return;
    const purchase = (await getPurchases()).find((p) => p.retailer === r.spec.retailer && p.productId === r.spec.productId);
    if (!purchase) return;
    const delta = purchase.fit?.offsetDeltaCm ?? 0;
    if (delta) {
      const profile = await getProfile();
      if (profile) await setProfile({ ...profile, feedbackOffsetCm: (profile.feedbackOffsetCm ?? 0) - delta });
    }
    await removePurchase(purchase.id);
  },
};

// ------------------------------------------------------------------ page lifecycle

async function onUrl() {
  const url = new URL(location.href);
  const adapter = adapterFor(url);
  const productId = adapter?.productIdFromUrl(url) ?? null;
  if (!adapter || !productId) {
    state = null;
    unmount();
    return;
  }
  const key = `${adapter.id}:${productId}`;
  if (state?.key === key) return;

  const id = ++runId;
  unmount();
  state = { key, url: url.href, adapter, result: null, serverChart: null };
  const mine = state;

  const anchor = await waitForAnchor(adapter, id);
  if (id !== runId || !anchor) return;
  void paint(); // "Reading the size chart…"

  const result = await adapter.read({
    doc: document,
    url,
    fetchHtml: (u) => fetch(u, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }),
  });
  if (id !== runId) return;
  mine.result = result;
  if (result.kind === 'unsupported') return unmount();
  if (result.kind === 'error') console.warn('[perfit]', result.reason, result.detail);
  void paint();
  if (result.kind === 'ok') void syncWithServer(mine, result, id);
}

async function syncWithServer(s: PageState, r: Ok, id: number) {
  const { spec } = r;
  let res: ResolveChartResponse;
  try {
    res = await send<ResolveChartResponse>({
      type: 'resolveChart',
      retailer: spec.retailer,
      retailerProductId: spec.productId,
      url: location.href,
      title: spec.title,
      brand: spec.brand,
      category: spec.category,
      fitTypeRaw: spec.fitTypeRaw,
      fabric: r.fabric,
      hasStretch: spec.hasStretch,
      chart: spec.chart ?? undefined,
      image: !spec.chart && r.chartImageUrl?.startsWith('https://') ? { url: r.chartImageUrl } : undefined,
    });
  } catch (e) {
    console.warn('[perfit] resolve-chart unavailable', e); // extension reloaded, SW asleep, offline…
    return;
  }
  if (id !== runId || !res?.ok) {
    if (res && !res.ok) console.warn('[perfit] resolve-chart failed:', res.error);
    return;
  }
  const server = res.cached.rawChart;
  if (server && (!spec.chart || canonicalJson(server) !== canonicalJson(spec.chart))) {
    s.serverChart = server;
    void paint();
  }
}

// Profile edits (options page) and log changes (this or another tab) repaint immediately.
onKeyChange<StoredProfile>(KEYS.profile, () => void paint());
onKeyChange<Purchase[]>(KEYS.purchases, () => void paint());

// Myntra is an SPA: the page's own pushState is invisible from the isolated world, so poll the URL.
let lastHref = '';
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    void onUrl();
  } else if (state?.result && !document.getElementById(HOST_ID)) {
    void paint(); // the page re-rendered and dropped the widget
  }
}, URL_POLL_MS);
