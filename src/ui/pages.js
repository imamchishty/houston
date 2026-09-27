// Houston pages beyond the team tabs: the sprint board, the Quality / Predictability / Efficiency summaries,
// and the dashboard sections that link to them. Loaded before app.js; uses its helpers (esc, api, METRICS, ...)
// at call time only.

const shortDate = (d) => new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const OUTLOOK = { 'On track': ['green', '✓'], 'At risk': ['amber', '●'], 'Off track': ['red', '▲'], 'Just started': ['none', '·'] };
const outlookChip = (o) => { const [c, i] = OUTLOOK[o] ?? ['none', '·']; return `<span class="st ${c}"><i aria-hidden="true">${i}</i>${esc(o)}</span>`; };

// ---------- Measure tiles (reports and dashboard headlines) ----------
// DORA tier for the four DORA measures, from the research bands in the metric catalogue.
const tierChip = (m) => { const c = METRICS[m.id === 'change_failure_rate' ? 'change_failure' : m.id]; const t = c?.dora && m.value != null ? doraTier(c, m.value) : null;
  return t ? ` <span class="tierchip ${TIER_CLS[t]}">DORA ${esc(t)}</span>` : ''; };
const unitOf = (m) => (m.unit === '%' ? '%' : m.unit === 'count' ? '' : ` ${m.unit}`);
const unitWord = (u, v) => (u === '%' ? '%' : u === 'count' ? '' : ` ${v === 1 ? u.replace(/s$/, '') : u}`);
const targetText = (t, m) => (t ? `Target: ${t.op === '<' ? 'under' : 'over'} ${t.value}${unitWord(m.unit, t.value)}` : '');
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
    <div class="mt">${esc(m.title)}${tierChip(m)}</div>
    <div class="mv">${m.value == null ? '<span class="muted">·</span>' : `${esc(chartFmt(m.value))}<small>${esc(unitOf(m))}</small>`}</div>
    <div class="ms">${countsText(m)}${m.trend ? ` · ${trendArrow(m.trend)}${m.trend === 'same' ? '' : ` than ${esc(chartFmt(m.previous))}${esc(unitOf(m))}`}` : ''}</div>
    ${m.note ? `<div class="ms">${esc(m.note)}</div>` : ''}
    <div class="mg">${metChip(m)} <span class="muted">${esc(targetText(m.target, m))}</span>${m.smallSample ? '<span class="st amber" title="Too few items to trust this value: under 10 for a rate, under 5 for a median"><i aria-hidden="true">●</i>Small sample</span>' : ''}</div>
    ${about}${failing}
  </div>`;
}

// ---------- Report pages: Quality, Predictability, Efficiency ----------
// The areas. Every number lives in exactly one of them.
const REPORTS = {
  dora: { title: 'DORA', intro: 'How fast and how safely change reaches users: deployment frequency, lead time, change failure rate and time to restore, and where lead time goes.' },
  flow: { title: 'Flow', intro: 'How much work flows and where it waits: the Flow Framework (velocity, time, efficiency, load, distribution), bottlenecks, cycle time and pull request flow.' },
  quality: { title: 'Quality', intro: 'Bugs and the code itself: how many bugs each change brings, how many reach customers, what stops them, code quality from SonarQube and tests, and how fast bugs are fixed.' },
  security: { title: 'Security', intro: 'Whether serious security issues are fixed within their deadline, what is exposed right now, and whether every repo is actually scanned: vulnerable dependencies, leaked secrets and flaws in the team\'s own code.' },
  planning: { title: 'Planning', intro: 'Whether the team delivers what it plans, how much unplanned work arrives, and whether work is set up so plans can be trusted.' },
};
const FILT = { team: 'all', days: 30 };
const pctOf = (x, t) => { const sum = t.coding + t.review + t.deploy; return sum ? `${Math.round((100 * x) / sum)}%` : '·'; };

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
      ${g.heatmap?.length ? `<div class="card mt"><h3>Where tickets spend their time</h3>
        <table class="t"><tr><th>Status</th><th>Kind</th><th class="num">Share of time</th><th></th><th class="num">Median per ticket</th><th class="num">Tickets</th></tr>
        ${g.heatmap.map((h, k) => `<tr><td>${esc(h.status)}</td><td>${h.waiting ? '<span class="st amber"><i aria-hidden="true">●</i>Waiting</span>' : '<span class="muted">Active</span>'}</td>
          <td class="num">${esc(h.share)}%</td><td class="heatbar"><div class="track"><i class="${h.waiting ? (k < 2 ? 'k-s2 hot' : 'k-s2') : 'k-s1'}" data-w="${esc(h.share)}" data-max="${esc(Math.max(...g.heatmap.map((x) => x.share), 1))}"></i></div></td>
          <td class="num">${esc(h.medianHours)} h</td><td class="num">${esc(h.tickets)}</td></tr>`).join('')}</table>
        <p class="note">Working hours from first start to done, tickets resolved in the period. Waiting statuses in orange; the biggest are where to look first.</p></div>` : ''}
      ${g.stages ? `<div class="card mt"><h3>Lead time by stage, per week</h3>${barChart('stages', { labels: g.stages.weekly.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), stacked: true, unit: 'hours', W: 900, H: 200,
          detail: (i) => { const w = g.stages.weekly[i], per = (x) => (w.prs ? `${chartFmt(Math.round((10 * x) / w.prs) / 10)} hours` : '·');
            return { subtitle: `${w.prs} ${w.prs === 1 ? 'PR' : 'PRs'} deployed`, rows: w.prs ? [{ name: 'Average per PR', value: per(w.coding + w.review + w.deploy) }] : [{ name: 'Nothing merged this week has been deployed yet', value: '' }] }; }, series: [
          { name: 'Coding', key: 's1', values: g.stages.weekly.map((w) => Math.round(w.coding)) }, { name: 'Review', key: 's2', values: g.stages.weekly.map((w) => Math.round(w.review)) }, { name: 'Waiting to deploy', key: 'muted', values: g.stages.weekly.map((w) => Math.round(w.deploy)) }] })}
        <p class="note">Total hours across the PRs deployed each week, so the stages add up exactly. Of all lead time in the period: coding ${esc(pctOf(g.stages.total.coding, g.stages.total))}, review ${esc(pctOf(g.stages.total.review, g.stages.total))}, waiting to deploy ${esc(pctOf(g.stages.total.deploy, g.stages.total))}.</p></div>` : ''}
      ${g.distribution ? `<div class="twocol mt"><div class="card"><h3>Flow distribution</h3>${barChart('dist', { labels: g.distribution.map((d) => d.kind), unit: 'items', W: 440, H: 190, series: [{ name: 'Items completed', key: 's1', values: g.distribution.map((d) => d.items) }] })}
          <p class="note">Bugs are defects; debt and risk come from labels; everything else is feature work.</p></div>
        <div class="card"><h3>Flow velocity by week</h3>${barChart('vel', { labels: g.velocityByWeek.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), unit: 'items', W: 440, H: 190, series: [{ name: 'Items completed', key: 's1', values: g.velocityByWeek.map((w) => w.items) }] })}</div></div>` : ''}
      ${g.trend?.length ? `<div class="card mt"><h3>Escaped bugs by week</h3>${barChart('esc-' + g.id, { labels: g.trend.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), unit: '', W: 900, H: 180, series: [
        { name: 'Significant bugs found in production', key: 's2', values: g.trend.map((w) => w.significantBugs) }, { name: 'Incidents (Sev0 to Sev2)', key: 's1', values: g.trend.map((w) => w.incidents) }] })}
        <p class="note">Significant = priority ${esc('in JIRA_SIGNIFICANT_PRIORITIES')}; bugs labelled pre-release are left out.</p></div>` : ''}
      ${g.detail?.length ? `<details class="tbl"><summary>Sprints in this period</summary><table class="t"><tr><th>Team</th><th>Sprint</th><th class="num">Committed</th><th class="num">Done</th><th class="num">Completion</th></tr>
        ${g.detail.map((x) => `<tr><td>${esc(x.board)}</td><td>${esc(x.sprint)}</td><td class="num">${esc(x.planned)}</td><td class="num">${esc(x.done)}</td><td class="num">${esc(x.pct)}%</td></tr>`).join('')}</table></details>` : ''}
    </section>`).join('')}
    ${name === 'dora' ? '<h2>Day by day</h2><div id="dora"></div>' : ''}
    <h2>By team</h2>
    <div class="card scrollx"><table class="t dash sortable"><thead><tr><th>Team</th>${all.map((m) => `<th title="${esc(m.title)}">${esc(m.title)}</th>`).join('')}</tr></thead><tbody>
      ${d.teams.map((t) => `<tr class="row" data-go="${esc(t.board)}"><td><b>${esc(t.board)}</b></td>${t.measures.map((m) => `<td data-sort="${m.value == null ? '' : esc(m.value)}" title="${esc(m.title)}: ${esc(countsText(m).replace(/<[^>]+>/g, ''))}">${m.value == null ? '<span class="st none">·</span>' : `<span class="st ${m.met == null ? 'none' : m.met ? 'green' : 'red'}"><i aria-hidden="true">${m.met == null ? '' : m.met ? '✓' : '▲'}</i>${esc(chartFmt(m.value))}${esc(unitOf(m))}</span>`}</td>`).join('')}</tr>`).join('')}
    </tbody></table><p class="note">✓ target met · ▲ target missed · hover a cell for the counts. Click a column heading to sort, or a team for its detail.</p></div>`;
  if (name === 'dora') { DORA.team = FILT.team; DORA.days = FILT.days; renderDora(); }
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
    <div class="card sb-title"><div class="k">Sprint <select class="sprintpick" data-board="${esc(cs.board)}">${cs.sprints.slice().reverse().map((x) => `<option value="${esc(x.id)}"${x.id === cs.id ? ' selected' : ''}>${esc(x.name)}${x.state === 'active' ? ' (now)' : ''}</option>`).join('')}</select></div><div class="sname">${esc(cs.sprint)}</div><div class="s">${esc(shortDate(cs.start))} to ${esc(shortDate(cs.end))}${cs.goal ? ` · ${esc(cs.goal)}` : ' · no sprint goal'}</div>
      <p class="note">Outlook: points done per working day so far (${esc(p.done)} in ${esc(cs.workingDaysElapsed)} days), carried to the end of the sprint: ${esc(p.projected)} of ${esc(p.scope)} points.</p></div>
    <div class="card sb-wip"><h3>Work in progress <span class="muted">${esc(cs.inProgress.length)} items, ${esc(cs.wip.people)} people${cs.wip.overLimit ? ` · <span class="down">${esc(cs.wip.overLimit)} ${cs.wip.overLimit === 1 ? 'person has' : 'people have'} more than ${esc(cs.wip.limit)} at once</span>` : ` · nobody over ${esc(cs.wip.limit)} at once`}</span></h3>
      ${cs.wip.over?.length ? `<p class="note">Over the limit: ${cs.wip.over.map((o) => `${esc(o.name)} (${esc(o.count)})`).join(', ')}. Starting fewer things finishes more.</p>` : ''}${cs.inProgress.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="num">Points</th><th class="num">Days</th>${named ? '<th>Assignee</th>' : ''}</tr>
      ${cs.inProgress.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td>${esc(x.status)}</td><td class="num">${esc(x.points ?? '·')}</td><td class="num ${x.old ? 'warn' : ''}" title="${x.typical != null ? `Normal for this size: ${esc(x.typical)} days` : 'No normal yet for this size'}">${esc(x.days ?? '·')}${x.old ? ' ▲' : ''}</td>${named ? `<td>${esc(x.assignee ?? 'unassigned')}</td>` : ''}</tr>`).join('')}</table></div>` : '<p class="note">Nothing in progress.</p>'}
      <p class="note">▲ in progress more than 3× the team's normal time for its size (${esc(cs.oldWip)} ${cs.oldWip === 1 ? 'item' : 'items'}). Queued: ${esc(cs.queued.count)} of ${esc(cs.queued.of)} open items (${esc(cs.queued.pct)}%) are waiting${cs.queued.statuses.length ? ` in ${esc(cs.queued.statuses.join(', '))}` : ''}.</p></div>
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

// ---------- Simple dashboard: each team in plain English ----------
const ANSWER = { 'Yes': ['green', '✓'], 'Partly': ['amber', '●'], 'No': ['red', '▲'], 'Not enough data': ['none', '·'] };
function simpleView(teams, dq) {
  const bad = dq.filter((x) => x.status !== 'ok').length;
  return `<p class="lead">${esc(teams.length)} ${teams.length === 1 ? 'team' : 'teams'}: ${esc(teams.filter((t) => t.band === 'Healthy').length)} healthy, ${esc(teams.filter((t) => t.band === 'Watch').length)} to watch, ${esc(teams.filter((t) => t.band === 'Needs attention').length)} needing attention.${bad ? ` <a href="#_data">${esc(bad)} data ${bad === 1 ? 'check' : 'checks'} to look at</a> before trusting every number.` : ''}</p>
    <div class="simple">${teams.map((t) => `<section class="card sc">
      <div class="sch"><h2 class="big">${esc(t.board)}</h2><span class="band ${bandCls(t.band)}">${esc(t.band)}</span></div>
      <p class="sum">${esc(t.summary)}</p>
      ${t.questions.map((q) => `<div class="qa"><span class="st ${ANSWER[q.answer][0]} ans"><i aria-hidden="true">${ANSWER[q.answer][1]}</i>${esc(q.answer)}</span>
        <div><div class="qq">${esc(q.question)}</div><div class="muted">${esc(q.sentence)}</div></div></div>`).join('')}
      ${t.fixFirst.length ? `<div class="fix"><b>Fix first</b><ul>${t.fixFirst.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      ${t.worse.length ? `<div class="fix"><b>Keeps missing its target</b><ul>${t.worse.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>${t.worseCount > t.worse.length ? `<span class="muted">and ${esc(t.worseCount - t.worse.length)} more</span>` : ''}</div>` : ''}
      <a class="more" href="#${esc(encodeURIComponent(t.board))}">See the detail →</a>
    </section>`).join('')}</div>
    <p class="note">Answers use the last 30 days. Switch to Detailed for every number, chart and definition.</p>`;
}

// ---------- Team health alerts (detailed dashboard) ----------
function alertsPanel(alerts) {
  if (!alerts.length) return `<div class="card alerts"><h3>Team health alerts</h3><p class="note"><span class="st green"><i>✓</i></span> Every target met in the last 30 days.</p></div>`;
  const red = alerts.filter((a) => a.severity === 'red').length;
  const shown = alerts.slice(0, 10);
  return `<div class="card alerts"><h3>Team health alerts <span class="muted">${esc(alerts.length)} targets missed, ${esc(red)} for two periods running</span></h3>
    <table class="t">${shown.map((a) => `<tr class="row" data-href="#_${esc(a.page)}"><td><span class="st ${a.severity}"><i aria-hidden="true">${a.severity === 'red' ? '▲' : '●'}</i>${a.severity === 'red' ? 'Keeps missing' : 'Missed'}</span></td>
      <td><b>${esc(a.board)}</b></td><td>${esc(a.title)}</td><td class="num">${esc(chartFmt(a.value))}${esc(unitOf(a))}</td>
      <td class="muted">${esc(targetText(a.target, a))}</td><td class="muted">${a.trend ? trendArrow(a.trend) : ''}</td></tr>`).join('')}</table>
    ${alerts.length > shown.length ? `<p class="note">and ${esc(alerts.length - shown.length)} more on the Quality, Predictability and Efficiency pages.</p>` : ''}
    <p class="note">Amber: target missed in the last 30 days. Red: missed in the 30 days before as well. Small samples never raise an alert.</p></div>`;
}
const trendArrow = (t) => (t === 'better' ? '<span class="up">▲ better</span>' : t === 'worse' ? '<span class="down">▼ worse</span>' : t === 'same' ? '<span class="muted">no change</span>' : '');

// Choosing a past sprint re-renders the board for it.
document.addEventListener('change', async (e) => {
  if (!e.target.classList?.contains('sprintpick')) return;
  const board = e.target.dataset.board, id = e.target.value;
  const cs = await api(`/sprints/current?team=${encodeURIComponent(board)}&sprint=${encodeURIComponent(id)}`);
  const box = document.querySelector('.sboard'); if (!box) return;
  box.outerHTML = sprintBoard(cs); sizeBars();
});

// ---------- Monthly report ----------
const MFILT = { team: 'all', month: null };
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthLong = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtU = (v, u) => (v == null ? '·' : `${chartFmt(v)}${u === '%' ? '%' : u === 'count' ? '' : ' ' + u}`);
const STATUS_NOTE = { 'partial': 'Data starts part way through this month', 'no data': 'No data', 'saved': 'Saved when the month closed', 'in progress': 'So far this month', 'complete': '' };

async function monthlyPage(teams) {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">Monthly</a>`;
  const now = new Date(); const months = [];
  for (let k = 0; k < 12; k++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); months.push(d.toISOString().slice(0, 7)); }
  MFILT.month ??= months[1]; // last complete month by default
  const q = `team=${encodeURIComponent(MFILT.team)}&month=${encodeURIComponent(MFILT.month)}`;
  const r = await api(`/monthly?${q}`);
  if (!r.headline) { $('#main').innerHTML = `<p class="empty">${esc(r.error ?? 'No data')}</p>`; return; }
  const chip = (h) => h.met == null ? '' : h.met ? '<span class="st green"><i aria-hidden="true">✓</i>met</span>' : '<span class="st red"><i aria-hidden="true">▲</i>missed</span>';
  $('#main').innerHTML = `
    <div class="rephead"><div><h2 class="big">Monthly report: ${esc(r.team === 'all' ? 'all teams' : r.team)}, ${esc(r.name)}</h2><p class="lead">${esc(r.summary)}</p></div>
      <div><button type="button" class="copybtn" data-copy="/monthly.md?${esc(q)}">Copy as Markdown</button><p class="note">For Confluence or email.</p></div></div>
    <div class="filters" role="group" aria-label="Monthly filters">
      <label>Team <select data-mfilter="team"><option value="all">All teams</option>${teams.map((t) => `<option value="${esc(t)}"${MFILT.team === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Month <select data-mfilter="month">${months.map((m) => `<option value="${esc(m)}"${MFILT.month === m ? ' selected' : ''}>${esc(monthLong(m))}${m === months[0] ? ' (so far)' : ''}</option>`).join('')}</select></label>
    </div>
    <h2>Key numbers</h2>
    <div class="card scrollx"><table class="t"><tr><th>Measure</th><th class="num">${esc(monthLabel(r.month))}</th><th class="num">${esc(monthLabel(prevMonthOf(r.month)))}</th><th>Change</th><th>Target</th></tr>
      ${r.headline.map((h) => `<tr><td>${esc(h.title)}${h.smallSample ? ' <span class="st amber" title="Too few items to trust this value"><i aria-hidden="true">●</i>small sample</span>' : ''}</td>
        <td class="num"><b>${esc(fmtU(h.value, h.unit))}</b></td><td class="num muted">${esc(fmtU(h.previous, h.unit))}</td><td>${h.trend ? trendArrow(h.trend) : '<span class="muted">·</span>'}</td>
        <td>${h.target ? `<span class="muted">${h.target.op === '<' ? 'under' : 'over'} ${esc(fmtU(h.target.value, h.unit))}</span> ${chip(h)}` : ''}</td></tr>`).join('')}
    </table>${r.previousStatus !== 'complete' && r.previousStatus !== 'saved' ? `<p class="note">No comparison: ${esc(STATUS_NOTE[r.previousStatus] || r.previousStatus)} for ${esc(monthLong(prevMonthOf(r.month)))}.</p>` : ''}</div>
    <div class="twocol mt"><div class="card"><h3>Improved</h3>${r.improved.length ? `<ul class="plain">${r.improved.map((x) => `<li><span class="up">▲</span> ${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Nothing improved clearly.</p>'}</div>
      <div class="card"><h3>Got worse</h3>${r.worse.length ? `<ul class="plain">${r.worse.map((x) => `<li><span class="down">▼</span> ${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Nothing got clearly worse.</p>'}</div></div>
    <h2>Delivered by kind</h2>
    <div class="card">${barChart('m-dist', { labels: r.distribution.map((d) => d.month), xLabel: monthLabel, stacked: true, unit: 'items', W: 900, H: 200, series: [
      { name: 'Features', key: 's1', values: r.distribution.map((d) => d.features) }, { name: 'Defects', key: 's2', values: r.distribution.map((d) => d.defects) },
      { name: 'Risks', key: 'muted', values: r.distribution.map((d) => d.risks) }, { name: 'Debt', key: 'ink', values: r.distribution.map((d) => d.debt) }] })}
      <p class="note">Work items completed each month by kind (the Flow Framework's flow distribution). Bugs are defects; risk and debt come from labels.</p></div>
    <h2>Trends, last 6 months</h2>
    <div class="trends">${r.trends.map((t) => `<div class="card"><h3>${esc(t.title)}</h3>${lineChart('tr-' + t.id, { labels: t.points.map((p) => p.month), xLabel: monthLabel, unit: t.unit === '%' ? '%' : t.unit === 'count' ? '' : t.unit, W: 360, H: 170,
        series: [{ name: 'Value', key: 's1', values: t.points.map((p) => p.value), dots: true }, ...(t.target ? [{ name: `Target (${t.target.op === '<' ? 'under' : 'over'} ${t.target.value})`, key: 'muted', values: t.points.map(() => t.target.value), dashed: true }] : [])] })}
        ${t.points.some((p) => p.status !== 'complete' && p.status !== 'saved' && p.status !== 'in progress') ? `<p class="note">${esc(t.points.filter((p) => p.value == null).map((p) => monthLabel(p.month)).join(', '))}: no data yet.</p>` : ''}</div>`).join('')}</div>
    <p class="note">Each point is one calendar month, computed over the whole month. Months finish being saved the night after they end, so trends keep growing beyond the window of collected data.</p>
    <h2>In ${esc(r.name)}</h2>
    <div class="twocol"><div class="card"><h3>Sprints closed</h3>${r.detail.sprints.length ? `<table class="t"><tr><th>Team</th><th>Sprint</th><th class="num">Committed</th><th class="num">Done</th><th class="num">Completion</th></tr>
        ${r.detail.sprints.map((s) => `<tr><td>${esc(s.board)}</td><td>${esc(s.sprint)}</td><td class="num">${esc(s.committed)}</td><td class="num">${esc(s.done)}</td><td class="num">${esc(s.pct ?? '·')}%</td></tr>`).join('')}</table>` : '<p class="note">None.</p>'}</div>
      <div class="card"><h3>Features shipped</h3>${r.detail.features.length ? `<table class="t"><tr><th>Feature</th><th>Team</th><th class="num">Cost</th></tr>
        ${r.detail.features.map((f) => `<tr><td><code>${esc(f.key)}</code> ${esc(f.summary)}</td><td>${esc(f.board)}</td><td class="num">${f.cost == null ? '·' : money(f.cost, f.currency)}</td></tr>`).join('')}</table>` : '<p class="note">None.</p>'}
        <h3 class="mt">Incidents</h3><p>${esc(r.detail.incidents.count)} ${r.detail.incidents.count === 1 ? 'incident' : 'incidents'}${r.detail.incidents.medianRestoreHours != null ? `, median ${esc(r.detail.incidents.medianRestoreHours)} hours to restore` : ''}.</p></div></div>`;
  window.scrollTo(0, 0);
}
const prevMonthOf = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };
document.addEventListener('change', (e) => { const f = e.target.dataset?.mfilter; if (!f) return; MFILT[f] = e.target.value; route(); });
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-copy]'); if (!b) return;
  const text = await fetch('/api' + b.dataset.copy).then((x) => x.text());
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed: use /api' + b.dataset.copy; }
  setTimeout(() => { b.textContent = 'Copy as Markdown'; }, 2500);
});
