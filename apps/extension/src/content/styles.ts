// Lives inside the Shadow DOM, so retailer CSS can't reach it and it can't leak out.
// Font is inherited from the page on purpose: the widget should read as part of the page.

export const WIDGET_CSS = `
:host { all: initial; display: block; font-family: inherit; }
* { box-sizing: border-box; }
.card {
  --ink: #1f2430; --muted: #646b78; --line: #e3e5ea; --bg: #ffffff; --soft: #f6f7f9;
  --accent: #0f766e; --accent-soft: #e6f4f2; --warn: #9a5b00; --warn-soft: #fdf3e2;
  margin: 16px 0 4px; padding: 14px 16px; max-width: 460px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
  color: var(--ink); font-size: 14px; line-height: 1.45; font-family: inherit;
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.brand { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: lowercase; color: var(--accent); }
.pill { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--muted); }
.pill.high { background: var(--accent-soft); color: var(--accent); }
.pill.low { background: var(--warn-soft); color: var(--warn); }
.size { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.size b { font-size: 26px; line-height: 1.1; }
.size .alt { color: var(--muted); font-size: 13px; }
.lead { margin: 6px 0 0; }
.note { margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; font-size: 13px; background: var(--warn-soft); color: var(--warn); }
.muted { color: var(--muted); font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
button {
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 6px 12px;
  border: 1px solid var(--line); background: var(--bg); color: var(--ink);
}
button:hover { border-color: var(--ink); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
button.link { border: 0; padding: 0; background: none; color: var(--accent); font-weight: 600; }
button.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
ul { margin: 8px 0 0; padding-left: 18px; }
li + li { margin-top: 2px; }
table { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
td.num { font-variant-numeric: tabular-nums; }
tr.best td { font-weight: 700; background: var(--accent-soft); }
tr.oos td { color: var(--muted); }
.feedback { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.feedback p { margin: 0 0 8px; }
@media (prefers-reduced-motion: no-preference) { button { transition: border-color .12s, background .12s; } }
`;
