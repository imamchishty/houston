// Houston pages beyond the team tabs: the sprint board, the Quality / Predictability / Efficiency summaries,
// and the dashboard sections that link to them. Loaded before app.js; uses its helpers (esc, api, METRICS, ...)
// at call time only.

const shortDate = (d) => new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const OUTLOOK = { 'On track': ['green', '✓'], 'At risk': ['amber', '●'], 'Off track': ['red', '▲'], 'Just started': ['none', '·'] };
const outlookChip = (o) => { const [c, i] = OUTLOOK[o] ?? ['none', '·']; return `<span class="st ${c}"><i aria-hidden="true">${i}</i>${esc(o)}</span>`; };

// ---------- Measure tiles (reports and dashboard headlines) ----------
const unitOf = (m) => (m.unit === '%' ? '%' : m.unit === 'count' ? '' : ` ${m.unit}`);
const targetText = (t, m) => (t ? `Target: ${t.op === '<' ? 'under' : 'over'} ${t.value}${m.unit === '%' ? '%' : m.unit === 'count' ? '' : ' ' + m.unit}` : '');
function metChip(m) {
  if (m.value == null) return '<span class="st none">Not measured</span>';
  if (m.met == null) return '';
  return m.met ? '<span class="st green"><i aria-hidden="true">✓</i>Target met</span>' : '<span class="st red"><i aria-hidden="true">▲</i>Target missed</span>';
}
const countsText = (m) => (m.num != null && m.den != null ? `${m.num.toLocaleString()} of ${m.den.toLocaleString()} ${esc(m.denLabel ?? '')}` : m.den != null ? `from ${m.den.toLocaleString()} ${esc(m.denLabel ?? '')}` : '');
function measureTile(m, opts = {}) {
  const failing = !opts.compact && m.failing?.length ? `<details class="tbl"><summary>${esc(m.failing.length)} not passing</summary><p class="fails">${m.failing.slice(0, 100).map((k) => `<code>${esc(k)}</code>`).join(' ')}${m.failing.length > 100 ? ` and ${esc(m.failing.length - 100)} more` : ''}</p></details>` : '';
  const about = !opts.compact ? `<details class="about"><summary>What is this?</summary><p><b>How it is calculated.</b> ${esc(m.how)}</p>${METRICS[m.id] ? `<p><b>Why it matters.</b> ${esc(METRICS[m.id].why)}</p>` : ''}</details>` : '';
  return `<div class="mtile">
    <div class="mt">${esc(m.title)}</div>
    <div class="mv">${m.value == null ? '<span class="muted">·</span>' : `${esc(chartFmt(m.value))}<small>${esc(unitOf(m))}</small>`}</div>
    <div class="ms">${countsText(m)}</div>
    <div class="mg">${metChip(m)} <span class="muted">${esc(targetText(m.target, m))}</span>${m.smallSample ? '<span class="st amber" title="Too few items to trust this value: under 10 for a rate, under 5 for a median"><i aria-hidden="true">●</i>Small sample</span>' : ''}</div>
    ${about}${failing}
  </div>`;
}

// ---------- Report pages: Quality, Predictability, Efficiency ----------
const REPORTS = {
  quality: { title: 'Quality', intro: 'How bugs affect customers and the team: how many are created, what stops them, how fast they are fixed, and how much change is undone.' },
  predictability: { title: 'Predictability', intro: 'Whether the team delivers what it plans, and whether work is set up so plans can be trusted: every change traceable, every ticket estimated, in a sprint and in an epic.' },
  efficiency: { title: 'Efficiency', intro: 'Where work waits: from a pull request being opened to merged, and from a ticket being started to done.' },
};
const FILT = { team: 'all', days: 30 };

