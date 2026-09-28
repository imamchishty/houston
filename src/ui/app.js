const $ = (s) => document.querySelector(s);
// Every value from the API goes through esc(), including ones that look internal. Safe in text and quoted attributes.
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;' }[c]));
// POSTs carry this header; the server rejects POSTs without it, which blocks cross-site form posts.
const post = (p, body) => fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'houston' }, body: JSON.stringify(body ?? {}) });
const api = (p) => fetch('/api' + p).then((r) => r.json());
// What each measure means and how it is calculated, from /api/metrics. Loaded once, used by every page.
let METRICS = {};
const metricsReady = api('/metrics').then((list) => { METRICS = Object.fromEntries(list.map((m) => [m.id, m])); }).catch(() => {});
const doraTier = (m, v) => m?.dora?.find((b) => (b.min != null ? v >= b.min : b.max != null ? v <= b.max : true))?.tier;
const TIER_CLS = { Elite: 'green', High: 'green', Medium: 'amber', Low: 'red' };
const CHARTS = new Map(); // chart id -> tip(i), for the hover readout
const ago = (h) => h == null ? 'never' : h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
const TEAMF = { days: 30 };

function go(board, tab) { location.hash = board ? `#${encodeURIComponent(board)}${tab ? '/' + tab : ''}` : ''; }
window.addEventListener('hashchange', route); route();

// Pages: the dashboard, a team (or all teams), the monthly report; Metrics, Data checks and Admin from the footer.
async function route() {
  await metricsReady; await chatReady;
  CHARTS.clear(); $('#tip').hidden = true; // hover readouts belong to the page being left
  document.querySelectorAll('.navlink').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === (location.hash || '#') || (a.getAttribute('href') === '#' && !location.hash.startsWith('#_'))));
  if (location.hash === '#_metrics') return metricsPage();
  if (location.hash === '#_data') return dataPage();
  if (location.hash === '#_monthly') return monthlyPage((await api('/teams')).map((t) => t.board));
  const adm = location.hash.match(/^#_admin(?:\/(allocation|tests|connections|teams|settings|log))?$/);
  if (adm) return adminPage(adm[1] ?? 'allocation');
  const [board, tab] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (!board) return overview();
  return team(board, tab);
}

// Ask Houston: one box, on the dashboard (all teams) and each team page (that team). Shown only when Compass is set.
let CHAT = null; const chatReady = api('/chat').then((c) => { CHAT = c; }).catch(() => {});
const askBox = (team) => !CHAT?.enabled ? '' : `<form class="card askbox" data-team="${esc(team)}"><label for="askq"><b>Ask Houston</b> <span class="muted small">about ${team === 'all' ? 'all teams' : esc(team)}, answered from the numbers here. Not about people.</span></label>
  <div class="askrow"><input id="askq" name="q" maxlength="500" placeholder="Why did lead time go up? Which team has the most blocked work? What is flow efficiency?" autocomplete="off"><button type="submit" class="btn primary">Ask</button></div>
  <div class="askout" aria-live="polite"></div></form>`;
