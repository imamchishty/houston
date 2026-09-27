const $ = (s) => document.querySelector(s);
// Every value from the API goes through esc(), including ones that look internal. Safe in text and quoted attributes.
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;' }[c]));
const cls = (s) => String(s ?? '').replace(/[^a-z0-9_-]/gi, ''); // class names: letters, digits, dash only
// POSTs carry this header; the server rejects POSTs without it, which blocks cross-site form posts.
const post = (p, body) => fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'houston' }, body: JSON.stringify(body ?? {}) });
const api = (p) => fetch('/api' + p).then((r) => r.json());
// What each metric means and how it is calculated, from /api/metrics. Loaded once, used by every page.
let METRICS = {};
const metricsReady = api('/metrics').then((list) => { METRICS = Object.fromEntries(list.map((m) => [m.id, m])); }).catch(() => {});
const doraTier = (m, v) => m?.dora?.find((b) => (b.min != null ? v >= b.min : b.max != null ? v <= b.max : true))?.tier;
const money = (n, cur) => `${esc(cur)} ${Math.round(n).toLocaleString()}`;
// "What is this?" under a finding, and the same text on the Metrics page.
const about = (m) => !m ? '' : `
  <p><b>Why it matters.</b> ${esc(m.why)}</p>
  <p><b>How it is calculated.</b> ${esc(m.how)}</p>
  ${m.thresholds ? `<p><b>Thresholds.</b> ${esc(m.thresholds)}</p>` : ''}
  ${m.dora ? `<table class="t mt"><tr><th>DORA tier</th><th>Range</th></tr>${m.dora.map((b) => `<tr><td>${esc(b.tier)}</td><td>${esc(b.test)}</td></tr>`).join('')}</table><p class="note">DORA State of DevOps research bands, approximate.</p>` : ''}`;
// Plain-language band for a 0 to 100 score, same cut-offs as the colours.
const bandOf = (n) => n >= 75 ? 'Healthy' : n >= 50 ? 'Watch' : 'Needs attention';
const rag = (v, thr = [75, 50]) => v >= thr[0] ? 'green' : v >= thr[1] ? 'amber' : 'red';

function spark(points, w = 300, h = 44) {
  if (!points.length) return '';
  const xs = points.map((_, i) => 8 + i * ((w - 16) / Math.max(1, points.length - 1)));
  const y = (v) => h - 6 - (v / 100) * (h - 12);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i]},${y(p.score)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="8" x2="${w - 8}" y1="${y(75)}" y2="${y(75)}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${xs[i]}" cy="${y(p.score)}" r="3.5" fill="var(--${cls(p.rag)})"><title>${esc(p.sprint)}: ${esc(p.score)}</title></circle>`).join('')}
  </svg>`;
}

function go(board, tab) { location.hash = board ? `#${encodeURIComponent(board)}${tab ? '/' + tab : ''}` : ''; }
window.addEventListener('hashchange', route); route();

async function route() {
  await metricsReady;
  if (location.hash === '#_metrics') return metricsPage();
  if (location.hash === '#_data') return dataPage();
  const rep = location.hash.match(/^#_(quality|predictability|efficiency)$/);
  if (rep) return reportPage(rep[1], (await api('/teams')).map((t) => t.board).sort());
  const [board, tab] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (!board) return overview();
  return team(board, tab || 'overview');
}

// Home page: the dashboard. Status of every team at a glance, what needs attention, whether the data is fresh.
const BAND_ICON = { 'Healthy': '✓', 'Watch': '●', 'Needs attention': '▲' };
const bandCls = (b) => (b === 'Healthy' ? 'green' : b === 'Watch' ? 'amber' : 'red');
// A score with its status: icon + number, band in the tooltip. Colour never carries the meaning alone.
const status = (x, what) => x == null ? '<span class="st none" title="No data">·</span>'
  : `<span class="st ${bandCls(x.band)}" title="${esc(what)}: ${esc(x.score)}, ${esc(x.band)}"><i aria-hidden="true">${BAND_ICON[x.band]}</i>${esc(x.score)}</span>`;
const TIER_CLS = { Elite: 'green', High: 'green', Medium: 'amber', Low: 'red' };
const tier = (d, what) => d ? `<span class="tierchip ${TIER_CLS[d.tier]}" title="${esc(what)}: ${esc(d.value)}${d.unit === '%' ? '%' : d.unit === 'days' ? ' days' : ''}, DORA ${esc(d.tier)}">${esc(d.tier)}</span>` : '<span class="st none">·</span>';
const ago = (h) => h == null ? 'never' : h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
// Small trend line: context in grey, the latest sprint as the one dark point.
function trendline(xs, w = 96, h = 32) {
  if (xs.length < 2) return '';
  const x = (i) => 3 + i * ((w - 6) / (xs.length - 1)), y = (v) => h - 3 - (v / 100) * (h - 6);
  return `<svg class="trend" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Sprint scores ${esc(xs.join(', '))}"><title>Last ${xs.length} sprints: ${esc(xs.join(', '))}</title>
    <path d="${xs.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round" opacity=".6"/>
    <circle cx="${x(xs.length - 1)}" cy="${y(xs[xs.length - 1])}" r="3" fill="var(--ink)" stroke="var(--panel)" stroke-width="1.5"/></svg>`;
}

// DORA: one row per metric, like a DevOps wall board. What it is and how it is measured, the headline for the
// period with the change on the previous one, and a daily chart with a 7 day average. Filters scope all four rows.
let DORA = { team: 'all', days: 30 };
const CHARTS = new Map(); // chart id -> series, for the hover readout
const shortDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const fmtNum = (v) => (v == null ? '·' : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));