async function reportPage(name, teams) {
  const r = REPORTS[name];
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">${esc(r.title)}</a>`;
  const d = await api(`/reports/${name}?team=${encodeURIComponent(FILT.team)}&days=${FILT.days}`);
  if (!d.groups) { $('#main').innerHTML = `<p class="empty">${esc(d.error ?? 'No data')}</p>`; return; }
  const all = d.groups.flatMap((g) => g.measures);
  const met = all.filter((m) => m.met === true).length, measured = all.filter((m) => m.met != null).length;
  $('#main').innerHTML = `
    <div class="rephead"><div><h2 class="big">${esc(r.title)}</h2><p class="muted">${esc(r.intro)}</p></div>
      <div class="tile"><div class="k">Targets met</div><div class="v">${esc(met)}<small> of ${esc(measured)}</small></div><div class="s">${esc(shortDate(d.from))} to ${esc(shortDate(d.to))}</div></div></div>
    ${filterRow(teams, 'rep')}
    ${d.groups.map((g) => `<section class="group"><h2>${esc(g.title)}</h2><p class="muted">${esc(g.question)}</p>
      <div class="mtiles">${g.measures.map((m) => measureTile(m)).join('')}</div>
      ${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}
      ${g.detail?.length ? `<details class="tbl"><summary>Sprints in this period</summary><table class="t"><tr><th>Team</th><th>Sprint</th><th class="num">Committed</th><th class="num">Done</th><th class="num">Completion</th></tr>
        ${g.detail.map((x) => `<tr><td>${esc(x.board)}</td><td>${esc(x.sprint)}</td><td class="num">${esc(x.planned)}</td><td class="num">${esc(x.done)}</td><td class="num">${esc(x.pct)}%</td></tr>`).join('')}</table></details>` : ''}
    </section>`).join('')}
    <h2>By team</h2>
    <div class="card scrollx"><table class="t dash"><tr><th>Team</th>${all.map((m) => `<th title="${esc(m.title)}">${esc(m.title)}</th>`).join('')}</tr>
      ${d.teams.map((t) => `<tr class="row" data-go="${esc(t.board)}"><td><b>${esc(t.board)}</b></td>${t.measures.map((m) => `<td title="${esc(m.title)}: ${esc(countsText(m).replace(/<[^>]+>/g, ''))}">${m.value == null ? '<span class="st none">·</span>' : `<span class="st ${m.met == null ? 'none' : m.met ? 'green' : 'red'}"><i aria-hidden="true">${m.met == null ? '' : m.met ? '✓' : '▲'}</i>${esc(chartFmt(m.value))}${esc(unitOf(m))}</span>`}</td>`).join('')}</tr>`).join('')}
    </table><p class="note">✓ target met · ▲ target missed · hover a cell for the counts. Click a team for its detail.</p></div>`;
  window.scrollTo(0, 0);
}

