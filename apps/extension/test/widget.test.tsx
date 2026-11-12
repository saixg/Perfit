import { recommend, type RecommendationOk } from '@perfit/engine';
import { exampleUser } from '@perfit/engine/fixtures';
import { render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { pdpToResult, type MyntraPdp } from '../src/adapters/myntra.ts';
import { flagText, Widget, type View, type WidgetActions } from '../src/content/widget.tsx';
import bearHouse from './fixtures/myntra-19347680-bearhouse-slim-shirt.json';
import pepe from './fixtures/myntra-40345594-pepe-slim-tshirt.json';

const actions = (): WidgetActions => ({ openProfile: vi.fn(), bought: vi.fn(), fit: vi.fn(), undoBought: vi.fn() });

function okView(pdp: unknown): Extract<View, { kind: 'ok' }> {
  const r = pdpToResult(pdp as MyntraPdp);
  if (r.kind !== 'ok') throw new Error('fixture');
  const rec = recommend(exampleUser, r.spec) as RecommendationOk;
  return { kind: 'ok', rec, offers: r.offers, unit: 'in' };
}

function mount(view: View, a = actions()) {
  const el = document.createElement('div');
  render(<Widget view={view} actions={a} />, el);
  return { el, a };
}

const click = (el: Element, text: string) => {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  b.click();
};

describe('widget', () => {
  it('shows the size with its brand label, confidence and the reason line', () => {
    const { el } = mount(okView(bearHouse.pdpData));
    expect(el.querySelector('.size b')?.textContent).toBe('40 (M)');
    expect(el.querySelector('.pill')?.textContent).toMatch(/match · \d+%/);
    expect(el.querySelector('.lead')?.textContent).toMatch(/^Chest 42\.5 in/);
  });

  it('lists every size in the details table', async () => {
    const { el } = mount(okView(bearHouse.pdpData));
    click(el, 'Why this size?');
    await new Promise((r) => setTimeout(r));
    expect(el.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(el.querySelector('tr.best td')?.textContent).toBe('40 (M)');
  });

  it('warns when the pick is out of stock', () => {
    const v = okView(pepe.pdpData);
    const offers = v.offers.map((o) => (o.label === v.rec.size ? { ...o, available: false } : o));
    const { el } = mount({ ...v, offers });
    expect(el.querySelector('.note')?.textContent).toContain('out of stock');
  });

  it('walks "I bought this" → size pick → save', async () => {
    const { el, a } = mount(okView(bearHouse.pdpData));
    click(el, 'I bought this');
    await new Promise((r) => setTimeout(r));
    click(el, '42');
    await new Promise((r) => setTimeout(r));
    click(el, 'Save');
    expect(a.bought).toHaveBeenCalledWith('42');
  });

  it('asks how it fit once a purchase exists', () => {
    const v = okView(bearHouse.pdpData);
    const purchase = { id: 'x', boughtSize: '40' } as never;
    const { el, a } = mount({ ...v, purchase });
    click(el, 'Too tight');
    expect(a.fit).toHaveBeenCalledWith('tight');
  });

  it('prompts for a profile, and never guesses without a chart', () => {
    const { el, a } = mount({ kind: 'no_profile' });
    click(el, 'Set up my profile');
    expect(a.openProfile).toHaveBeenCalled();
    expect(mount({ kind: 'chart_missing', detail: 'x' }).el.textContent).toContain("won't guess");
  });

  it('turns quality flags into plain sentences', () => {
    expect(flagText('non_monotonic:length')).toContain('length values');
    expect(flagText('fit_type_assumed')).toContain('regular fit');
  });
});
