import {
  DEFAULT_CONFIG, fmtLen, fromCm, parseDelimited, recommend, tableToRawChart, toCm,
  type Basis, type Category, type ChartSource, type EngineConfig, type FitPref, type FitProfile,
  type FitType, type GarmentVerdict, type ProductSpec, type Unit,
} from '@perfit/engine';
import { useMemo, useState } from 'preact/hooks';
import { PRESETS, type ChartPreset } from './presets.ts';

const FIT_TYPES: FitType[] = ['slim', 'regular', 'relaxed', 'oversized'];
const SOURCES: ChartSource[] = ['structured_json', 'html_table', 'llm_image', 'brand_default'];

type Num = string; // inputs stay as strings so typing "4" → "41.5" doesn't fight the parser
const num = (s: Num): number | undefined => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));

interface ProfileForm {
  unit: Unit; fitPref: FitPref;
  chest: Num; shoulder: Num; height: Num; length: Num;
  useRef: boolean; refFit: FitType; refPitToPit: Num; refShoulder: Num; refLength: Num; refVerdict: GarmentVerdict;
}

const initialProfile: ProfileForm = {
  unit: 'in', fitPref: 'regular', chest: '39', shoulder: '17.5', height: '', length: '28',
  useRef: false, refFit: 'regular', refPitToPit: '22', refShoulder: '18', refLength: '29', refVerdict: 'perfect',
};

function buildProfile(f: ProfileForm): FitProfile {
  const cm = (s: Num) => { const v = num(s); return v == null ? undefined : toCm(v, f.unit); };
  const pit = cm(f.refPitToPit);
  return {
    unitPref: f.unit,
    fitPref: f.fitPref,
    body: { source: 'manual', chestCm: cm(f.chest), shoulderCm: cm(f.shoulder), heightCm: num(f.height) },
    preferredLengthCm: cm(f.length),
    referenceGarments: f.useRef && pit != null ? [{
      category: 'shirt', fitType: f.refFit, chestCm: pit * 2, shoulderCm: cm(f.refShoulder), lengthCm: cm(f.refLength), verdict: f.refVerdict,
    }] : [],
  };
}