function filterRow(teams, kind) {
  return `<div class="filters" role="group" aria-label="Filters">
    <label>Team <select data-filter="team" data-kind="${kind}"><option value="all">All teams</option>${teams.map((t) => `<option value="${esc(t)}"${FILT.team === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label>Period <select data-filter="days" data-kind="${kind}">${[7, 30, 90].map((n) => `<option value="${n}"${FILT.days === n ? ' selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
  </div>`;
}
document.addEventListener('change', (e) => {
  const f = e.target.dataset?.filter; if (!f) return;
  FILT[f] = f === 'days' ? Number(e.target.value) : e.target.value;
  route();
});

// ---------- Sprint board (team tab "Current sprint") ----------
function sprintBoard(cs) {
  if (!cs || cs.error) return `<p class="empty">No sprint in progress for this team.</p>`;
  const p = cs.points, days = cs.burndown.map((b) => b.day);
  const dayCls = p.remaining > 0 && cs.workingDaysLeft <= 2 ? 'red' : p.remaining > 0 && cs.workingDaysLeft <= 5 ? 'amber' : '';
  const remCls = { 'On track': 'green', 'At risk': 'amber', 'Off track': 'red' }[cs.outlook] ?? '';
  const named = cs.inProgress.some((x) => 'assignee' in x);
  return `<div class="sboard">
    <div class="card sb-days"><div class="k">Days left in sprint</div><div class="huge ${dayCls}">${esc(cs.workingDaysLeft)}</div><div class="s">working days of ${esc(cs.workingDays)}</div></div>
    <div class="card sb-rem"><div class="k">Remaining story points</div><div class="huge ${remCls}">${esc(p.remaining)}</div><div class="s">${outlookChip(cs.outlook)}${cs.unestimated ? ` · ${esc(cs.unestimated)} unestimated items not counted` : ''}</div></div>
    <div class="card sb-title"><div class="k">Sprint</div><div class="sname">${esc(cs.sprint)}</div><div class="s">${esc(shortDate(cs.start))} to ${esc(shortDate(cs.end))}${cs.goal ? ` · ${esc(cs.goal)}` : ' · no sprint goal'}</div>
      <p class="note">Outlook: points done per working day so far (${esc(p.done)} in ${esc(cs.workingDaysElapsed)} days), carried to the end of the sprint: ${esc(p.projected)} of ${esc(p.scope)} points.</p></div>
    <div class="card sb-wip"><h3>Work in progress</h3>${cs.inProgress.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="num">Points</th><th class="num">Days</th>${named ? '<th>Assignee</th>' : ''}</tr>
      ${cs.inProgress.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td>${esc(x.status)}</td><td class="num">${esc(x.points ?? '·')}</td><td class="num ${x.days > 5 ? 'warn' : ''}">${esc(x.days ?? '·')}</td>${named ? `<td>${esc(x.assignee ?? 'unassigned')}</td>` : ''}</tr>`).join('')}</table></div>` : '<p class="note">Nothing in progress.</p>'}
      <p class="note">${esc(cs.inProgress.length)} items. Days in progress over 5 are highlighted.</p></div>
    <div class="card sb-burn"><h3>Sprint burndown</h3>${lineChart('sb-burn', { labels: days, xLabel: shortDate, unit: 'points', whole: true, H: 240, W: 560, series: [
      { name: 'Remaining', key: 's1', values: cs.burndown.map((b) => b.remaining), area: true, dots: true },
      { name: 'Ideal', key: 'muted', values: cs.burndown.map((b) => b.ideal), dashed: true },
      { name: 'Scope', key: 's2', values: cs.burndown.map((b) => b.scope) }] })}
      <p class="note">Working days only. Scope rises when work is added mid-sprint; Jira does not report items removed from a sprint, so scope never falls here.</p></div>
    <div class="card sb-prog"><h3>Sprint progress</h3>
      <div class="hbars"><div class="hb"><span>Committed</span><div class="track"><i class="k-s1" data-w="${esc(p.committed)}" data-max="${esc(Math.max(p.committed, p.scope, 1))}"></i></div><b>${esc(p.committed)}</b></div>
        <div class="hb"><span>In sprint now</span><div class="track"><i class="k-s2" data-w="${esc(p.scope)}" data-max="${esc(Math.max(p.committed, p.scope, 1))}"></i></div><b>${esc(p.scope)}</b></div>
        <div class="hb"><span>Completed</span><div class="track"><i class="k-series" data-w="${esc(p.done)}" data-max="${esc(Math.max(p.committed, p.scope, 1))}"></i></div><b>${esc(p.done)}</b></div></div>
      <p class="note">Story points. ${esc(cs.items.done)} of ${esc(cs.items.total)} items done.</p>
      <h3>Velocity, last ${esc(cs.velocity.length)} sprints</h3>${barChart('sb-vel', { labels: cs.velocity.map((v) => v.sprint.replace(/^.*?(\d+)$/, 'Sprint $1')), unit: 'points', H: 190, W: 440, series: [
        { name: 'Committed', key: 's1', values: cs.velocity.map((v) => v.committed) }, { name: 'Completed', key: 's2', values: cs.velocity.map((v) => v.completed) }] })}</div>
    <div class="card sb-bugs"><h3>Bug trend</h3>${lineChart('sb-bugs', { labels: cs.bugTrend.map((b) => b.day), xLabel: shortDate, unit: 'bugs', whole: true, W: 330, H: 210, series: [
      { name: 'Created', key: 's2', values: cs.bugTrend.map((b) => b.created), dots: true }, { name: 'Resolved', key: 's1', values: cs.bugTrend.map((b) => b.resolved), dots: true }] })}
      <p class="note">Bugs in the team's Jira project created and resolved each working day of this sprint. In the sprint: ${esc(cs.bugs.resolved)} of ${esc(cs.bugs.total)} resolved.</p></div>
    <div class="card sb-cycle"><h3>Cycle time per work item (in progress to done)</h3>${lineChart('sb-cycle', { labels: cs.cycleByDay.map((c) => c.day), xLabel: shortDate, unit: 'days', W: 820, H: 200, series: [
      { name: 'Average cycle time of items done that day', key: 's1', values: cs.cycleByDay.map((c) => c.avg), dots: true }] })}
      ${cs.cycle.length ? `<details class="tbl"><summary>${esc(cs.cycle.length)} items done this sprint</summary><table class="t"><tr><th>Key</th><th>Summary</th><th class="num">Points</th><th class="num">Days</th></tr>${cs.cycle.map((c) => `<tr><td><code>${esc(c.key)}</code></td><td>${esc(c.summary)}</td><td class="num">${esc(c.points ?? '·')}</td><td class="num">${esc(c.days)}</td></tr>`).join('')}</table></details>` : ''}</div>
    <div class="card sb-status"><h3>Work items by status</h3>${barChart('sb-status', { labels: cs.statusType.map((x) => x.status), stacked: true, unit: 'items', W: 560, H: 200, series: [
      { name: 'Features and tasks', key: 's1', values: cs.statusType.map((x) => x.other) }, { name: 'Bugs', key: 's2', values: cs.statusType.map((x) => x.bugs) }] })}</div>
  </div>`;
}
// Horizontal bar widths are set from data attributes after render (no inline styles under the CSP).
function sizeBars() { document.querySelectorAll('i[data-w]').forEach((i) => { i.style.width = `${(100 * Number(i.dataset.w)) / Number(i.dataset.max)}%`; }); }

// ---------- Dashboard sections ----------
function dashHeadlines(d) {
  return `<div class="heads">${d.headlines.map((h) => `<a class="card head" href="#_${esc(h.page)}">
    <div class="hh"><h3>${esc(h.title)}</h3><span class="muted">${esc(h.question)}</span></div>
    <div class="mtiles two">${h.measures.map((m) => measureTile(m, { compact: true })).join('')}</div>
    <div class="more">Full ${esc(h.title.toLowerCase())} report →</div></a>`).join('')}</div>
    <p class="note">Last 30 days, all teams.</p>`;
}

function dashSprints(d) {
  if (!d.sprints.length) return '';
  return `<h2>Current sprints</h2><div class="card scrollx"><table class="t dash">
    <tr><th>Team</th><th>Sprint</th><th>Ends</th><th class="num">Days left</th><th>Points done</th><th>Outlook</th></tr>
    ${d.sprints.map((s) => `<tr class="row" data-go="${esc(s.board)}" data-tab="now">
      <td><b>${esc(s.board)}</b></td><td>${esc(s.sprint)}</td><td>${esc(shortDate(s.end))}</td><td class="num">${esc(s.workingDaysLeft)}</td>
      <td><div class="pbar"><div class="track"><i class="k-s1" data-w="${esc(s.points.done)}" data-max="${esc(Math.max(1, s.points.scope))}"></i></div><span>${esc(s.points.done)} / ${esc(s.points.scope)}</span></div></td>
      <td>${outlookChip(s.outlook)}</td></tr>`).join('')}
  </table><p class="note">Click a sprint for its board. Outlook projects points done so far to the end of the sprint.</p></div>`;
}

function dashProjects(d) {
  if (!d.projects.length) return '';
  const cur = d.projects.find((p) => p.currency)?.currency;
  return `<h2>Features in progress</h2><div class="card scrollx"><table class="t dash">
    <tr><th>Feature</th><th>Team</th><th>Tickets done</th><th class="num">Spent</th><th class="num">To complete</th><th class="num">Estimated total</th><th>Due</th></tr>
    ${d.projects.map((p) => `<tr class="row" data-go="${esc(p.board)}" data-tab="features"><td><code>${esc(p.key)}</code> ${esc(p.summary)}</td><td>${esc(p.board)}</td>
      <td><div class="pbar"><div class="track"><i class="k-s1" data-w="${esc(p.childDone)}" data-max="${esc(Math.max(1, p.childCount))}"></i></div><span>${esc(p.childDone)} / ${esc(p.childCount)}</span></div></td>
      <td class="num">${p.spent == null ? '·' : money(p.spent, cur)}</td><td class="num">${p.toComplete == null ? '·' : money(p.toComplete, cur)}</td><td class="num"><b>${p.total == null ? '·' : money(p.total, cur)}</b></td>
      <td>${p.due ? esc(shortDate(p.due)) : '<span class="muted">no due date</span>'}</td></tr>`).join('')}
  </table><p class="note">Cost from the cost model on the Features tab: spent so far, and remaining points at the team's cost per point.</p></div>`;
}

function dashActivity(d) {
  const a = d.activity;
  return `<div class="tiles small">
    <div class="tile"><div class="k">Active people</div><div class="v">${esc(a.activePeople)}</div><div class="s">with a trace in Jira or GitHub, last ${esc(a.days)} days</div></div>
    <div class="tile"><div class="k">Commits to main</div><div class="v">${esc(a.commits.toLocaleString())}</div><div class="s">last ${esc(a.days)} days</div></div>
    <div class="tile"><div class="k">Pull requests merged</div><div class="v">${esc(a.mergedPrs.toLocaleString())}</div><div class="s">last ${esc(a.days)} days</div></div>
    <div class="tile"><div class="k">Tickets completed</div><div class="v">${esc(a.ticketsCompleted.toLocaleString())}</div><div class="s">last ${esc(a.days)} days, sub-tasks excluded</div></div>
  </div>`;
}