document.addEventListener('submit', async (e) => {
  const f = e.target.closest?.('form.askbox'); if (!f) return;
  e.preventDefault();
  const q = f.q.value.trim(); if (!q) return;
  const out = f.querySelector('.askout'); out.innerHTML = '<p class="muted">Asking…</p>'; f.querySelector('button').disabled = true;
  try {
    const r = await post('/chat', { question: q, team: f.dataset.team }); const a = await r.json();
    if (!r.ok) { out.innerHTML = `<p class="warnbox">${esc(a.error ?? 'Could not answer')}</p>`; return; }
    out.innerHTML = `<div class="answer">${a.answer.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${a.basedOn?.length ? `<p class="note">Based on: ${a.basedOn.map((b) => `<a href="${esc(b.href)}">${esc(b.title)}</a>`).join(' · ')}${a.fromFacts ? ' · shown as Houston\'s own words because the written answer did not match the numbers' : ''}</p>` : ''}`;
  } catch { out.innerHTML = '<p class="warnbox">Could not reach Houston.</p>'; }
  finally { f.querySelector('button').disabled = false; }
});
// A note line: plain text with **bold** as the only markup. Everything else is escaped.
const noteLine = (l) => l.split('**').map((part, i) => (i % 2 ? `<b>${esc(part)}</b>` : esc(part))).join('');
// A score: the share of headline targets met, with its trend. Colour never carries the meaning alone.
const scoreCls = (p) => (p == null ? 'none' : p >= 75 ? 'green' : p >= 50 ? 'amber' : 'red');
const scoreChip = (s, big = false) => s.pct == null ? '<span class="st none">·</span>'
  : `<span class="score ${scoreCls(s.pct)}${big ? ' big' : ''}" title="${esc(s.met)} of ${esc(s.of)} headline targets met">${esc(s.pct)}%</span>`;
const scoreTrend = (s) => s.previousPct == null ? '' : s.trend === 'better' ? `<span class="up">↑ from ${esc(s.previousPct)}%</span>` : s.trend === 'worse' ? `<span class="down">↓ from ${esc(s.previousPct)}%</span>` : '<span class="muted">no change</span>';
// Short names for the dashboard cards, so each measure fits on one line.
const SHORT = { deploy_frequency: 'Deploys per week', lead_time: 'Lead time', sprint_completion: 'Sprint completion', defect_leakage: 'Bugs reaching customers',
  bug_workload: 'Time on bugs', change_failure_rate: 'Changes that fail', time_to_restore: 'Time to restore', sla_resolution: 'Support within SLA',
  flow_efficiency: 'Flow efficiency', security_on_time: 'Security fixed on time' };
// One measure as a line: name on the left; status icon, value and trend on the right. Hover for target and counts.
const line = (m) => {
  const judged = m.met != null && !m.smallSample, cls = !judged ? 'none' : m.met ? 'green' : 'red';
  const tip = `${METRICS[m.id]?.name ?? m.title}: ${countsText(m).replace(/<[^>]+>/g, '')}. ${targetText(m.target, m)}${m.smallSample ? '. Too few items to judge, not scored' : ''}${m.previous != null ? `. Previous 30 days: ${chartFmt(m.previous)}${unitOf(m)}` : ''}`;
  return `<li title="${esc(tip)}"><span class="ln">${esc(SHORT[m.id] ?? m.title)}</span>
    <span class="lv"><span class="st ${cls}"><i aria-hidden="true">${!judged ? '·' : m.met ? '✓' : '▲'}</i>${m.value == null ? '—' : `${esc(chartFmt(m.value))}${esc(unitOf(m))}`}</span>${m.trend === 'better' ? '<span class="up" aria-label="better">↑</span>' : m.trend === 'worse' ? '<span class="down" aria-label="worse">↓</span>' : '<span class="tr"></span>'}</span></li>`;
};
// A team as a card: score and trend, one plain sentence, then its measures by area. The whole card opens the team.
function teamCard(t, areas, all = false) {
  const by = Object.fromEntries(t.measures.map((m) => [m.id, m]));
  return `<a class="card teamcard${all ? ' allcard' : ''}" href="#${esc(encodeURIComponent(t.board))}">
    <div class="tchead"><h3>${all ? 'All teams' : esc(t.board)}</h3><span>${scoreChip(t.score)} <span class="small">${scoreTrend(t.score)}</span></span></div>
    <p class="muted small tcsum">${esc(t.summary)}</p>
    ${t.sprint ? `<p class="small tcsprint">${esc(t.sprint.name)}: ${outlookChip(t.sprint.outlook)} · ${esc(t.sprint.workingDaysLeft)} working days left</p>` : ''}
    <div class="tcareas">${areas.map((a) => { const ms = a.headlines.map((id) => by[id]).filter(Boolean);
      return ms.length ? `<div class="tcarea"><div class="tcat">${esc(a.title)}</div><ul class="lines">${ms.map(line).join('')}</ul></div>` : ''; }).join('')}</div>
  </a>`;
}

