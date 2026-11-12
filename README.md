# perfit

Chrome extension that recommends a men's shirt / T-shirt size on Myntra, Amazon.in, Flipkart, AJIO and Snitch
by comparing one saved body profile with the product's size chart, and explaining why.

## Layout

| Path | What |
| --- | --- |
| `packages/engine` | Fit engine. Pure TypeScript, zero dependencies, runs in browsers and Deno (`.ts` import extensions on purpose). |
| `packages/engine/fixtures` | Charts transcribed from the live pages checked on Nov 11, 2026, plus the blueprint's example user. |
| `apps/extension` | Chrome MV3 extension: Myntra adapter, Shadow-DOM widget (Preact), profile page, service worker. Saved-page tests in `test/fixtures`. |
| `apps/playground` | Local page for tuning: paste a chart, enter a profile, move ease bands and weights, see every size's score. |
| `supabase/migrations` | Postgres schema + RLS (catalog, user-owned, learning tables). |
| `supabase/functions` | Edge Functions `resolve-chart`, `recommend`, `feedback`. They import the engine from `packages/engine` directly. |

## Commands

```bash
npm install
npm test            # engine + extension tests (incl. the blueprint's worked example and saved Myntra pages)
npm run typecheck
npm run playground  # http://localhost:5173
npm run extension:build   # → apps/extension/dist, ready to load unpacked
npm run extension:watch   # rebuild on save; then press reload in chrome://extensions
npm run functions:check   # deno check + lint of the Edge Functions
npm run functions:bundle  # bundle each function (+ engine) into .build/<name>.js for deploy
```

## Extension (dogfood)

1. `npm run extension:build`
2. `chrome://extensions` → Developer mode → **Load unpacked** → pick `apps/extension/dist`.
3. The profile page opens on install (or click the toolbar icon). Enter your chest (plus shoulder and length, or a shirt you own), tick consent, save.
4. Open any men's shirt or T-shirt on myntra.com. The perfit box appears under **Select size**, and the picked size button gets a teal outline.

How it reads Myntra: content scripts can't read page globals, so `window.__myx.pdpData` is parsed from the inline
script. After in-app navigation that script is stale, so the adapter re-fetches the product URL (same origin) and
parses that. Selectors and paths live in `MYNTRA_CONFIG`, plain JSON ready for remote config.

Works signed out: the profile and purchase log live in `chrome.storage.local`. "I bought this" → "How did it fit?"
moves the learned chest offset locally (±0.5 in, cap ±2 in) and fills the dogfood log (export it as JSON from the
profile page). The service worker sends each chart to `resolve-chart` with the publishable key only, and caches the reply
so pages seen before work offline.

## Backend (Supabase)

| Function | Auth | Does |
| --- | --- | --- |
| `resolve-chart` | optional | Upserts brand + product; caches charts by `(product, sha256(raw chart))`; stores normalized entries; LLM fallback for image/text charts (off until `LLM_*` secrets are set). Returns `{ status, productId, chartId, chart }`. |
| `recommend` | required | Re-runs the engine on the stored raw chart with the user's DB profile (or a sent one) and logs to `recommendations` with engine version + profile snapshot for replay. Never overrides the client. |
| `feedback` | required | "I bought this" (create) then "How did it fit?" (update). First tight/loose verdict moves `profiles.feedback_offset_cm` by ±0.5 in (cap ±2 in). |

All three run with `verify_jwt = false` and authorize in code (`getClaims`): signed-out callers can resolve charts;
anything claiming to be a user is verified. Catalog tables are readable by signed-in users and writable only by the
service role; user tables are own-rows-only; `llm_extractions` is service-role only.

LLM provider (still open) is any OpenAI-compatible endpoint, set as function secrets:
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (vision-capable), optional `LLM_PROVIDER`, `LLM_DAILY_CAP` (default 200).

## Engine in one call

```ts
import { recommend } from '@perfit/engine';
const rec = recommend(profile, productSpec); // { size, runnerUp, confidence, band, perSize, explanation, ... }
```

All lengths are stored in **cm, full circumference**. Every tunable number (ease bands, τ, weights, confidence
factors) lives in `packages/engine/src/config.ts`; bump `ENGINE_VERSION` whenever a change can alter an answer.

## Status

- [x] M0: fit engine, tests, algorithm playground
- [x] M1: MV3 extension skeleton + Myntra adapter + Shadow-DOM widget (dogfood gate: load unpacked, buy, log the fit)
- [ ] Engine: length-step sanity check (a real Myntra chart jumps 28.35 → 58.27 in and raises no flag)
- [ ] Snitch / AJIO / Amazon.in adapters, saved-page tests
- [x] Supabase: schema + RLS, `resolve-chart`, `recommend`, `feedback` (deployed)
- [ ] Google sign-in provider + extension auth flow
- [ ] Flipkart investigation; LLM provider key (fallback code is in place)
