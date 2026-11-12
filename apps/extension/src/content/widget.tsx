// The on-page widget. Presentational only: it renders a View and reports clicks. It decides nothing.

import { fmtLen, type PointResult, type QualityFlag, type RecommendationOk, type SizeScore, type Unit } from '@perfit/engine';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { SizeOffer } from '../adapters/types.ts';
import type { FitOverall, Purchase } from '../shared/storage.ts';

export type View =
  | { kind: 'loading' }
  | { kind: 'no_profile' }
  | { kind: 'chart_missing'; detail: string }
  | { kind: 'insufficient'; message: string }
  | { kind: 'ok'; rec: RecommendationOk; offers: SizeOffer[]; unit: Unit; purchase?: Purchase; serverUpdated?: boolean };

export interface WidgetActions {
  openProfile(): void;
  bought(size: string): void;
  fit(overall: FitOverall): void;
  undoBought(): void;
}

const BAND_TEXT = { high: 'Strong match', medium: 'Good match', low: 'Unsure' } as const;

export function sizeName(label: string, brandLabel?: string): string {
  return brandLabel ? `${label} (${brandLabel})` : label;
}

export function flagText(f: QualityFlag): string | null {
  if (f === 'fit_type_assumed') return "The page doesn't state the fit, so perfit assumed a regular fit.";
  if (f === 'unit_ambiguous') return "The chart doesn't state its units; perfit inferred them.";
  if (f === 'unparsed_value') return "Some chart values couldn't be read.";
  if (f === 'duplicate_size') return 'The chart lists a size twice.';
  if (f === 'chest_step_small' || f === 'chest_step_large') return 'Chest steps between sizes look unusual for this chart.';
  if (f.startsWith('non_monotonic:')) return `The seller's ${f.split(':')[1]} values don't rise with size. Check the chart.`;
  return null;
}

function pointWord(p: PointResult): string | null {
  if (p.status === 'ok') return null;
  if (p.point === 'length') return p.status === 'tight' ? 'short' : 'long';
  return `${p.status} at ${p.point}`;
}

function fitSummary(s: SizeScore): string {
  const words = s.points.map(pointWord).filter(Boolean);
  return words.length ? words.join(', ') : 'fits';
}

export function Widget({ view, actions }: { view: View; actions: WidgetActions }) {
  return (
    <section class="card" aria-label="perfit size recommendation">
      {view.kind === 'loading' && <Head><span class="muted">Reading the size chart…</span></Head>}
      {view.kind === 'no_profile' && (
        <>
          <Head />
          <p class="lead">perfit can pick your size from this shirt's chart once it knows your measurements.</p>
          <div class="actions"><button class="primary" onClick={actions.openProfile}>Set up my profile</button></div>
        </>
      )}
      {view.kind === 'chart_missing' && (
        <>
          <Head />
          <p class="lead">perfit couldn't find a size chart on this page, so it won't guess a size.</p>
          <p class="muted">{view.detail}</p>
        </>
      )}
      {view.kind === 'insufficient' && (
        <>
          <Head />
          <p class="lead">{view.message}</p>
          <div class="actions"><button onClick={actions.openProfile}>Edit my profile</button></div>
        </>
      )}
      {view.kind === 'ok' && <Result view={view} actions={actions} />}
    </section>
  );
}

function Head({ children }: { children?: ComponentChildren }) {
  return <div class="head"><span class="brand">perfit</span>{children}</div>;
}