function doraChart(m) {
  const id = 'c' + m.id, W = 640, H = 170, L = 34, R = 8, T = 10, B = 22, n = m.series.length;
  CHARTS.set(id, { tip: (i) => { const p = m.series[i]; return { title: shortDay(p.day), rows: [
    { name: m.seriesLabel, value: `${fmtNum(p.value)} ${p.value === 1 ? m.seriesUnit.replace(/s$/, '') : m.seriesUnit}`, color: 'var(--series)', line: m.chart === 'line' },
    { name: '7 day average', value: fmtNum(p.avg), color: 'var(--ink)', line: true }] }; } });
  const vals = m.series.flatMap((p) => [p.value, p.avg]).filter((v) => v != null);
  // Counts get whole-number gridlines: an even top, so the middle line is whole too.
  let max = niceMax(Math.max(0, ...vals)); if (m.chart === 'bar' && max % 2) max += 1;
  const y = (v) => T + (H - T - B) * (1 - v / max), slot = (W - L - R) / n;
  const bw = Math.max(1, Math.min(24, slot - 2)), cx = (i) => L + i * slot + slot / 2;
  const grid = [0, max / 2, max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${esc(fmtNum(v))}</text>`).join('');
  const bars = m.chart === 'bar' ? m.series.map((p, i) => {
    if (!p.value) return '';
    const h = (H - T - B) - (y(p.value) - T), x = cx(i) - bw / 2, top = y(p.value), r = Math.min(4, bw / 2, h);
    return `<path class="bar" d="M${x},${H - B}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - B}Z"/>`;
  }).join('') : '';
  const path = (key) => { let d = '', pen = false; m.series.forEach((p, i) => { if (p[key] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${cx(i)},${y(p[key])}`; pen = true; }); return d; };
  // Line series: each day's value as a dot (days with no data are simply absent), the 7 day average as the line.
  const daily = m.chart === 'line' ? m.series.map((p, i) => (p.value == null ? '' : `<circle class="dot" cx="${cx(i)}" cy="${y(p.value)}" r="3.5"/>`)).join('') : '';
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].map((i) => `<text x="${cx(i)}" y="${H - 6}" class="ax" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(shortDay(m.series[i].day))}</text>`).join('');
  const hits = m.series.map((_, i) => `<rect class="hit" data-chart="${id}" data-i="${i}" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" tabindex="-1"/>`).join('');
  const key = m.chart === 'bar' ? `<span class="k"><i class="sw"></i>${esc(m.seriesLabel)}, per day</span>` : `<span class="k"><i class="dt"></i>${esc(m.seriesLabel)}</span>`;
  return `<div class="legend2">${key}<span class="k"><i class="ln"></i>7 day average</span></div>
    <div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" class="dchart" role="img" aria-label="${esc(m.seriesLabel)} per day, ${esc(shortDay(m.series[0].day))} to ${esc(shortDay(m.series[n - 1].day))}">
      ${grid}${bars}${daily}<path class="avg" d="${path('avg')}"/><line class="xhair" id="x${id}" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>${ticks}${hits}</svg></div>
    <details class="tbl"><summary>Table</summary><table class="t"><tr><th>Day</th><th class="num">${esc(m.seriesUnit)}</th><th class="num">7 day average</th></tr>
      ${m.series.filter((p) => p.value != null).map((p) => `<tr><td>${esc(shortDay(p.day))}</td><td class="num">${esc(fmtNum(p.value))}</td><td class="num">${esc(fmtNum(p.avg))}</td></tr>`).join('')}</table></details>`;
}

function doraRow(m, days) {
  const delta = m.previous == null ? `<span class="muted">No earlier ${days} days to compare</span>`
    : m.better == null ? `<span class="muted">Same as the previous ${days} days</span>`
    : `<span class="${m.better ? 'up' : 'down'}">${m.better ? '▲ Better' : '▼ Worse'}</span> <span class="muted">than ${esc(fmtNum(m.previous))}${m.unit === '%' ? '%' : ''} the previous ${days} days</span>`;
  return `<section class="drow">
    <div class="dinfo"><h3>${esc(m.title)} ${m.tier ? `<span class="tierchip ${TIER_CLS[m.tier]}">DORA ${esc(m.tier)}</span>` : ''}</h3>
      <p>${esc(m.how)}</p><p class="muted">${esc(m.why)}</p></div>
    <div class="dnum"><div class="big">${esc(fmtNum(m.value))}${m.unit === '%' && m.value != null ? '<small>%</small>' : ''}</div>
      <div class="unit">${m.unit === '%' ? esc(m.note) : `${esc(m.unit)}${m.note ? ` · ${esc(m.note)}` : ''}`}</div><div class="delta">${delta}</div></div>
    <div class="dchartcell">${doraChart(m)}</div>
  </section>`;
}

async function renderDora() {
  const box = $('#dora'); if (!box) return;
  box.classList.add('loading'); // keep the frame while refetching
  const d = await api(`/dora?team=${encodeURIComponent(DORA.team)}&days=${DORA.days}`);
  if (!d.metrics) { box.innerHTML = `<p class="note">${esc(d.error ?? 'No data')}</p>`; return; }
  CHARTS.clear();
  box.innerHTML = `<p class="note">${esc(shortDay(d.from))} to ${esc(shortDay(d.to))}${d.team === 'all' ? `, all ${esc(d.boards.length)} teams together` : ''}.</p>${d.metrics.map((m) => doraRow(m, d.days)).join('')}`;
  box.classList.remove('loading');
}

