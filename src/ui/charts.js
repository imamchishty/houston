// Shared chart pieces for Houston. Plain SVG, no library. Every chart registers a tip(i) so one hover handler
// (in app.js) shows a readout for any chart: values first, series names after, text only.
// Colours are tokens: --s1 and --s2 are the validated two-series pair, --series the single-series blue,
// --ink / --muted for reference lines. Text never takes a series colour.

const SERIES_VAR = { s1: 'var(--s1)', s2: 'var(--s2)', series: 'var(--series)', ink: 'var(--ink)', muted: 'var(--muted)' };
const chartNice = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const chartFmt = (v) => (v == null || Number.isNaN(v) ? '·' : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));

// Frame: y grid with three whole or tidy ticks, x labels at start, middle and end, hover targets per x.
function chartFrame(id, { labels, max, W, H, L = 38, R = 10, T = 12, B = 24, whole, xLabel }) {
  let top = chartNice(max); if (whole && top % 2) top += 1;
  const y = (v) => T + (H - T - B) * (1 - v / top), n = labels.length, slot = (W - L - R) / Math.max(1, n);
  const cx = (i) => L + i * slot + slot / 2;
  const grid = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${esc(chartFmt(v))}</text>`).join('');
  const picks = n <= 8 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const ticks = picks.map((i) => `<text x="${cx(i)}" y="${H - 7}" class="ax" text-anchor="${n > 8 && i === 0 ? 'start' : n > 8 && i === n - 1 ? 'end' : 'middle'}">${esc(xLabel ? xLabel(labels[i]) : labels[i])}</text>`).join('');
  const hits = labels.map((_, i) => `<rect class="hit" data-chart="${id}" data-i="${i}" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}"/>`).join('');
  const xhair = `<line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  return { y, cx, slot, grid, ticks, hits, xhair, H, B, T, top };
}

function chartLegend(series, kind) {
  return `<div class="legend2">${series.map((s) => `<span class="k">${kind === 'bar' ? `<i class="sw k-${s.key}"></i>` : `<i class="ln${s.dashed ? ' dash' : ''} k-${s.key}"></i>`}${esc(s.name)}</span>`).join('')}</div>`;
}

function chartTable(labels, series, xLabel) {
  return `<details class="tbl"><summary>Table</summary><table class="t"><tr><th></th>${series.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}</tr>
    ${labels.map((l, i) => `<tr><td>${esc(xLabel ? xLabel(l) : l)}</td>${series.map((s) => `<td class="num">${esc(chartFmt(s.values[i]))}</td>`).join('')}</tr>`).join('')}</table></details>`;
}

// Stacked bars also show each part's share of the bar and a total row. detail(i) can add a line under the title
// (for example how many items the bar is built from) and extra rows.
function registerTip(id, labels, series, unit, xLabel, { stacked = false, detail } = {}) {
  const u = unit ? ' ' + unit : '';
  CHARTS.set(id, { tip: (i) => {
    const total = series.reduce((t, s) => t + (s.values[i] ?? 0), 0), extra = detail?.(i) ?? {};
    const rows = series.map((s) => ({ name: s.name, value: `${chartFmt(s.values[i])}${u}${stacked && total ? ` · ${Math.round((100 * (s.values[i] ?? 0)) / total)}%` : ''}`, color: SERIES_VAR[s.key], line: s.kind !== 'bar' }));
    if (stacked) rows.push({ name: 'Total', value: `${chartFmt(total)}${u}`, color: 'transparent', line: false });
    const title = (xLabel ? xLabel(labels[i]) : String(labels[i])) + (extra.subtitle ? ` · ${extra.subtitle}` : '');
    return { title, rows: [...rows, ...(extra.rows ?? []).map((r) => ({ color: 'transparent', line: false, ...r }))] };
  } });
}

// Lines: gaps where a value is missing; an optional wash under the first series; dashed for reference lines.
// W is the drawing width in pixels at the card's usual size, so axis text stays at its natural size.
function lineChart(id, { labels, series, unit = '', H = 200, W = 640, xLabel, whole }) {
  const vals = series.flatMap((s) => s.values).filter((v) => v != null && !Number.isNaN(v));
  const f = chartFrame(id, { labels, max: Math.max(0, ...vals), W, H, xLabel, whole });
  const path = (vs) => { let d = '', pen = false; vs.forEach((v, i) => { if (v == null || Number.isNaN(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f.cx(i)},${f.y(v)}`; pen = true; }); return d; };
  const lines = series.map((s) => {
    const d = path(s.values);
    const area = s.area && d ? `<path d="${d}L${f.cx(s.values.findLastIndex((v) => v != null && !Number.isNaN(v)))},${f.y(0)}L${f.cx(s.values.findIndex((v) => v != null && !Number.isNaN(v)))},${f.y(0)}Z" class="wash k-${s.key}"/>` : '';
    const dots = s.dots ? s.values.map((v, i) => (v == null || Number.isNaN(v) ? '' : `<circle cx="${f.cx(i)}" cy="${f.y(v)}" r="4" class="mark k-${s.key}"/>`)).join('') : '';
    return `${area}<path d="${d}" class="ln2${s.dashed ? ' dash' : ''} k-${s.key}"/>${dots}`;
  }).join('');
  registerTip(id, labels, series, unit, xLabel);
  return `${chartLegend(series, 'line')}<svg viewBox="0 0 ${W} ${H}" class="dchart" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}">${f.grid}${lines}${f.xhair}${f.ticks}${f.hits}</svg>${chartTable(labels, series, xLabel)}`;
}

// Bars: grouped side by side (committed vs completed) or stacked (bugs on other work). 4px rounded data end,
// square at the baseline, at most 24px wide, a 2px surface gap between neighbours.
function barChart(id, { labels, series, unit = '', H = 200, W = 640, stacked = false, xLabel, detail }) {
  const totals = labels.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const max = stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const f = chartFrame(id, { labels, max, W, H, xLabel, whole: true });
  const groupW = Math.min(f.slot - 8, stacked ? 24 : 24 * series.length + 2 * (series.length - 1)), bw = stacked ? groupW : Math.min(24, (groupW - 2 * (series.length - 1)) / series.length);
  const rect = (x, top, bottom, w, round) => {
    const h = bottom - top; if (h <= 0) return '';
    const r = round ? Math.min(4, w / 2, h) : 0;
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
  };
  const marks = labels.map((_, i) => {
    const left = f.cx(i) - groupW / 2;
    if (!stacked) return series.map((s, k) => `<path d="${rect(left + k * (bw + 2), f.y(s.values[i] ?? 0), f.y(0), bw, true)}" class="barm k-${s.key}"/>`).join('');
    // Stacked from the baseline up; each segment ends 2px short of the one below (the surface gap); only the top rounds.
    const topK = series.map((x) => x.values[i] ?? 0).findLastIndex((v) => v > 0);
    let cum = 0;
    return series.map((s, k) => {
      const v = s.values[i] ?? 0; if (!v) return '';
      const bottom = f.y(cum) - (cum ? 2 : 0), top = f.y(cum + v); cum += v;
      return `<path d="${rect(left, top, bottom, bw, k === topK)}" class="barm k-${s.key}"/>`;
    }).join('');
  }).join('');
  registerTip(id, labels, series.map((s) => ({ ...s, kind: 'bar' })), unit, xLabel, { stacked, detail });
  return `${chartLegend(series, 'bar')}<svg viewBox="0 0 ${W} ${H}" class="dchart" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}">${f.grid}${marks}${f.xhair}${f.ticks}${f.hits}</svg>${chartTable(labels, series, xLabel)}`;
}