function Result({ view, actions }: { view: Extract<View, { kind: 'ok' }>; actions: WidgetActions }) {
  const { rec, offers, unit, purchase } = view;
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const best = rec.perSize.find((s) => s.label === rec.size)!;
  const offerOf = (label: string) => offers.find((o) => o.label === label);
  const outOfStock = offerOf(rec.size)?.available === false;
  const warnings = rec.chart.flags.map(flagText).filter((x): x is string => !!x);
  const pct = Math.round(rec.confidence * 100);
  const runner = rec.runnerUp ? rec.perSize.find((s) => s.label === rec.runnerUp) : undefined;

  return (
    <>
      <Head><span class={`pill ${rec.band}`} title={`Confidence ${pct}%`}>{BAND_TEXT[rec.band]} · {pct}%</span></Head>
      <div class="size">
        <span class="muted">Your size</span>
        {rec.display.kind === 'single'
          ? <b>{sizeName(best.label, best.brandLabel)}</b>
          : <b>{rec.display.sizes.join(' or ')}</b>}
        {rec.display.kind === 'single' && runner && (
          <span class="alt">· next best {sizeName(runner.label, runner.brandLabel)}</span>
        )}
      </div>
      {rec.explanation[1] && <p class="lead">{rec.explanation[1]}</p>}
      {outOfStock && <p class="note">{rec.size} is out of stock right now.{runner && offerOf(runner.label)?.available !== false ? ` ${runner.label} is the next best fit.` : ''}</p>}
      {view.serverUpdated && <p class="muted">Updated with perfit's verified chart.</p>}

      <div class="actions">
        <button class="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Why this size?'}</button>
      </div>

      {open && (
        <div>
          <ul>{rec.explanation.map((e) => <li>{e}</li>)}</ul>
          {warnings.length > 0 && <ul class="muted">{warnings.map((w) => <li>{w}</li>)}</ul>}
          <table>
            <thead><tr><th>Size</th><th>Chest</th><th>Room</th><th>Fit</th></tr></thead>
            <tbody>
              {rec.perSize.map((s) => {
                const chest = s.points.find((p) => p.point === 'chest');
                const oos = offerOf(s.label)?.available === false;
                return (
                  <tr class={s.label === rec.size ? 'best' : oos ? 'oos' : ''}>
                    <td>{sizeName(s.label, s.brandLabel)}{oos ? ' · sold out' : ''}</td>
                    <td class="num">{chest ? fmtLen(chest.chartCm, unit) : '–'}</td>
                    <td class="num">{chest?.roomCm != null ? fmtLen(chest.roomCm, unit, { signed: true }) : '–'}</td>
                    <td>{fitSummary(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="muted">{rec.fitType} fit {rec.category === 'tshirt' ? 'T-shirt' : 'shirt'} · chart basis {rec.chart.basis} ({rec.chart.basisCertainty}) · engine {rec.engineVersion}</p>
        </div>
      )}

      <Feedback rec={rec} offers={offers} purchase={purchase} picking={picking} setPicking={setPicking} actions={actions} unit={unit} />
    </>
  );
}

function Feedback(props: {
  rec: RecommendationOk; offers: SizeOffer[]; purchase?: Purchase; unit: Unit;
  picking: boolean; setPicking(v: boolean): void; actions: WidgetActions;
}) {
  const { rec, offers, purchase, picking, setPicking, actions, unit } = props;
  const [chosen, setChosen] = useState(rec.size);

  if (purchase) {
    const verdicts: [FitOverall, string][] = [['perfect', 'Fits well'], ['tight', 'Too tight'], ['loose', 'Too loose'], ['returned', 'Returned it']];
    return (
      <div class="feedback">
        <p>You bought <b>{purchase.boughtSize}</b>. How did it fit?</p>
        <div class="actions" style="margin-top:0">
          {verdicts.map(([v, text]) => (
            <button class="chip" aria-pressed={purchase.fit?.overall === v} onClick={() => actions.fit(v)}>{text}</button>
          ))}
        </div>
        {purchase.fit && purchase.fit.offsetDeltaCm !== 0 && (
          <p class="muted" style="margin:8px 0 0">
            Noted. perfit will allow {fmtLen(Math.abs(purchase.fit.offsetDeltaCm), unit)} {purchase.fit.offsetDeltaCm > 0 ? 'more' : 'less'} room at the chest from now on.
          </p>
        )}
        <div class="actions"><button class="link" onClick={actions.undoBought}>I didn't buy this</button></div>
      </div>
    );
  }

  if (picking) {
    return (
      <div class="feedback">
        <p>Which size did you buy?</p>
        <div class="actions" style="margin-top:0">
          {offers.map((o) => (
            <button class="chip" aria-pressed={chosen === o.label} onClick={() => setChosen(o.label)}>{o.label}</button>
          ))}
        </div>
        <div class="actions">
          <button class="primary" onClick={() => { actions.bought(chosen); setPicking(false); }}>Save</button>
          <button onClick={() => setPicking(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div class="actions">
      <button onClick={() => setPicking(true)}>I bought this</button>
      <button class="link" onClick={actions.openProfile}>Edit my profile</button>
    </div>
  );
}
