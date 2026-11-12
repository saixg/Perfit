// Profile page: measurements, a reference shirt, consent, the dogfood log and "delete my data".

import { fmtLen, type FitPref, type FitType, type GarmentVerdict, type Unit } from '@perfit/engine';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  deleteAllData, getProfile, getPurchases, KEYS, onKeyChange, removePurchase, setProfile,
  type Purchase, type StoredProfile,
} from '../shared/storage.ts';
import './options.css';
import { EMPTY_FORM, formFromProfile, profileFromForm, switchUnit, type ProfileForm } from './profile-form.ts';

function App() {
  const [prev, setPrev] = useState<StoredProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [log, setLog] = useState<Purchase[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const p = await getProfile();
      setPrev(p);
      setForm(formFromProfile(p));
      setLog(await getPurchases());
      setLoaded(true);
    })();
    const offLog = onKeyChange<Purchase[]>(KEYS.purchases, (v) => setLog(v ?? []));
    const offProfile = onKeyChange<StoredProfile>(KEYS.profile, (v) => setPrev(v ?? null)); // feedback moves the offset
    return () => { offLog(); offProfile(); };
  }, []);

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => { setForm({ ...form, [k]: v }); setSaved(false); };
  const u = form.unit;

  const save = async (e: Event) => {
    e.preventDefault();
    const r = profileFromForm(form, prev);
    if (!r.ok) { setErrors(r.errors); setSaved(false); return; }
    await setProfile(r.profile);
    setPrev(r.profile);
    setErrors([]);
    setSaved(true);
  };

  const wipe = async () => {
    if (!confirm('Delete your measurements, purchase log and cached charts from this browser? This cannot be undone.')) return;
    await deleteAllData();
    setPrev(null); setForm(EMPTY_FORM); setLog([]); setSaved(false);
  };

  const exportLog = () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `perfit-dogfood-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!loaded) return null;
  const offset = prev?.feedbackOffsetCm ?? 0;

  return (
    <main>
      <header>
        <h1>perfit</h1>
        <p>Your measurements stay in this browser. perfit compares them with each product's size chart.</p>
      </header>

      <form onSubmit={save} noValidate>
        <section>
          <h2>Basics</h2>
          <div class="row">
            <Select label="Units" value={u} onChange={(v) => { setForm(switchUnit(form, v as Unit)); setSaved(false); }}
              options={[['in', 'Inches'], ['cm', 'Centimetres']]} />
            <Select label="I like my shirts" value={form.fitPref} onChange={(v) => set('fitPref', v as FitPref)}
              options={[['snug', 'Snug'], ['regular', 'Regular'], ['relaxed', 'Relaxed']]} />
          </div>
        </section>

        <section>
          <h2>Body measurements</h2>
          <p class="hint">Measure over a T-shirt with a soft tape. Chest: around the fullest part, under the arms, tape level.</p>
          <div class="row">
            <Num label={`Chest (${u})`} value={form.chest} onInput={(v) => set('chest', v)} required />
            <Num label={`Shoulder (${u})`} value={form.shoulder} onInput={(v) => set('shoulder', v)} hint="Shoulder tip to tip, across the back" />
          </div>
          <div class="row">
            <Num label="Height (cm)" value={form.heightCm} onInput={(v) => set('heightCm', v)} hint="Used to guess length if you skip it" />
            <Num label={`Preferred shirt length (${u})`} value={form.length} onInput={(v) => set('length', v)} hint="Collar seam to hem, at the back" />
          </div>
        </section>

        <section>
          <h2>A shirt that fits you well <span class="tag">recommended</span></h2>
          <label class="check">
            <input type="checkbox" checked={form.hasRef} onChange={(e) => set('hasRef', e.currentTarget.checked)} />
            I'll measure a shirt I own. It's more reliable than a body tape measure.
          </label>
          {form.hasRef && (
            <>
              <p class="hint">Button it up and lay it flat. Pit-to-pit: straight across, armpit seam to armpit seam.</p>
              <div class="row">
                <Select label="It's a" value={form.refCategory} onChange={(v) => set('refCategory', v as 'shirt' | 'tshirt')}
                  options={[['shirt', 'Shirt'], ['tshirt', 'T-shirt']]} />
                <Select label="Fit" value={form.refFit} onChange={(v) => set('refFit', v as FitType)}
                  options={[['slim', 'Slim'], ['regular', 'Regular'], ['relaxed', 'Relaxed'], ['oversized', 'Oversized']]} />
              </div>
              <div class="row">
                <Num label={`Pit-to-pit (${u})`} value={form.refPitToPit} onInput={(v) => set('refPitToPit', v)} required />
                <Num label={`Shoulder (${u})`} value={form.refShoulder} onInput={(v) => set('refShoulder', v)} />
              </div>
              <div class="row">
                <Num label={`Length (${u})`} value={form.refLength} onInput={(v) => set('refLength', v)} />
                <Select label="How it fits" value={form.refVerdict} onChange={(v) => set('refVerdict', v as GarmentVerdict)}
                  options={[['perfect', 'Just right'], ['slightly_tight', 'A bit tight'], ['slightly_loose', 'A bit loose']]} />
              </div>
            </>
          )}
        </section>

        <section>
          <label class="check">
            <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.currentTarget.checked)} />
            I agree that perfit stores these measurements in this browser to recommend sizes. I can delete them any time below.
          </label>
          {errors.length > 0 && <ul class="errors" role="alert">{errors.map((e) => <li>{e}</li>)}</ul>}
          <div class="actions">
            <button class="primary" type="submit">Save profile</button>
            {saved && <span class="ok" role="status">Saved. Open any Myntra shirt page to see your size.</span>}
          </div>
        </section>
      </form>

      {prev && (
        <section>
          <h2>Learned from your purchases</h2>
          <p>
            {offset === 0
              ? 'No adjustment yet. Tell perfit how bought shirts fit, and it learns your taste.'
              : `perfit allows ${fmtLen(Math.abs(offset), prev.unitPref)} ${offset > 0 ? 'more' : 'less'} chest room than the standard bands.`}
          </p>
          {offset !== 0 && (
            <button onClick={() => void setProfile({ ...prev, feedbackOffsetCm: 0 })}>Reset adjustment</button>
          )}
        </section>
      )}

      <section>
        <h2>Purchase log</h2>
        {log.length === 0
          ? <p class="hint">Use "I bought this" in the perfit box on a product page. Each purchase and how it fit lands here.</p>
          : (
            <>
              <table>
                <thead><tr><th>Product</th><th>perfit said</th><th>Bought</th><th>Fit</th><th></th></tr></thead>
                <tbody>
                  {log.map((p) => (
                    <tr>
                      <td><a href={p.url} target="_blank" rel="noreferrer">{p.brand ?? p.retailer}</a><div class="hint">{p.title}</div></td>
                      <td>{p.recommendedSize} <span class="hint">({p.band}, {Math.round(p.confidence * 100)}%)</span></td>
                      <td>{p.boughtSize}<div class="hint">{p.boughtAt.slice(0, 10)}</div></td>
                      <td>{p.fit?.overall ?? <span class="hint">not yet</span>}</td>
                      <td><button class="link" onClick={() => void removePurchase(p.id)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div class="actions"><button onClick={exportLog}>Export log (JSON)</button></div>
            </>
          )}
      </section>

      <section class="danger">
        <h2>Your data</h2>
        <p class="hint">Removes your profile, purchase log and cached size charts from this browser.</p>
        <button onClick={() => void wipe()}>Delete all my perfit data</button>
      </section>
    </main>
  );
}

function Num(p: { label: string; value: string; onInput(v: string): void; hint?: string; required?: boolean }) {
  return (
    <label>
      <span>{p.label}{p.required ? '' : <span class="opt"> optional</span>}</span>
      <input inputMode="decimal" value={p.value} onInput={(e) => p.onInput(e.currentTarget.value)} />
      {p.hint && <small>{p.hint}</small>}
    </label>
  );
}

function Select(p: { label: string; value: string; onChange(v: string): void; options: [string, string][] }) {
  return (
    <label>
      <span>{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.currentTarget.value)}>
        {p.options.map(([v, t]) => <option value={v}>{t}</option>)}
      </select>
    </label>
  );
}

render(<App />, document.getElementById('app')!);