export function App() {
  const [preset, setPreset] = useState<ChartPreset>(PRESETS[0]!);
  const [text, setText] = useState(preset.text);
  const [unit, setUnit] = useState<Unit | 'auto'>(preset.unit);
  const [basis, setBasis] = useState<Basis | 'auto'>(preset.basis);
  const [source, setSource] = useState<ChartSource>(preset.source);
  const [category, setCategory] = useState<Category>(preset.category);
  const [fitRaw, setFitRaw] = useState(preset.fitRaw);
  const [pf, setPf] = useState<ProfileForm>(initialProfile);
  const [cfg, setCfg] = useState<EngineConfig>(DEFAULT_CONFIG);

  const loadPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(p); setText(p.text); setUnit(p.unit); setBasis(p.basis); setSource(p.source);
    setCategory(p.category); setFitRaw(p.fitRaw);
  };

  const product: ProductSpec = useMemo(() => ({
    retailer: 'playground', productId: preset.id, category, fitTypeRaw: fitRaw,
    chart: tableToRawChart(parseDelimited(text), {
      source,
      unit: unit === 'auto' ? undefined : unit,
      statedBasis: basis === 'auto' ? undefined : basis,
      basisLabel: basis === 'auto' ? preset.basisLabel : undefined,
    }),
  }), [text, unit, basis, source, category, fitRaw, preset]);

  const rec = useMemo(() => recommend(buildProfile(pf), product, cfg), [pf, product, cfg]);
  const u = pf.unit;
  const setP = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setPf({ ...pf, [k]: v });

  const fit = rec.status === 'ok' ? rec.fitType : 'regular';
  const ease = cfg.chestEase[category][fit];
  const setEase = (k: 'lo' | 'hi', vIn: number) => setCfg({
    ...cfg,
    chestEase: { ...cfg.chestEase, [category]: { ...cfg.chestEase[category], [fit]: { ...ease, [k]: toCm(vIn, 'in') } } },
  });
  const setWeight = (k: 'chest' | 'shoulder' | 'length', v: number) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: v } });

  return (
    <div class="page">
      <header class="top">
        <h1>perfit <span>playground</span></h1>
        <p>Engine v{cfg.version}. Paste a chart, enter a profile, tune the bands. Nothing leaves this page.</p>
      </header>

      <main class="grid">
        <section class="card">
          <h2>Chart</h2>
          <label>Preset
            <select value={preset.id} onChange={(e) => loadPreset(e.currentTarget.value)}>
              {PRESETS.map((p) => <option value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Table (tab, comma or space separated; first row is headers)
            <textarea rows={8} spellcheck={false} value={text} onInput={(e) => setText(e.currentTarget.value)} />
          </label>
          <div class="row">
            <label>Unit
              <select value={unit} onChange={(e) => setUnit(e.currentTarget.value as Unit | 'auto')}>
                <option value="auto">auto-detect</option><option value="in">in</option><option value="cm">cm</option>
              </select>
            </label>
            <label>Basis
              <select value={basis} onChange={(e) => setBasis(e.currentTarget.value as Basis | 'auto')}>
                <option value="auto">auto-detect</option><option value="garment">garment (stated)</option><option value="body">body (stated)</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>Source
              <select value={source} onChange={(e) => setSource(e.currentTarget.value as ChartSource)}>
                {SOURCES.map((s) => <option value={s}>{s}</option>)}
              </select>
            </label>
            <label>Category
              <select value={category} onChange={(e) => setCategory(e.currentTarget.value as Category)}>
                <option value="shirt">shirt</option><option value="tshirt">t-shirt</option>
              </select>
            </label>
          </div>
          <label>Fit label on page
            <input value={fitRaw} placeholder="e.g. Slim Fit (blank = unknown)" onInput={(e) => setFitRaw(e.currentTarget.value)} />
          </label>
        </section>

        <section class="card">
          <h2>Profile</h2>
          <div class="row">
            <label>Units
              <select value={u} onChange={(e) => {
                const next = e.currentTarget.value as Unit;
                const conv = (s: Num) => { const v = num(s); return v == null ? s : String(Number(fromCm(toCm(v, u), next).toFixed(2))); };
                setPf({ ...pf, unit: next, chest: conv(pf.chest), shoulder: conv(pf.shoulder), length: conv(pf.length),
                  refPitToPit: conv(pf.refPitToPit), refShoulder: conv(pf.refShoulder), refLength: conv(pf.refLength) });
              }}>
                <option value="in">inches</option><option value="cm">cm</option>
              </select>
            </label>
            <label>I like it
              <select value={pf.fitPref} onChange={(e) => setP('fitPref', e.currentTarget.value as FitPref)}>
                <option value="snug">snug</option><option value="regular">regular</option><option value="relaxed">relaxed</option>
              </select>
            </label>
          </div>
          <div class="row">
            <NumField label={`Chest (${u})`} value={pf.chest} onInput={(v) => setP('chest', v)} />
            <NumField label={`Shoulder (${u})`} value={pf.shoulder} onInput={(v) => setP('shoulder', v)} />
          </div>
          <div class="row">
            <NumField label="Height (cm)" value={pf.height} onInput={(v) => setP('height', v)} />
            <NumField label={`Preferred length (${u})`} value={pf.length} onInput={(v) => setP('length', v)} />
          </div>
          <label class="check">
            <input type="checkbox" checked={pf.useRef} onChange={(e) => setP('useRef', e.currentTarget.checked)} />
            Use a reference shirt that fits well
          </label>
          {pf.useRef && (
            <div class="ref">
              <div class="row">
                <label>Its fit
                  <select value={pf.refFit} onChange={(e) => setP('refFit', e.currentTarget.value as FitType)}>
                    {FIT_TYPES.map((f) => <option value={f}>{f}</option>)}
                  </select>
                </label>
                <label>Verdict
                  <select value={pf.refVerdict} onChange={(e) => setP('refVerdict', e.currentTarget.value as GarmentVerdict)}>
                    <option value="perfect">perfect</option><option value="slightly_tight">slightly tight</option><option value="slightly_loose">slightly loose</option>
                  </select>
                </label>
              </div>
              <div class="row three">
                <NumField label={`Pit-to-pit (${u})`} value={pf.refPitToPit} onInput={(v) => setP('refPitToPit', v)} />
                <NumField label={`Shoulder (${u})`} value={pf.refShoulder} onInput={(v) => setP('refShoulder', v)} />
                <NumField label={`Length (${u})`} value={pf.refLength} onInput={(v) => setP('refLength', v)} />
              </div>
            </div>
          )}

          <h2 class="sub">Tuning <button class="link" onClick={() => setCfg(DEFAULT_CONFIG)}>reset</button></h2>
          <p class="hint">Chest ease band for <b>{category} · {fit}</b>, in inches</p>
          <div class="row">
            <Slider label="lo" min={-2} max={12} step={0.25} value={fromCm(ease.lo, 'in')} onInput={(v) => setEase('lo', v)} />
            <Slider label="hi" min={-2} max={14} step={0.25} value={fromCm(ease.hi, 'in')} onInput={(v) => setEase('hi', v)} />
          </div>
          <p class="hint">Weights</p>
          <div class="row three">
            <Slider label="chest" min={0} max={1} step={0.05} value={cfg.weights.chest} onInput={(v) => setWeight('chest', v)} />
            <Slider label="shoulder" min={0} max={1} step={0.05} value={cfg.weights.shoulder} onInput={(v) => setWeight('shoulder', v)} />
            <Slider label="length" min={0} max={1} step={0.05} value={cfg.weights.length} onInput={(v) => setWeight('length', v)} />
          </div>
        </section>

        <section class="card result">
          <h2>Recommendation</h2>
          {rec.status === 'insufficient' ? (
            <p class="empty">{rec.message}</p>
          ) : (
            <>
              <div class="verdict">
                <div class="size">{rec.display.kind === 'single' ? rec.display.size : rec.display.sizes.join(' / ')}</div>
                <div>
                  <span class={`pill ${rec.band}`}>{rec.band} · {(rec.confidence * 100).toFixed(0)}%</span>
                  <div class="meta">{rec.fitType} fit · {rec.chart.basis} chart ({rec.chart.basisCertainty}) · {rec.chart.unit}</div>
                </div>
              </div>
              <ul class="explain">{rec.explanation.map((s) => <li>{s}</li>)}</ul>

              <table class="scores">
                <thead><tr><th>Size</th><th>Chest</th><th>Room</th><th>Shoulder</th><th>Length</th><th>Score</th></tr></thead>
                <tbody>
                  {rec.perSize.map((s) => {
                    const p = Object.fromEntries(s.points.map((x) => [x.point, x]));
                    const cell = (k: string) => {
                      const x = p[k];
                      return x ? <td class={x.status}>{fmtLen(x.chartCm, u).replace(` ${u}`, '')}</td> : <td class="na">–</td>;
                    };
                    return (
                      <tr class={s.label === rec.size ? 'best' : s.label === rec.runnerUp ? 'runner' : ''}>
                        <td>{s.label}{s.brandLabel ? <small> {s.brandLabel}</small> : null}</td>
                        {cell('chest')}
                        <td>{p.chest?.roomCm != null ? fmtLen(p.chest.roomCm, u, { signed: true }).replace(` ${u}`, '') : '–'}</td>
                        {cell('shoulder')}{cell('length')}
                        <td class="num">{Number.isFinite(s.score) ? s.score.toFixed(2) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p class="legend"><span class="tight">tight</span> <span class="ok">in band</span> <span class="loose">loose</span> · values in {u}</p>

              <h3>Confidence</h3>
              <dl class="parts">
                {Object.entries(rec.confidenceParts).map(([k, v]) => (
                  <div><dt>{k}</dt><dd><div class="bar"><i style={{ width: `${v * 100}%` }} /></div><span>{v.toFixed(2)}</span></dd></div>
                ))}
              </dl>
              <p class="hint">Basis: {rec.chart.basisReason}.</p>
              {rec.chart.notes.length > 0 && <p class="hint">Notes: {rec.chart.notes.join('; ')}.</p>}
              {rec.chart.flags.length > 0 && <p class="hint warn">Flags: {rec.chart.flags.join(', ')}</p>}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function NumField(props: { label: string; value: string; onInput: (v: string) => void }) {
  return (
    <label>{props.label}
      <input inputMode="decimal" value={props.value} onInput={(e) => props.onInput(e.currentTarget.value)} />
    </label>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onInput: (v: number) => void }) {
  return (
    <label class="slider">{props.label} <b>{Number(props.value.toFixed(2))}</b>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))} />
    </label>
  );
}