// Hover readout for every chart: a crosshair at the hovered x, then the values (strong) with their series names.
// Built with textContent only: labels come from Jira and GitHub and are never treated as HTML.
function showTip(hit, evt) {
  const entry = CHARTS.get(hit.dataset.chart); if (!entry) return;
  const t = entry.tip(Number(hit.dataset.i)), tip = $('#tip');
  const svg = hit.ownerSVGElement, x = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2;
  const xh = svg.querySelector('.xhair'); if (xh) { xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible'); }
  tip.replaceChildren();
  const head = document.createElement('div'); head.className = 'muted'; head.textContent = t.title; tip.append(head);
  for (const r of t.rows) {
    const row = document.createElement('div'); row.className = 'tiprow';
    const key = document.createElement('i'); key.className = r.line ? 'tipkey line' : 'tipkey'; key.style.background = r.color; // CSSOM, allowed by the CSP
    const v = document.createElement('b'); v.textContent = r.value;
    const n = document.createElement('span'); n.textContent = r.name;
    row.append(key, v, n); tip.append(row);
  }
  const box = svg.getBoundingClientRect(), vbw = svg.viewBox.baseVal.width || 640;
  tip.style.left = `${Math.min(window.innerWidth - 220, box.left + (x / vbw) * box.width + 12)}px`;
  tip.style.top = `${(evt?.clientY ?? box.top + 20) + window.scrollY - 10}px`;
  tip.hidden = false;
}
document.addEventListener('pointerover', (e) => { const h = e.target.closest?.('rect.hit'); if (h) showTip(h, e); });
document.addEventListener('pointerout', (e) => {
  const h = e.target.closest?.('rect.hit'); if (!h) return;
  $('#tip').hidden = true; h.ownerSVGElement.querySelector('.xhair')?.setAttribute('visibility', 'hidden');
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'dteam') { DORA.team = e.target.value; renderDora(); }
  if (e.target.id === 'ddays') { DORA.days = Number(e.target.value); renderDora(); }
});