// Home page: all teams together first, then every team as a card (alphabetical), and what needs attention.
async function overview() {
  $('#crumbs').innerHTML = '';
  const d = await api('/dashboard');
  $('#main').innerHTML = `
    <div class="rephead"><div><h2 class="big">How teams are performing</h2><p class="muted">Last 30 days. The score is the share of headline targets met. ✓ met · ▲ missed · ↑ better or ↓ worse than the 30 days before · grey: too few items to judge. Click a team for what is behind each number.</p></div>
      <div class="tile${d.data.stale ? ' warn' : ''}"><div class="k">Data</div><div class="v small">${d.data.stale ? '▲ Stale' : '✓ Fresh'}</div><div class="s">Collected ${esc(ago(d.data.ageHours))} · <a href="#_data">data checks</a></div></div></div>
    ${askBox('all')}
    ${d.attention.length ? `<div class="card attention"><h3>Needs attention <span class="muted small">missed its target two periods running</span></h3><ul>${d.attention.map((a) => `<li><a href="#${esc(encodeURIComponent(a.board))}"><b>${esc(a.board)}</b></a> · ${esc(SHORT[a.id] ?? a.title)}: ${esc(chartFmt(a.value))}${esc(unitOf(a))} <span class="muted">(${esc(targetText(a.target, a))})</span></li>`).join('')}</ul></div>` : ''}
    ${d.all ? `<div class="teamcards all">${teamCard(d.all, d.areas, true)}</div>` : ''}
    <div class="teamcards">${d.teams.map((t) => teamCard(t, d.areas)).join('')}</div>
    <p class="note">All teams together first, then each team in alphabetical order. Hover a measure for its target and counts.</p>`;
  window.scrollTo(0, 0);
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

// A team (or "all"): the score and its trend, what missed its target, then each area with its headlines. Under each
// headline, what drives it: the drill-down measures and charts. The current sprint board is one click away.
async function team(board, tab) {
  const label = board === 'all' ? 'All teams' : board;
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">${esc(label)}</a>`;
  if (tab === 'sprint') return sprintPage(board);
  const [p, hist, cs, note] = await Promise.all([api(`/teams/${encodeURIComponent(board)}?days=${TEAMF.days}`), api(`/teams/${encodeURIComponent(board)}/history?days=180`).catch(() => null),
    board === 'all' ? null : api(`/sprints/current?team=${encodeURIComponent(board)}`).catch(() => null), api(`/teams/${encodeURIComponent(board)}/note`).catch(() => null)]);
  if (!p.areas) { $('#main').innerHTML = `<p class="empty">${esc(p.error ?? `No team called ${board}.`)}</p>`; return; }
  const scores = hist?.series?.score ?? [];
  $('#main').innerHTML = `
    <div class="rephead"><div><h2 class="big">${esc(label)}</h2>${note?.lines ? '' : `<p class="lead">${esc(p.summary)}</p>`}
      <div class="filters" role="group" aria-label="Period"><label>Period <select data-teamdays>${[7, 30, 90].map((n) => `<option value="${n}"${TEAMF.days === n ? ' selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
      ${board === 'all' ? '' : `<a class="btnlink" href="#${esc(encodeURIComponent(board))}/sprint">Current sprint →</a>`}</div></div>
      <div class="tile"><div class="k">Targets met</div><div class="v">${scoreChip(p.score, true)}</div><div class="s">${esc(p.score.met)} of ${esc(p.score.of)} headline targets · ${scoreTrend(p.score)}</div></div></div>
    ${askBox(board)}
    ${note?.lines ? `<div class="card note mt"><h3>This week <span class="muted small">what changed, what moved with it, what is likely next</span></h3>${note.lines.map((l) => `<p>${noteLine(l)}</p>`).join('')}<p class="note">Written by Houston from the numbers below${note.polished ? ', worded by Compass (every number checked against Houston\'s own text)' : ''}, every Friday to Teams too. It names measures, never people.</p></div>` : ''}
    ${scores.length > 1 ? `<div class="card mt"><h3>Score over time</h3>${lineChart('score', { labels: scores.map((x) => x.day), xLabel: (d) => shortDate(d), unit: '%', W: 900, H: 160, whole: true, series: [{ name: 'Targets met', key: 'series', values: scores.map((x) => x.value), dots: scores.length < 40 }] })}</div>` : ''}
    ${p.missed.length ? `<div class="card attention mt"><h3>Missed targets, worst first</h3><ul>${p.missed.map((m) => `<li><a href="#h-${esc(m.id)}">${esc(m.title)}</a>: ${esc(chartFmt(m.value))}${esc(unitOf(m))} <span class="muted">(${esc(targetText(m.target, m))})</span>${m.missedTwice ? ' <span class="st red"><i aria-hidden="true">▲</i>two periods running</span>' : ''}</li>`).join('')}</ul></div>` : ''}
    ${p.areas.map((a) => `<section class="group"><h2>${esc(a.title)}</h2><p class="muted">${esc(a.question)}</p>
      ${a.id === 'execution' && cs?.blocked ? `<h3 class="mt">Right now</h3>${rightNow(cs, { link: `#${encodeURIComponent(board)}/sprint` })}` : ''}
      ${a.headlines.map((h) => `<div class="headline" id="h-${esc(h.measure.id)}">
        <div class="mtiles one">${measureTile(h.measure)}</div>
        ${h.drill.length || Object.keys(h.extras).length ? `<details class="drill"${h.measure.met === false ? ' open' : ''}><summary>What drives ${esc((METRICS[h.measure.id]?.name ?? h.measure.title).toLowerCase())}</summary>
          ${h.drill.length ? `<div class="mtiles">${h.drill.map((m) => measureTile(m)).join('')}</div>` : ''}
          ${extrasHtml(h.measure.id, h.extras)}</details>` : ''}
      </div>`).join('')}</section>`).join('')}
    <p class="note">${esc(shortDate(p.from))} to ${esc(shortDate(p.to))}. Headline measures count in the score; the measures under "What drives" explain them and do not.</p>`;
  sizeBars();
  window.scrollTo(0, 0);
}
document.addEventListener('change', (e) => { if (e.target.dataset?.teamdays != null) { TEAMF.days = Number(e.target.value); route(); } });

async function sprintPage(board) {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a href="#${esc(encodeURIComponent(board))}">${esc(board)}</a><a class="on">Current sprint</a>`;
  const cs = await api('/sprints/current?team=' + encodeURIComponent(board)).catch(() => null);
  $('#main').innerHTML = `<h2 class="big">${esc(board)}: current sprint</h2>${sprintBoard(cs)}`;
  sizeBars();
  window.scrollTo(0, 0);
}

// Every measure, by area: the headline first, then what explains it. Why it matters, how it is calculated, the target.
function metricsPage() {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">Metrics</a>`;
  const list = Object.values(METRICS);
  const about = (m) => `<p><b>Why it matters.</b> ${esc(m.why)}</p><p><b>How it is calculated.</b> ${esc(m.how)}</p>${m.target ? `<p><b>Target.</b> ${esc(m.target)}</p>` : ''}
    ${m.dora ? `<table class="t mt"><tr><th>DORA tier</th><th>Range</th></tr>${m.dora.map((b) => `<tr><td>${esc(b.tier)}</td><td>${esc(b.test)}</td></tr>`).join('')}</table><p class="note">DORA State of DevOps research bands, approximate.</p>` : ''}`;
  const areas = [...new Set(list.map((m) => m.area))];
  $('#main').innerHTML = `<h2 class="big">What Houston measures</h2>
    <p class="muted">Ten headline measures decide the score. The measures under each explain it and are not scored. Full formulas in METRICS.md.</p>
    ${areas.map((a) => `<h2>${esc(a)}</h2>${list.filter((m) => m.area === a && m.headline).map((h) => `
      <details class="card metric mt" id="m-${esc(h.id)}"><summary><b>${esc(h.name)}</b> <span class="st green">headline</span> <span class="note">${esc(h.why.split('. ')[0])}.</span></summary>${about(h)}
        ${list.filter((m) => m.explains === h.id).map((m) => `<details class="metric sub"><summary>${esc(m.name)} <span class="note">${esc(m.why.split('. ')[0])}.</span></summary>${about(m)}</details>`).join('')}
      </details>`).join('')}`).join('')}`;
  window.scrollTo(0, 0);
}

$('#refresh').addEventListener('click', async () => { $('#refresh').textContent = 'Refreshing'; await post('/refresh'); $('#refresh').textContent = 'Refresh now'; route(); });
// One listener for every link and card, instead of inline onclick handlers (which a strict CSP blocks).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go]');
  if (!el) return;
  e.preventDefault();
  go(el.dataset.go, el.dataset.tab);
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
// Sortable tables (class "sortable"): click or press Enter on a heading to sort by it, again to reverse. A cell sorts by
// its data-sort value when it has one, then as a number when it reads as one, else as text. Empty cells stay last.
function sortTable(th) {
  const table = th.closest('table'), body = table.tBodies[0]; if (!body) return;
  const col = [...th.parentNode.children].indexOf(th), dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
  table.querySelectorAll('thead th').forEach((h) => h.removeAttribute('aria-sort'));
  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
  const key = (tr) => {
    const c = tr.children[col]; const v = (c?.dataset.sort ?? c?.textContent ?? '').trim();
    if (!v || v === '·') return null;
    const n = Number(v.replace(/[,%]/g, '').replace(/\s*(days|hours|h|d)$/, ''));
    return Number.isFinite(n) ? n : v.toLowerCase();
  };
  const rows = [...body.rows].map((tr) => [key(tr), tr]);
  rows.sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * dir));
  body.append(...rows.map(([, tr]) => tr));
}
document.addEventListener('click', (e) => { const th = e.target.closest?.('table.sortable thead tr:last-child th'); if (th) sortTable(th); });
document.addEventListener('keydown', (e) => { const th = e.target.closest?.('table.sortable thead tr:last-child th'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortTable(th); } });
new MutationObserver(() => document.querySelectorAll('table.sortable thead tr:last-child th:not([tabindex])').forEach((th) => { th.tabIndex = 0; th.setAttribute('role', 'columnheader'); }))
  .observe(document.body, { childList: true, subtree: true });

