/**
 * demo-scene — the single source of truth for the Claude Keeper demo animation.
 *
 * Describes the terminal scene as timed items {start,end,...}. Two renderers
 * consume it: make-demo.mjs (animated SVG for the web) and the frame renderer
 * (static SVGs at a given time t, rasterised to PNG/GIF for Dev.to & friends).
 * Mirrors the deterministic behaviour of test/fixtures/fake-claude.mjs.
 */

export const T = 15; // loop length in seconds

export const C = {
  bg: '#0d1117',
  chrome: '#161b22',
  border: '#30363d',
  fg: '#c9d1d9',
  dim: '#6e7681',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  cyan: '#39c5cf',
  user: '#e6edf3',
};

export const W = 760;
export const H = 470;
const HEADER = 36;
const STATUS_H = 34;
const PAD_X = 20;
const TOP = HEADER + 26;
const LH = 22;
export const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the list of timed text items and the static chrome markup.
export function buildScene() {
  const items = []; // {start,end,x,y,fill,text,weight,size,anchor}
  const add = (o) => items.push({ weight: 'normal', size: 14, anchor: 'start', ...o });

  // --- terminal body (each line reveals and persists to end of loop) ---
  let row = 0;
  const line = (start, text, fill = C.fg) => {
    add({ start, end: T, x: PAD_X, y: TOP + row * LH, fill, text });
    row++;
  };
  const blank = () => row++;

  line(0.3, '$ claude', C.dim);
  line(0.8, 'Claude Code · Pro', C.fg);
  line(1.1, 'ready', C.dim);
  blank();
  line(1.9, '❯ refactor the auth module and add tests', C.user);
  line(2.4, '● refactor the auth module and add tests', C.green);
  line(2.8, '  ↳ editing src/auth/session.ts …', C.dim);
  line(3.3, '  ↳ running the test suite …', C.dim);
  blank();
  line(4.0, 'Claude usage limit reached. Your limit will reset at 3:00 PM (America/New_York).', C.yellow);
  blank();
  line(9.6, '❯ continue', C.blue);
  line(10.0, '● continue', C.green);
  line(10.4, 'Resuming previous conversation…', C.cyan);
  line(10.9, '  ↳ auth module refactored ✓', C.dim);
  line(11.4, '  ↳ 12 tests added — all green ✓', C.dim);

  // --- status bar (only one state visible at a time) ---
  const sy = H - STATUS_H / 2 + 5;
  const status = (start, end, text, fill) =>
    add({ start, end, x: PAD_X, y: sy, fill, text, weight: 'bold' });

  status(1.1, 4.0, '●  Running — hosting Claude Code', C.green);
  const counts = ['00:05', '00:04', '00:03', '00:02', '00:01', '00:00'];
  counts.forEach((c, i) => {
    const s = 4.0 + i * 0.9;
    status(s, s + 0.9, `⏳  Limit reached — resuming in ${c}`, C.yellow);
  });
  status(9.4, 11.8, '▶  Reset reached — resuming session', C.blue);
  status(11.8, T, '●  Running — task continued', C.green);

  // AUTO-RESUME pill (always visible)
  const pill = `
  <rect x="${W - 118}" y="${H - STATUS_H + 7}" width="98" height="${STATUS_H - 14}" rx="9" fill="none" stroke="${C.border}"/>
  <text x="${W - 69}" y="${sy}" fill="${C.dim}" text-anchor="middle" font-size="12">AUTO-RESUME</text>`;

  const chrome = `
  <rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
  <rect width="${W}" height="${HEADER}" rx="10" fill="${C.chrome}"/>
  <rect y="${HEADER - 10}" width="${W}" height="10" fill="${C.chrome}"/>
  <line x1="0" y1="${HEADER}" x2="${W}" y2="${HEADER}" stroke="${C.border}"/>
  <circle cx="20" cy="18" r="6" fill="#ff5f56"/>
  <circle cx="40" cy="18" r="6" fill="#ffbd2e"/>
  <circle cx="60" cy="18" r="6" fill="#27c93f"/>
  <text x="${W / 2}" y="23" fill="${C.dim}" text-anchor="middle" font-size="13" font-family="${FONT}">Claude Keeper — never babysit a usage limit again</text>`;

  const statusChrome = `
  <line x1="0" y1="${H - STATUS_H}" x2="${W}" y2="${H - STATUS_H}" stroke="${C.border}"/>
  <rect y="${H - STATUS_H}" width="${W}" height="${STATUS_H}" fill="${C.chrome}"/>${pill}`;

  return { items, chrome, statusChrome };
}

function textEl(it, opacityOrClass) {
  const attr =
    opacityOrClass.cls != null
      ? `class="${opacityOrClass.cls}"`
      : `opacity="${opacityOrClass.opacity}"`;
  return `<text x="${it.x}" y="${it.y}" fill="${it.fill}" font-weight="${it.weight}" font-size="${it.size}" text-anchor="${it.anchor}" ${attr}>${esc(it.text)}</text>`;
}

// Render a STATIC frame showing everything visible at time t (for PNG/GIF frames).
export function renderFrameSvg(t) {
  const { items, chrome, statusChrome } = buildScene();
  const visible = items
    .filter((it) => t >= it.start && t < it.end)
    .map((it) => textEl(it, { opacity: 1 }))
    .join('\n');
  // bar backgrounds first, then text on top
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="14"><style>text{white-space:pre}</style>${chrome}${statusChrome}\n${visible}</svg>\n`;
}

// Render the ANIMATED SVG (CSS keyframes) for the web / README.
export function renderAnimatedSvg() {
  const { items, chrome, statusChrome } = buildScene();
  const css = [];
  const els = [];
  items.forEach((it, i) => {
    const name = `k${i}`;
    const s = Math.max(0, (it.start / T) * 100);
    const e = Math.min(100, (it.end / T) * 100);
    const d = 0.25;
    const kf = ['0%{opacity:0}'];
    if (s > d) kf.push(`${(s - d).toFixed(2)}%{opacity:0}`);
    kf.push(`${s.toFixed(2)}%{opacity:1}`);
    if (e >= 99.7) {
      kf.push('100%{opacity:1}');
    } else {
      kf.push(`${e.toFixed(2)}%{opacity:1}`);
      kf.push(`${Math.min(100, e + d).toFixed(2)}%{opacity:0}`);
      kf.push('100%{opacity:0}');
    }
    css.push(`@keyframes ${name}{${kf.join('')}}`);
    css.push(`.${name}{opacity:0;animation:${name} ${T}s linear infinite}`);
    els.push(textEl(it, { cls: name }));
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="14">
<style>
${css.join('\n')}
text{white-space:pre}
</style>${chrome}${statusChrome}
${els.join('\n')}
</svg>
`;
}