// Simple or detailed dashboard, remembered in this browser. Simple is the default: most people want the answer.
const VIEW_KEY = 'houston-view';
let VIEW = (() => { try { return localStorage.getItem(VIEW_KEY) === 'detailed' ? 'detailed' : 'simple'; } catch { return 'simple'; } })();
const viewSwitch = () => `<div class="viewswitch" role="group" aria-label="Dashboard view">${[['simple', 'Simple'], ['detailed', 'Detailed']].map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${VIEW === v}" class="${VIEW === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-view]'); if (b) { VIEW = b.dataset.view; try { localStorage.setItem(VIEW_KEY, VIEW); } catch { /* private window */ } route(); return; }
  const r = e.target.closest?.('tr[data-href]'); if (r) location.hash = r.dataset.href;
});

async function overview() {
  $('#crumbs').innerHTML = '';
  if (VIEW === 'simple') {
    const [teams, dq] = await Promise.all([api('/dashboard/simple'), api('/data-quality').catch(() => [])]);
    $('#main').innerHTML = viewSwitch() + (teams.length ? simpleView(teams, dq) : '<p class="empty">No data yet. Fill .env and press Refresh now.</p>');
    return;
  }
  const [d, dq] = await Promise.all([api('/dashboard'), api('/data-quality').catch(() => [])]);
  const dqBad = dq.filter((x) => x.status !== 'ok');
  if (!d.teams?.length) return $('#main').innerHTML = '<p class="empty">No data yet. Fill .env and press Refresh now.</p>';
  const c = d.counts, cur = d.cost?.currency;
  const tile = (label, value, sub, kind) => `<div class="tile ${kind ?? ''}"><div class="k">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const AREA_COLS = [['flow', 'Flow & DORA', 'Flow'], ['quality', 'Quality', 'Quality'], ['features', 'Features', 'Features'], ['ops', 'Production & cost', 'Prod'], ['docs', 'Docs', 'Docs']];
  $('#main').innerHTML = viewSwitch() + `
    <div class="tiles">
      ${tile('Healthy', `<i class="ic green" aria-hidden="true">✓</i>${esc(c.Healthy ?? 0)}`, `of ${esc(c.teams)} teams`)}
      ${tile('Watch', `<i class="ic amber" aria-hidden="true">●</i>${esc(c.Watch ?? 0)}`, 'score 50 to 74')}
      ${tile('Needs attention', `<i class="ic red" aria-hidden="true">▲</i>${esc(c['Needs attention'] ?? 0)}`, 'score below 50')}
      ${tile('Data', d.data.stale ? '<i class="ic red" aria-hidden="true">▲</i>Stale' : '<i class="ic green" aria-hidden="true">✓</i>Fresh',
        `Updated ${esc(ago(d.data.ageHours))}${d.data.stale ? '. The nightly run has been missed' : ''}. <a href="#_data">${dqBad.length ? `${esc(dqBad.length)} data check${dqBad.length === 1 ? '' : 's'} to look at` : 'All data checks pass'}</a>`, d.data.stale || dq.some((x) => x.status === 'fail') ? 'warn' : '')}
      ${d.cost ? tile('On features', `${esc(d.cost.onFeaturesPct)}%`, `of ${money(d.cost.teamCost, cur)} team cost`) : ''}
      ${d.claudeAdoptionPct != null ? tile('Claude adoption', `${esc(d.claudeAdoptionPct)}%`, 'using Claude Code, last 30 days') : ''}
    </div>
    ${alertsPanel(d.alerts)}
    ${speedStabilityRow(d.speedStability)}
    ${dashActivity(d)}
    ${dashHeadlines(d)}
    ${dashSprints(d)}

    <div class="filters" role="group" aria-label="DORA filters">
      <label>Team <select id="dteam"><option value="all">All teams</option>${d.teams.map((t) => `<option value="${esc(t.board)}"${DORA.team === t.board ? ' selected' : ''}>${esc(t.board)}</option>`).join('')}</select></label>
      <label>Period <select id="ddays">${[7, 30, 90].map((n) => `<option value="${n}"${DORA.days === n ? ' selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
    </div>
    <h2>DORA metrics</h2>
    <div id="dora"></div>

    <h2>Teams at a glance</h2>
    <div class="card scrollx"><table class="t dash">
      <tr><th rowspan="2">Team</th><th rowspan="2">Sprint health</th><th rowspan="2">Last 6 sprints</th><th colspan="${AREA_COLS.length}" class="grp">Area scores</th>
        <th colspan="3" class="grp">DORA</th><th rowspan="2" title="Headcount gate">Gate</th>${d.claudeAdoptionPct != null ? '<th rowspan="2" class="num">Claude</th>' : ''}</tr>
      <tr>${AREA_COLS.map(([, n, short]) => `<th title="${esc(n)}">${esc(short)}</th>`).join('')}<th title="Deployment frequency">Deploys</th><th title="Lead time for changes">Lead</th><th title="Change failure rate">Fail</th></tr>
      ${d.teams.map((t) => `<tr class="row" data-go="${esc(t.board)}" title="Open ${esc(t.board)}">
        <td><b>${esc(t.board)}</b><div class="note">${esc(t.sprint)}</div></td>
        <td>${status({ score: t.score, band: t.band }, 'Sprint process')} <span class="bandtxt">${esc(t.band)}</span>
          <div class="chg ${t.change > 0 ? 'up' : t.change < 0 ? 'down' : ''}">${t.change > 0 ? '▲ +' : t.change < 0 ? '▼ ' : ''}${esc(t.change)} vs last sprint</div></td>
        <td>${trendline(t.trend)}</td>
        ${AREA_COLS.map(([k, n]) => `<td>${status(t.areas[k], n)}</td>`).join('')}
        <td>${tier(t.dora.deploy_frequency, 'Deployment frequency, per week')}</td><td>${tier(t.dora.lead_time, 'Lead time for changes')}</td><td>${tier(t.dora.change_failure, 'Change failure rate')}</td>
        <td title="Headcount gate">${t.headcountGateOpen ? '<span class="st green"><i aria-hidden="true">✓</i>Open</span>' : '<span class="st none">Closed</span>'}</td>
        ${d.claudeAdoptionPct != null ? `<td class="num">${t.claudeAdoptionPct == null ? '·' : esc(t.claudeAdoptionPct) + '%'}</td>` : ''}
      </tr>`).join('')}
    </table>
    <p class="note legend"><span class="st green"><i>✓</i></span> Healthy 75+ · <span class="st amber"><i>●</i></span> Watch 50 to 74 · <span class="st red"><i>▲</i></span> Needs attention below 50 · DORA tiers from the State of DevOps research. Click a team for detail.</p></div>

    ${dashProjects(d)}
    ${d.attention.length ? `<h2>Where effort moves scores most</h2>
    <div class="card"><table class="t">
      <tr><th class="num">Gain</th><th>Team</th><th>Check</th><th>Area</th></tr>
      ${d.attention.map((g) => `<tr class="row" data-go="${esc(g.board)}"><td class="num"><b>+${esc(g.gain)}</b></td><td>${esc(g.board)}</td><td>${esc(g.title)}</td><td>${esc(g.area)}</td></tr>`).join('')}
    </table><p class="note">Points each check would add to its area score if it went green, across all teams.</p></div>` : ''}`;
  renderDora();
  sizeBars();
}

const finding = (board, f) => `
  <div class="finding ${cls(f.rag)}">
    <div class="row"><span class="title">${esc(f.title)}${doraTier(METRICS[f.ruleId], f.value) ? ` <span class="tier">DORA ${esc(doraTier(METRICS[f.ruleId], f.value))}</span>` : ''}</span><span class="val">${esc(f.unit === '%' ? Math.round(f.value) + '%' : f.value)}${f.unit === 'days' ? 'd' : ''}</span></div>
    <p class="msg">${esc(f.message)}</p>
    ${f.rag !== 'green' ? `<p class="act">${esc(f.action)}</p>` : ''}
    ${f.evidence.length ? `<details><summary>${f.evidence.length} records</summary>${f.evidence.map((k) => `<code>${esc(k)}</code>`).join('')} <a href="/api/teams/${encodeURIComponent(board)}/evidence/${encodeURIComponent(f.ruleId)}" target="_blank" rel="noopener">raw evidence</a></details>` : ''}
  ${METRICS[f.ruleId] ? `<details class="about"><summary>What is this?</summary>${about(METRICS[f.ruleId])}</details>` : ''}
  </div>`;

async function team(board, tab) {
  const [d, p, r, cost, hist, ai, cs] = await Promise.all([api('/teams/' + encodeURIComponent(board)), api('/teams/' + encodeURIComponent(board) + '/people').catch(() => ({ people: [], github: [], docs: [] })), api('/teams/' + encodeURIComponent(board) + '/recommendations'), api('/teams/' + encodeURIComponent(board) + '/costs').catch(() => null), api('/teams/' + encodeURIComponent(board) + '/history').catch(() => null), api('/teams/' + encodeURIComponent(board) + '/claude').catch(() => null), api('/sprints/current?team=' + encodeURIComponent(board)).catch(() => null)]);
  const { latest, history, quality, flow, docs, features, ops, actions, insights, heatmap, window: win, output, incidents } = d;
  const trend = [...history].sort((a, b) => a.sprintId - b.sprintId).map((c) => ({ sprint: c.sprintName, score: c.score, rag: c.rag }));
  const tabs = [['overview', 'Overview'], cs && !cs.error && ['now', 'Current sprint'], ['sprint', 'Sprint checks'], flow && ['flow', 'Flow & DORA'], quality && ['quality', 'Quality'], features && ['features', 'Features'], ops && ['prod', 'Production & cost'], docs && ['docs', 'Docs'], ai?.configured && ['claude', 'Claude'], p.people?.length && ['people', 'People']].filter(Boolean);
  $('#crumbs').innerHTML = `<a href="#" data-go="">All teams</a><a class="on">${esc(board)}</a>`;
  const big = (n, label, sub) => n == null ? '' : `<div class="bigscore"><span class="n ${rag(n)}">${esc(n)}</span><span class="l"><b>${esc(label)}</b><span class="band ${rag(n)}">${bandOf(n)}</span>${esc(sub)}</span></div>`;
  // What moves the scores: points each check would add to its area score if it went green, biggest first.
  const areas = [['Sprint process', latest], ['Flow & DORA', flow], ['Quality', quality], ['Features', features], ['Production & cost', ops], ['Docs', docs]].filter(([, a]) => a);
  const gains = areas.flatMap(([name, a]) => {
    const possible = a.findings.reduce((t, f) => t + (f.weight ?? 0), 0);
    return possible ? a.findings.filter((f) => f.rag !== 'green' && f.weight).map((f) => ({ name, f, gain: Math.round((f.weight * (f.rag === 'amber' ? 0.5 : 1) / possible) * 100) })) : [];
  }).sort((x, y) => y.gain - x.gain).slice(0, 6);
  // History: sprint scores kept beyond Jira's window, and area scores by day.
  const hsprints = (hist?.sprints ?? []).map((s) => ({ sprint: s.sprintName, score: s.score, rag: s.rag }));
  const longTrend = hsprints.length > trend.length ? hsprints : trend;
  const areaAt = (area, daysAgo) => {
    const target = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const rows = (hist?.areas ?? []).filter((x) => x.area === area && x.day <= target);
    return rows.length ? rows[rows.length - 1].score : null;
  };
  const AREA_NAMES = { sprint: 'Sprint process', flow: 'Flow & DORA', quality: 'Quality', features: 'Features', ops: 'Production & cost', docs: 'Docs' };
  const rec = (x, i) => { const a = (actions || []).filter((y) => y.recId === x.id).sort((y, z) => z.at.localeCompare(y.at))[0]; return `
    <div class="rec"><div class="row"><span class="title">${i + 1}. ${esc(x.title)}</span><span class="meta">${esc(x.owner)} · ${esc(x.horizon.toLowerCase())}</span></div>
      <p class="msg">${esc(x.why)}</p><ol>${x.what.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <div class="status">${a ? `${esc(a.status)} by ${esc(a.owner)} on ${esc(String(a.at).slice(0, 10))}${a.note ? ': ' + esc(a.note) : ''}` :
        ['accepted', 'done', 'rejected'].map((st, j) => `<a href="#" data-act="${st}" data-board="${esc(board)}" data-rec="${esc(x.id)}">${['Accept', 'Mark done', 'Reject'][j]}</a>`).join(' · ')}</div>
    </div>`; };
  const gate = r.headcountGate;
  const content = {
    overview: () => `
      <div class="hero">
        <div class="card">
          <div class="bigscores">
            ${big(latest.score, 'Sprint process', latest.sprintName)}${big(flow?.score, 'Flow & DORA', 'GitHub, 90 days')}${big(quality?.score, 'Quality', 'Sonar, Testmo, Jira')}
            ${big(features?.score, 'Features', 'Jira epics')}${big(ops?.score, 'Production & cost', 'Azure')}${big(docs?.score, 'Docs', 'Confluence')}
          </div>
          ${spark(longTrend, 600, 60)}
          <p class="note">Sprint score, ${esc(longTrend[0]?.sprint)} to ${esc(longTrend[longTrend.length - 1]?.sprint)}.</p>
        </div>
        <div class="card"><h2>Since last sprint</h2>${(insights || []).length ? insights.map((i) => `<div class="insight"><span class="dot ${i.kind}"></span><span>${esc(i.text)}</span></div>`).join('') : '<p class="note">Need two sprints for a comparison.</p>'}</div>
      </div>
      ${gains.length ? `<h2>What moves the scores</h2>
      <div class="card"><table class="t"><tr><th class="num">Gain</th><th>Check</th><th>Area</th><th class="num">Now</th></tr>
        ${gains.map((g) => `<tr><td class="num"><b>+${esc(g.gain)}</b></td><td>${esc(g.f.title)}</td><td>${esc(g.name)}</td><td class="num">${esc(g.f.unit === '%' ? Math.round(g.f.value) + '%' : g.f.value)}</td></tr>`).join('')}</table>
        <p class="note">Points each check would add to its area score if it went green. Start at the top.</p></div>` : ''}
      ${hist?.firstDay ? `<h2>Over time</h2>
      <div class="card"><table class="t"><tr><th>Area</th><th class="num">Now</th><th class="num">30 days ago</th><th class="num">90 days ago</th></tr>
        ${Object.entries(AREA_NAMES).filter(([k]) => areaAt(k, 0) != null).map(([k, name]) => `<tr><td>${esc(name)}</td>${[0, 30, 90].map((d) => `<td class="num">${areaAt(k, d) == null ? '·' : `<span class="${rag(areaAt(k, d))}-text">${esc(Math.round(areaAt(k, d)))}</span>`}</td>`).join('')}</tr>`).join('')}</table>
        <p class="note">History kept since ${esc(hist.firstDay)}. Earlier columns fill in as nightly runs add up.</p></div>` : ''}
      ${win ? `<h2>90 day window</h2>
      <div class="rec gate ${win.onTrack ? 'open' : ''}"><p class="msg">${esc(win.verdict)}</p>
        <table class="t mt"><tr><th>Target</th><th>Goal</th><th class="num">At start</th><th class="num">Now</th><th>Met</th></tr>
        ${win.targets.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.target)}</td><td class="num">${esc(t.start ?? '·')}</td><td class="num">${esc(t.now ?? '·')}</td><td class="${t.met ? '' : 'warn'}">${t.met ? 'Yes' : 'No'}</td></tr>`).join('')}</table>
        <p class="note">${esc(win.start)} to ${esc(win.end)}. Set WINDOW_START in .env. Same targets the team sees in the digest.</p></div>` : ''}
      ${output ? `<h2>Cost</h2><div class="card"><p class="msg">${esc(output.verdict)}</p>
        ${output.costRatio ? `<div class="scores mt"><span class="pill"><b>${esc(output.costRatio)}x</b> an offshore equivalent</span></div>` : ''}</div>` : ''}
      ${incidents ? `<h2>Incident log</h2><div class="finding ${incidents.missing ? 'red' : 'green'}"><p class="msg">${esc(incidents.verdict)}</p>${incidents.missing ? '<p class="act">Every Sev0 to Sev2 incident gets a post-incident page within 3 days: what happened, impact, root cause, one action. Label it "incident".</p>' : ''}</div>` : ''}
      <h2>Recommendations</h2>${r.recommendations.map(rec).join('') || '<p class="note">No gaps found.</p>'}
      <h2>Headcount gate</h2>
      <div class="rec gate ${gate.ready ? 'open' : ''}"><p class="msg"><b>${gate.ready ? 'Open' : 'Closed'}.</b> ${esc(gate.verdict)}</p>
        <table class="t mt"><tr><th>Condition</th><th>Target</th><th>Actual</th><th>Met</th></tr>
        ${gate.criteria.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.target)}</td><td>${esc(x.actual)}</td><td class="${x.met ? '' : 'warn'}">${x.met ? 'Yes' : 'No'}</td></tr>`).join('')}</table></div>
      <h2>Every check, every sprint</h2>
      <div class="card scrollx"><table class="heat"><tr><th></th>${heatmap.sprints.map((s) => `<th class="s">${esc(s)}</th>`).join('')}</tr>
        ${heatmap.rows.map((row) => `<tr><th>${esc(row.title)}</th>${row.cells.map((c) => c ? `<td class="${cls(c.rag)}" title="${esc(row.title)}: ${esc(c.value)}">${esc(c.value)}</td>` : '<td class="none">·</td>').join('')}</tr>`).join('')}</table>
        <p class="note">A row that is red across the board is structural. A row that just turned red is new.</p></div>`,
    sprint: () => `<h2>${esc(latest.sprintName)}</h2>${latest.findings.map((f) => finding(board, f)).join('')}`,
    flow: () => `<h2>Flow & DORA, GitHub, ${esc(flow.since.slice(0, 10))} to ${esc(flow.until.slice(0, 10))}</h2>${flow.findings.map((f) => finding(board, f)).join('')}`,
    quality: () => `<h2>Quality</h2>${quality.findings.map((f) => finding(board, f)).join('')}`,
    features: () => `<h2>Features, from Jira epics</h2>${features.findings.map((f) => finding(board, f)).join('')}${costSection(cost)}`,
    prod: () => `<h2>Production & cost, Azure</h2>${ops.findings.map((f) => finding(board, f)).join('')}`,
    docs: () => `<h2>Documentation, Confluence</h2>${docs.findings.map((f) => finding(board, f)).join('')}`,
    now: () => sprintBoard(cs),
    claude: () => claudeSection(ai),
    people: () => `
      <h2>Jira, last ${p.people[0]?.sprints ?? 0} sprints</h2>
      <table class="t"><tr><th>Name</th><th class="num">Done</th><th class="num">Points</th><th class="num">Median days</th><th class="num">Over norm</th><th class="num">Stuck now</th><th class="num">Carried</th></tr>
      ${p.people.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${esc(x.ticketsDone)}</td><td class="num">${esc(x.pointsDone)}</td><td class="num ${x.medianCycleDays > x.teamMedianCycleDays * 1.5 ? 'warn' : ''}">${esc(x.medianCycleDays)}</td><td class="num ${x.overBand >= 3 ? 'warn' : ''}">${esc(x.overBand)}</td><td class="num ${x.stuckNow ? 'warn' : ''}">${esc(x.stuckNow)}</td><td class="num">${esc(x.carriedOver)}</td></tr>`).join('')}</table>
      <p class="note">Team median ${p.people[0]?.teamMedianCycleDays} days. Norm by size: ${Object.entries(p.baseline || {}).map(([k, v]) => `${esc(k)} pt ${esc(v)}d`).join(', ')}.</p>
      ${p.github?.length ? `<h2>GitHub, last 90 days</h2>
      <table class="t"><tr><th>Name</th><th class="num">PRs</th><th class="num">Merged</th><th class="num">Lines</th><th class="num">Median PR</th><th class="num">Reviews</th><th class="num">Review %</th><th>Lanes</th><th>Flags</th></tr>
      ${p.github.map((x) => `<tr><td>${esc(x.name)}</td><td class="num ${x.prsAuthored === 0 ? 'warn' : ''}">${esc(x.prsAuthored)}</td><td class="num">${esc(x.prsMerged)}</td><td class="num">${esc(x.linesChanged.toLocaleString())}</td><td class="num ${x.medianPrSize > 800 ? 'warn' : ''}">${esc(x.medianPrSize)}</td><td class="num">${esc(x.reviewsGiven)}</td><td class="num ${x.reviewShare >= 40 ? 'warn' : ''}">${esc(x.reviewShare)}%</td><td>${esc(x.lanes.filter((l) => l !== 'other').join(', ') || 'none')}</td><td class="${x.flags.length ? 'warn' : ''}">${esc(x.flags.join(' '))}</td></tr>`).join('')}</table>` : ''}
      ${p.docs?.length ? `<h2>Confluence, last 90 days</h2>
      <table class="t"><tr><th>Name</th><th class="num">Created</th><th class="num">Edited</th><th class="num">ADRs</th><th class="num">Runbooks</th><th>Last</th></tr>
      ${p.docs.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${esc(x.created)}</td><td class="num">${esc(x.edited)}</td><td class="num">${esc(x.adrs)}</td><td class="num">${esc(x.runbooks)}</td><td>${x.last ? esc(String(x.last).slice(0, 10)) : ''}</td></tr>`).join('')}</table>` : ''}
      ${p.activity?.length ? `<h2>Active days, last 6 weeks</h2>
      <table class="t"><tr><th>Name</th><th class="num">Active days / week</th><th class="num">Weekdays with a trace</th><th>Pattern</th><th>Last active</th></tr>
      ${p.activity.map((x) => `<tr><td>${esc(x.name)}</td><td class="num ${x.activeDaysPerWeek < 3 ? 'warn' : ''}">${esc(x.activeDaysPerWeek)}</td><td class="num">${esc(x.weekdaysCovered)} of ${esc(x.weekdaysInWindow)}</td><td>${esc(x.pattern)}</td><td>${esc(x.lastActive ?? '')}</td></tr>`).join('')}</table>
      <p class="note">A day counts if any Jira transition or GitHub action left a trace. This is not attendance and not hours. Someone can be in the office all day with no trace, or at home with ten. Use it to ask, never to conclude.</p>` : ''}
      <p class="note">Questions to ask, not verdicts. Absence in a tool is proof of no trace, not of no work.</p>`,
  };
  $('#main').innerHTML = `
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#" class="${k === tab ? 'on' : ''}" data-go="${esc(board)}" data-tab="${esc(k)}">${esc(l)}</a>`).join('')}</div>
    ${(content[tab] || content.overview)()}`;
  sizeBars();
  window.scrollTo(0, 0);
}

// Cost to build each feature: spent so far, split FTE and contractor, and an estimate to complete.
function costSection(c) {
  if (!c) return '';
  if (!c.configured) return `<h2>Cost to build</h2><p class="note">${esc(c.reason)}</p>`;
  const cur = c.currency, pct = (x) => c.teamCost ? Math.round((x / c.teamCost) * 100) : 0;
  return `<h2>Cost to build</h2>
    <div class="card">
      <div class="scores">
        <span class="pill"><b>${money(c.teamCost, cur)}</b> team cost, last ${esc(c.sprints)} sprints</span>
        <span class="pill"><b>${pct(c.onFeatures)}%</b> on features</span>
        <span class="pill ${pct(c.noFeature + c.notOnTickets) > 40 ? 'amber' : ''}"><b>${pct(c.noFeature + c.notOnTickets)}%</b> not on features</span>
        ${c.costPerPoint != null ? `<span class="pill"><b>${money(c.costPerPoint, cur)}</b> per point</span>` : ''}
        <span class="pill"><b>${esc(c.fteShare)}%</b> FTE, ${esc(Math.round((100 - c.fteShare) * 10) / 10)}% contractor</span>
        ${c.aiCost ? `<span class="pill"><b>${money(c.aiCost, cur)}</b> Claude seats, included</span>` : ''}
      </div>
      <p class="note">Not on features: ${money(c.noFeature, cur)} on tickets with no epic (bugs, support, unplanned), ${money(c.notOnTickets, cur)} for people with no ticket in a sprint.</p>
    </div>
    <div class="card scrollx mt"><table class="t">
      <tr><th>Feature</th><th>Status</th><th class="num">Spent</th><th class="num">FTE</th><th class="num">Contractor</th><th class="num">Points left</th><th class="num">To complete</th><th class="num">Estimated total</th></tr>
      ${c.features.map((x) => `<tr><td>${esc(x.key)} ${esc(x.summary)}</td><td>${esc(x.status === 'done' ? 'Done' : x.status === 'inprogress' ? 'In progress' : 'Not started')}</td>
        <td class="num">${money(x.spent, cur)}</td><td class="num">${money(x.fte, cur)}</td><td class="num">${money(x.contractor, cur)}</td>
        <td class="num">${esc(x.pointsRemaining)}${x.remainingEstimated ? '*' : ''}</td><td class="num">${x.toComplete ? money(x.toComplete, cur) : '·'}</td><td class="num"><b>${money(x.total, cur)}</b></td></tr>`).join('')}
    </table>
    <p class="note">* includes items with no estimate or not yet in a sprint, sized at the team's median ticket.
    ${c.rates ? `Rates: FTE ${money(c.rates.fteDay, cur)} a day, contractor ${money(c.rates.contractorDay, cur)} a day, ${esc(c.rates.contractors)} contractors${c.rates.overrides ? `, ${esc(c.rates.overrides)} individual rates` : ''}.` : 'Rates are visible to people viewers.'}</p></div>
    <details class="about card mt"><summary>How this is estimated</summary>${about(METRICS.feature_cost)}${about(METRICS.cost_off_features)}</details>`;
}

// Claude: seats and cost for everyone, usage when telemetry is connected, per person for people viewers.
function claudeSection(c) {
  const cur = c.currency, n = (x) => Number(x).toLocaleString();
  const usage = c.usageConnected ? `
    <div class="scores mt">
      <span class="pill ${c.adoptionPct >= 70 ? 'green' : c.adoptionPct >= 40 ? 'amber' : 'red'}"><b>${esc(c.adoptionPct)}%</b> using Claude Code (${esc(c.activeUsers)} of ${esc(c.rosterSize)})</span>
      <span class="pill"><b>${esc(c.medianActiveDays)}</b> median active days in ${esc(c.days)}</span>
      ${c.acceptanceRate != null ? `<span class="pill"><b>${esc(c.acceptanceRate)}%</b> edits accepted</span>` : ''}
    </div>
    <table class="t mt"><tr><th class="num">Sessions</th><th class="num">Lines added</th><th class="num">Lines removed</th><th class="num">Commits</th><th class="num">PRs</th><th class="num">API-equivalent value</th></tr>
      <tr><td class="num">${n(c.sessions)}</td><td class="num">${n(c.linesAdded)}</td><td class="num">${n(c.linesRemoved)}</td><td class="num">${n(c.commits)}</td><td class="num">${n(c.pullRequests)}</td><td class="num">${money(c.apiEquivalent, cur)}</td></tr></table>
    <p class="note">Last ${esc(c.days)} days, through Claude Code only. API-equivalent value is what the tokens would cost at API prices; on a seat plan it is not billed.</p>`
    : '<p class="note mt">Usage is not connected yet. See CLAUDE_USAGE.md to send Claude Code\'s metrics to Application Insights and set CLAUDE_OTEL_APPINSIGHTS.</p>';
  const people = c.people ? `<h2>Per person, last ${esc(c.days)} days</h2>
    <div class="card scrollx"><table class="t"><tr><th>Name</th><th class="num">Active days</th><th class="num">Sessions</th><th class="num">Hours</th><th class="num">Lines added</th><th class="num">Commits</th><th class="num">PRs</th><th class="num">Accepted</th><th class="num">API-equivalent</th></tr>
      ${c.people.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${esc(x.activeDays)}</td><td class="num">${esc(x.sessions)}</td><td class="num">${esc(x.activeHours)}</td><td class="num">${n(x.linesAdded)}</td><td class="num">${esc(x.commits)}</td><td class="num">${esc(x.pullRequests)}</td>
        <td class="num">${x.editsAccepted + x.editsRejected ? esc(Math.round((x.editsAccepted / (x.editsAccepted + x.editsRejected)) * 100)) + '%' : '·'}</td><td class="num">${money(x.apiEquivalent, cur)}</td></tr>`).join('')}</table>
      ${c.notUsing?.length ? `<p class="note">No Claude Code activity in ${esc(c.days)} days: ${esc(c.notUsing.join(', '))}. A question to ask, not a verdict.</p>` : ''}</div>` : '';
  return `<h2>Claude</h2>
    <div class="card"><div class="scores">
      <span class="pill"><b>${esc(c.seats)}</b> seats</span>
      <span class="pill"><b>${money(c.seatCostMonthly, cur)}</b> a month</span>
    </div>${usage}</div>
    ${people}
    <details class="about card mt"><summary>How this is measured</summary>${['claude_seat_cost', 'claude_adoption', 'claude_acceptance', 'claude_api_equivalent'].map((id) => `<p><b>${esc(METRICS[id]?.name)}.</b></p>${about(METRICS[id])}`).join('')}</details>`;
}

// Every metric, grouped by area: what it is, why it matters, how it is calculated.
function metricsPage() {
  $('#crumbs').innerHTML = `<a href="#" data-go="">All teams</a><a class="on">Metrics</a>`;
  const list = Object.values(METRICS);
  const areas = [...new Set(list.map((m) => m.area))];
  $('#main').innerHTML = `<h2>What Houston measures</h2>
    <p class="note">Every number is computed from these definitions and nothing else. Each finding also has a "What is this?" link. Full formulas in METRICS.md.</p>
    ${areas.map((a) => `<h2>${esc(a)}</h2>${list.filter((m) => m.area === a).map((m) => `
      <details class="card metric mt" id="m-${esc(m.id)}"><summary><b>${esc(m.name)}</b> <span class="note">${esc(m.why.split('. ')[0])}.</span></summary>${about(m)}</details>`).join('')}`).join('')}`;
  window.scrollTo(0, 0);
}

async function act(board, recId, status) {
  const owner = prompt('Your name for the action log:'); if (!owner) return;
  const note = prompt('Note (optional):') || '';
  const res = await post('/teams/' + encodeURIComponent(board) + '/actions', { recId, status, owner, note });
  if (!res.ok) alert('Could not save: ' + (await res.json().catch(() => ({}))).error);
  route();
}
$('#refresh').addEventListener('click', async () => { $('#refresh').textContent = 'Refreshing'; await post('/refresh'); $('#refresh').textContent = 'Refresh now'; route(); });
// One listener for every link and card, instead of inline onclick handlers (which a strict CSP blocks).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.act) act(el.dataset.board, el.dataset.rec, el.dataset.act);
  else go(el.dataset.go, el.dataset.tab);
});

