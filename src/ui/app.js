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
const rag = (v, thr = [75, 50]) => v >= thr[0] ? 'green' : v >= thr[1] ? 'amber' : 'red';

function spark(points, w = 300, h = 44) {
  if (!points.length) return '';
  const xs = points.map((_, i) => 8 + i * ((w - 16) / Math.max(1, points.length - 1)));
  const y = (v) => h - 6 - (v / 100) * (h - 12);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i]},${y(p.score)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="8" x2="${w - 8}" y1="${y(75)}" y2="${y(75)}" stroke="#E1E5EC" stroke-dasharray="3 3"/>
    <path d="${path}" fill="none" stroke="#141B2D" stroke-width="2" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${xs[i]}" cy="${y(p.score)}" r="3.5" fill="var(--${cls(p.rag)})"><title>${esc(p.sprint)}: ${esc(p.score)}</title></circle>`).join('')}
  </svg>`;
}

function go(board, tab) { location.hash = board ? `#${encodeURIComponent(board)}${tab ? '/' + tab : ''}` : ''; }
window.addEventListener('hashchange', route); route();

async function route() {
  await metricsReady;
  if (location.hash === '#_metrics') return metricsPage();
  const [board, tab] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (!board) return overview();
  return team(board, tab || 'overview');
}

async function overview() {
  $('#crumbs').innerHTML = '';
  const teams = await api('/teams');
  // Alphabetical, not ranked: the page is for each team to see its own health, not a league table.
  teams.sort((a, b) => a.board.localeCompare(b.board));
  if (!teams.length) return $('#main').innerHTML = '<p class="empty">No data yet. Fill .env and press Refresh now.</p>';
  $('#main').innerHTML = `
    <h2>Teams</h2>
    <div class="grid">${teams.map((t) => `
      <div class="card team-card" data-go="${esc(t.board)}">
        <div class="top"><span class="name">${esc(t.board)}</span>
          <span class="delta ${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat'}">${t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '•'} ${Math.abs(t.delta)} vs last sprint</span></div>
        <div class="scores">
          <span class="pill ${cls(t.rag)}"><b>${esc(t.score)}</b> sprint</span>
          ${t.flowScore != null ? `<span class="pill ${cls(t.flowRag)}"><b>${esc(t.flowScore)}</b> flow</span>` : ''}
          ${t.qualityScore != null ? `<span class="pill ${cls(t.qualityRag)}"><b>${esc(t.qualityScore)}</b> quality</span>` : ''}
          ${t.featuresScore != null ? `<span class="pill ${rag(t.featuresScore)}"><b>${t.featuresScore}</b> features</span>` : ''}
          ${t.opsScore != null ? `<span class="pill ${rag(t.opsScore)}"><b>${t.opsScore}</b> prod</span>` : ''}
          ${t.docsScore != null ? `<span class="pill ${rag(t.docsScore)}"><b>${t.docsScore}</b> docs</span>` : ''}
        </div>
        <p class="headline">${esc(t.headline)}</p>
        ${spark(t.trend)}
      </div>`).join('')}
    </div>
    <p class="note">Sprint score over the last ${teams[0].trend.length} sprints, dotted line is 75 (green). Tap a team.</p>`;
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
  const [d, p, r, cost] = await Promise.all([api('/teams/' + encodeURIComponent(board)), api('/teams/' + encodeURIComponent(board) + '/people').catch(() => ({ people: [], github: [], docs: [] })), api('/teams/' + encodeURIComponent(board) + '/recommendations'), api('/teams/' + encodeURIComponent(board) + '/costs').catch(() => null)]);
  const { latest, history, quality, flow, docs, features, ops, actions, insights, heatmap, window: win, output, incidents } = d;
  const trend = [...history].sort((a, b) => a.sprintId - b.sprintId).map((c) => ({ sprint: c.sprintName, score: c.score, rag: c.rag }));
  const tabs = [['overview', 'Overview'], ['sprint', 'Sprint'], flow && ['flow', 'Flow & DORA'], quality && ['quality', 'Quality'], features && ['features', 'Features'], ops && ['prod', 'Production & cost'], docs && ['docs', 'Docs'], p.people?.length && ['people', 'People']].filter(Boolean);
  $('#crumbs').innerHTML = `<a href="#" data-go="">All teams</a><a class="on">${esc(board)}</a>`;
  const big = (n, label, sub) => n == null ? '' : `<div class="bigscore"><span class="n ${rag(n)}">${esc(n)}</span><span class="l"><b>${esc(label)}</b>${esc(sub)}</span></div>`;
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
          ${spark(trend, 600, 60)}
          <p class="note">Sprint score, ${esc(trend[0]?.sprint)} to ${esc(trend[trend.length - 1]?.sprint)}.</p>
        </div>
        <div class="card"><h2>Since last sprint</h2>${(insights || []).length ? insights.map((i) => `<div class="insight"><span class="dot ${i.kind}"></span><span>${esc(i.text)}</span></div>`).join('') : '<p class="note">Need two sprints for a comparison.</p>'}</div>
      </div>
      ${win ? `<h2>90 day window</h2>
      <div class="rec gate ${win.onTrack ? 'open' : ''}"><p class="msg">${esc(win.verdict)}</p>
        <table class="t mt"><tr><th>Target</th><th>Goal</th><th class="num">At start</th><th class="num">Now</th><th>Met</th></tr>
        ${win.targets.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.target)}</td><td class="num">${esc(t.start ?? '·')}</td><td class="num">${esc(t.now ?? '·')}</td><td class="${t.met ? '' : 'warn'}">${t.met ? 'Yes' : 'No'}</td></tr>`).join('')}</table>
        <p class="note">${esc(win.start)} to ${esc(win.end)}. Set WINDOW_START in .env. Same targets the team sees in the digest.</p></div>` : ''}
      ${output ? `<h2>Output and cost</h2><div class="card"><p class="msg">${esc(output.verdict)}</p>
        <div class="scores mt">
          <span class="pill ${output.pointsPerEngineerPerSprint >= 8 ? 'green' : output.pointsPerEngineerPerSprint >= 5 ? 'amber' : 'red'}"><b>${output.pointsPerEngineerPerSprint}</b> points / engineer / sprint</span>
          <span class="pill ${output.mergedPrsPerEngineerPerWeek >= 2 ? 'green' : output.mergedPrsPerEngineerPerWeek >= 1 ? 'amber' : 'red'}"><b>${output.mergedPrsPerEngineerPerWeek}</b> merged PRs / engineer / week</span>
          ${output.costRatio ? `<span class="pill ${output.costRatio <= 1.5 ? 'green' : output.costRatio <= 2.5 ? 'amber' : 'red'}"><b>${output.costRatio}x</b> offshore cost</span>` : ''}
          ${output.outputRatioVsBest != null ? `<span class="pill ${output.outputRatioVsBest >= 0.8 ? 'green' : output.outputRatioVsBest >= 0.5 ? 'amber' : 'red'}"><b>${Math.round(output.outputRatioVsBest * 100)}%</b> of best team per head</span>` : ''}
        </div></div>` : ''}
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
      ${p.activity.map((x) => `<tr><td>${esc(x.name)}</td><td class="num ${x.activeDaysPerWeek < 3 ? 'warn' : ''}">${esc(x.activeDaysPerWeek)}</td><td class="num">${esc(x.weekdaysCovered)} of ${x.weekdaysInWindow}</td><td>${esc(x.pattern)}</td><td>${esc(x.lastActive ?? '')}</td></tr>`).join('')}</table>
      <p class="note">A day counts if any Jira transition or GitHub action left a trace. This is not attendance and not hours. Someone can be in the office all day with no trace, or at home with ten. Use it to ask, never to conclude.</p>` : ''}
      <p class="note">Questions to ask, not verdicts. Absence in a tool is proof of no trace, not of no work.</p>`,
  };
  $('#main').innerHTML = `
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#" class="${k === tab ? 'on' : ''}" data-go="${esc(board)}" data-tab="${esc(k)}">${esc(l)}</a>`).join('')}</div>
    ${(content[tab] || content.overview)()}`;
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