async function dataPage() {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">Data checks</a>`;
  const dq = await api('/data-quality');
  const icon = { ok: ['green', '✓', 'OK'], warn: ['amber', '●', 'Check'], fail: ['red', '▲', 'Wrong'] };
  $('#main').innerHTML = `<h2 class="big">Data checks</h2>
    <p class="muted">Every measure is only as right as the data behind it. These checks look at what the last collect found: a field id that matches nothing, a deploy workflow with no runs, bots doing the reviewing. Fix anything marked Wrong or Check, then collect again.</p>
    <div class="card scrollx"><table class="t sortable"><thead><tr><th>Status</th><th>Source</th><th>Check</th><th>Finding</th><th>Affects</th></tr></thead><tbody>
    ${dq.map((c) => `<tr><td data-sort="${{ fail: 0, warn: 1, ok: 2 }[c.status]}"><span class="st ${icon[c.status][0]}"><i aria-hidden="true">${icon[c.status][1]}</i>${icon[c.status][2]}</span></td><td>${esc(c.area)}</td><td>${esc(c.check)}</td><td>${esc(c.detail)}</td><td class="muted">${esc(c.affects.join(', '))}</td></tr>`).join('')}
    </tbody></table><p class="note">Click a column heading to sort; click again to reverse.</p></div>`;
  window.scrollTo(0, 0);
}