// Footer: which build this is. "Build 42 · a1b2c3d · 27 Sep 2026, 15:02" from CI, "Local build" when run from a checkout.
fetch('/api/version').then((r) => r.ok ? r.json() : null).then((v) => {
  if (!v) return;
  const when = v.builtAt ? new Date(v.builtAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const parts = [`Houston ${v.version}`, v.build ? `build ${v.build}` : 'local build', v.commit && `${v.commit}${v.dirty ? ' + uncommitted changes' : ''}`, when].filter(Boolean);
  $('#version').textContent = parts.join(' · ');
  if (v.builtAt) $('#version').title = `Built ${v.builtAt}`;
}).catch(() => {});

// Data checks: the ways a correct formula could still give a wrong number on this data, and what each affects.
async function dataPage() {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">Data checks</a>`;
  const dq = await api('/data-quality');
  const icon = { ok: ['green', '✓', 'OK'], warn: ['amber', '●', 'Check'], fail: ['red', '▲', 'Wrong'] };
  $('#main').innerHTML = `<h2 class="big">Data checks</h2>
    <p class="muted">Every measure is only as right as the data behind it. These checks look at what the last collect found: a field id that matches nothing, a deploy workflow with no runs, bots doing the reviewing. Fix anything marked Wrong or Check, then collect again.</p>
    <div class="card scrollx"><table class="t"><tr><th>Status</th><th>Source</th><th>Check</th><th>Finding</th><th>Affects</th></tr>
    ${dq.map((c) => `<tr><td><span class="st ${icon[c.status][0]}"><i aria-hidden="true">${icon[c.status][1]}</i>${icon[c.status][2]}</span></td><td>${esc(c.area)}</td><td>${esc(c.check)}</td><td>${esc(c.detail)}</td><td class="muted">${esc(c.affects.join(', '))}</td></tr>`).join('')}
    </table></div>`;
  window.scrollTo(0, 0);
}
