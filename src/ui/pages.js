// Shared page pieces: measure tiles, the charts that explain a headline, the sprint board and the monthly report.
// Loaded before app.js; uses its helpers (esc, api, METRICS, ...) at call time only.

const shortDate = (d) => new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const OUTLOOK = { 'On track': ['green', '✓'], 'At risk': ['amber', '●'], 'Off track': ['red', '▲'], 'Just started': ['none', '·'] };
const outlookChip = (o) => { const [c, i] = OUTLOOK[o] ?? ['none', '·']; return `<span class="st ${c}"><i aria-hidden="true">${i}</i>${esc(o)}</span>`; };

// ---------- Measure tiles ----------
// DORA tier for the four DORA measures, from the research bands in the metric catalogue.
const tierChip = (m) => { const c = METRICS[m.id]; const t = c?.dora && m.value != null ? doraTier(c, m.value) : null;
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

// ---------- Charts and tables that explain a headline ----------
const pctOf = (x, t) => { const sum = t.coding + t.review + t.deploy; return sum ? `${Math.round((100 * x) / sum)}%` : '·'; };
function extrasHtml(id, ex) {
  const out = [];
  if (ex.stages) out.push(`<div class="card mt"><h3>Lead time by stage, per week</h3>${barChart(`${id}-stages`, { labels: ex.stages.weekly.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), stacked: true, unit: 'hours', W: 900, H: 200,
      detail: (i) => { const w = ex.stages.weekly[i]; return { subtitle: `${w.prs} ${w.prs === 1 ? 'PR' : 'PRs'} deployed`, rows: w.prs ? [{ name: 'Average per PR', value: `${chartFmt(Math.round((10 * (w.coding + w.review + w.deploy)) / w.prs) / 10)} hours` }] : [{ name: 'Nothing merged this week has been deployed yet', value: '' }] }; },
      series: [{ name: 'Coding', key: 's1', values: ex.stages.weekly.map((w) => Math.round(w.coding)) }, { name: 'Review', key: 's2', values: ex.stages.weekly.map((w) => Math.round(w.review)) }, { name: 'Waiting to deploy', key: 'muted', values: ex.stages.weekly.map((w) => Math.round(w.deploy)) }] })}
    <p class="note">Of all lead time in the period: coding ${esc(pctOf(ex.stages.total.coding, ex.stages.total))}, review ${esc(pctOf(ex.stages.total.review, ex.stages.total))}, waiting to deploy ${esc(pctOf(ex.stages.total.deploy, ex.stages.total))}.</p></div>`);
  if (ex.detail?.length) out.push(`<div class="card mt"><h3>Predicted vs actual, per sprint</h3>${barChart(`${id}-pva`, { labels: ex.detail.map((x) => x.sprint), unit: 'points', W: 900, H: 210, series: [
      { name: 'Committed at the start', key: 's1', values: ex.detail.map((x) => x.planned) }, { name: 'Committed and done', key: 's2', values: ex.detail.map((x) => x.done) }, { name: 'Added after the start', key: 'muted', values: ex.detail.map((x) => x.added ?? 0) }],
      detail: (i) => ({ subtitle: `${Math.round(ex.detail[i].pct)}% of the commitment done` }) })}
    <p class="note">Committed: estimated items in the sprint when it started. Done: those finished by the sprint's end. Added after the start: scope creep, points pulled in once the sprint had begun (not counted in completion).</p></div>`);
  if (ex.detail?.length) out.push(`<details class="tbl"><summary>Sprints in this period</summary><table class="t"><tr><th>Team</th><th>Sprint</th><th class="num">Committed</th><th class="num">Done</th><th class="num">Completion</th></tr>
    ${ex.detail.map((x) => `<tr><td>${esc(x.board)}</td><td>${esc(x.sprint)}</td><td class="num">${esc(x.planned)}</td><td class="num">${esc(x.done)}</td><td class="num">${esc(x.pct)}%</td></tr>`).join('')}</table></details>`);
  if (ex.trend?.length) out.push(`<div class="card mt"><h3>Bugs found in production, by week</h3>${barChart(`${id}-esc`, { labels: ex.trend.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), unit: '', W: 900, H: 180, series: [
    { name: 'Significant bugs found in production', key: 's2', values: ex.trend.map((w) => w.significantBugs) }, { name: 'Incidents (Sev0 to Sev2)', key: 's1', values: ex.trend.map((w) => w.incidents) }] })}</div>`);
  if (ex.heatmap?.length) { const mx = Math.max(...ex.heatmap.map((x) => x.share), 1); out.push(`<div class="card mt"><h3>Where tickets spend their time</h3>
    <table class="t"><tr><th>Status</th><th>Kind</th><th class="num">Share of time</th><th></th><th class="num">Median per ticket</th><th class="num">Tickets</th></tr>
    ${ex.heatmap.map((h, k) => `<tr><td>${esc(h.status)}</td><td>${h.waiting ? '<span class="st amber"><i aria-hidden="true">●</i>Waiting</span>' : '<span class="muted">Active</span>'}</td>
      <td class="num">${esc(h.share)}%</td><td class="heatbar"><div class="track"><i class="${h.waiting ? (k < 2 ? 'k-s2 hot' : 'k-s2') : 'k-s1'}" data-w="${esc(h.share)}" data-max="${esc(mx)}"></i></div></td>
      <td class="num">${esc(h.medianHours)} h</td><td class="num">${esc(h.tickets)}</td></tr>`).join('')}</table>
    <p class="note">Working hours from first start to done. Waiting statuses in orange: the biggest are where to look first.</p></div>`); }
  if (ex.distribution) out.push(`<div class="twocol mt"><div class="card"><h3>What was delivered</h3>${barChart(`${id}-dist`, { labels: ex.distribution.map((d) => d.kind), unit: 'items', W: 440, H: 190, series: [{ name: 'Items completed', key: 's1', values: ex.distribution.map((d) => d.items) }] })}
      <p class="note">Bugs are defects; debt and risk come from labels; everything else is feature work.</p></div>
    <div class="card"><h3>Items finished per week</h3>${barChart(`${id}-vel`, { labels: ex.velocityByWeek.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), unit: 'items', W: 440, H: 190, series: [{ name: 'Items completed', key: 's1', values: ex.velocityByWeek.map((w) => w.items) }] })}</div></div>`);
  if (ex.weekly) out.push(`<div class="card mt"><h3>Support tickets by week</h3>${barChart(`${id}-sup`, { labels: ex.weekly.map((w) => w.week), xLabel: (w) => 'w/c ' + shortDate(w), unit: 'tickets', W: 900, H: 180, series: [
    { name: 'Created', key: 's2', values: ex.weekly.map((w) => w.created) }, { name: 'Resolved', key: 's1', values: ex.weekly.map((w) => w.resolved) }] })}<p class="note">When created stays above resolved, the queue grows.</p></div>`);
  return out.join('');
}

// ---------- Right now: what is stuck, and what has been in progress too long ----------
function rightNow(cs, { link } = {}) {
  if (!cs || cs.error) return '';
  const named = cs.blocked.some((x) => 'assignee' in x) || cs.ageing.some((x) => 'assignee' in x);
  const who = (x) => (named ? `<td>${esc(x.assignee ?? 'unassigned')}</td>` : '');
  const blocked = cs.blocked.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="num">Working days there</th>${named ? '<th>Assignee</th>' : ''}</tr>
    ${cs.blocked.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td><span class="st ${x.kind === 'Blocked' ? 'red' : 'amber'}"><i aria-hidden="true">${x.kind === 'Blocked' ? '▲' : '●'}</i>${esc(x.status)}${x.flagged ? ' · flagged' : ''}</span></td><td class="num">${esc(x.days)}</td>${who(x)}</tr>`).join('')}</table></div>`
    : '<p class="note">Nothing is blocked or waiting.</p>';
  const ageing = cs.ageing.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="num">Days in progress</th><th class="num">Normal for its size</th>${named ? '<th>Assignee</th>' : ''}</tr>
    ${cs.ageing.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td>${esc(x.status)}</td><td class="num">${esc(x.days)}</td><td class="num">${esc(x.typical)}</td>${who(x)}</tr>`).join('')}</table></div>`
    : '<p class="note">Nothing has been in progress far longer than normal.</p>';
  return `<div class="twocol rightnow">
    <div class="card"><h3>Blocked or waiting now <span class="muted small">${esc(cs.blocked.length)} ${cs.blocked.length === 1 ? 'item' : 'items'}</span></h3>${blocked}
      <p class="note">Items flagged in Jira, or in a waiting status (${esc('JIRA_WAIT_STATUSES')}): blocked ones first, then the longest waiting. Working days since flagged or since entering the status, weekends left out.</p></div>
    <div class="card"><h3>Ageing work <span class="muted small">${esc(cs.ageing.length)} ${cs.ageing.length === 1 ? 'item' : 'items'}</span></h3>${ageing}
      <p class="note">In progress more than 3× the team's normal time for a ticket of that size.${link ? ` <a href="${esc(link)}">The whole sprint →</a>` : ''}</p></div>
  </div>`;
}

// ---------- Every ticket in the sprint: person, type, state, and whether it was ready and is properly done ----------
const TF = { person: 'all', type: 'all', state: 'all', check: 'all' };
let TICKETS = null;
const STATE = { todo: 'To do', inprogress: 'In progress', done: 'Done' };
const CHECK = { notready: 'Started when not ready', notdone: 'Done, but not done properly', unready: 'To do and not ready yet', changed: 'Requirements changed after start', sentback: 'Sent back to refinement' };
// Ready is a miss once work has started; before that the ticket is just not ready yet.
const startedUnready = (t) => t.state !== 'todo' && !t.ready.ok;
const fieldWord = (f) => (f === 'summary' ? 'title' : f === 'acceptance' ? 'acceptance criteria' : f);
const doneBadly = (t) => t.done && !t.done.ok;
function ticketList(cs) {
  TICKETS = cs;
  const named = cs.tickets.some((t) => 'assignee' in t);
  const people = [...new Set(cs.tickets.map((t) => t.assignee ?? 'unassigned'))].sort((a, b) => a.localeCompare(b));
  const types = [...new Set(cs.tickets.map((t) => t.type))].sort();
  const sel = (k, label, opts, all, names) => `<label>${label} <select data-tf="${k}"><option value="all">${all}</option>${opts.map((o) => `<option value="${esc(o)}"${TF[k] === o ? ' selected' : ''}>${esc(names ? names[o] : o)}</option>`).join('')}</select></label>`;
  const started = cs.tickets.filter((t) => t.state !== 'todo'), finished = cs.tickets.filter((t) => t.done);
  const count = (n, of, good) => `<b>${esc(of - n)} of ${esc(of)}</b> ${good}`;
  return `<h3>Tickets in this sprint <span class="muted">${esc(cs.tickets.length)}</span></h3>
    <p class="defsum">${started.length ? `${count(started.filter(startedUnready).length, started.length, 'started tickets were ready')}` : 'Nothing started yet'} · ${finished.length ? count(finished.filter(doneBadly).length, finished.length, 'done tickets are properly done') : 'nothing done yet'}.</p>
    <details class="defs"><summary>What Ready and Done mean here</summary><div class="twocol">
      <div><b>Definition of Ready</b><ul>${cs.definitions.ready.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No checks switched on.</li>'}</ul></div>
      <div><b>Definition of Done</b><ul>${cs.definitions.done.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No checks switched on.</li>'}</ul></div></div>
      <p class="note">Set in Admin. Ready reads the ticket as it is now, except the estimate, which must have been set before work started. A check Houston cannot judge for a ticket is left out, not failed.</p></details>
    <div class="filters" role="group" aria-label="Filter tickets">${named ? sel('person', 'Person', people, 'Everyone') : ''}${sel('type', 'Type', types, 'All types')}${sel('state', 'State', ['todo', 'inprogress', 'done'], 'Any state', STATE)}${sel('check', 'Show', ['notready', 'notdone', 'unready', 'changed', 'sentback'], 'All tickets', CHECK)}</div>
    <div class="scrollx"><table class="t sortable" id="tickets"><thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Status</th>${named ? '<th>Person</th>' : ''}<th class="num">Points</th><th>Ready</th><th>Done</th><th>Requirements</th><th class="num">Days in progress</th><th class="num">Days since it moved</th></tr></thead><tbody>${ticketRows(cs)}</tbody></table></div>
    <p class="note">Ready: ✓ ready · ▲ started without meeting the Definition of Ready · ○ to do, not ready yet. Done: ✓ properly done · ▲ marked done without meeting the Definition of Done. Requirements: ✎ edited after work started (the number of edits) · ↩ sent back to to do. Hover an icon for the reason, or use Show to see the reasons in full. Also ▲ days: more than 3× the team's normal for its size · ● waiting or flagged · + added after the sprint started.</p>`;
}
function ticketRows(cs) {
  const named = cs.tickets.some((t) => 'assignee' in t);
  const check = { all: () => true, notready: startedUnready, notdone: doneBadly, unready: (t) => t.state === 'todo' && !t.ready.ok, changed: (t) => t.churn.changes > 0, sentback: (t) => t.churn.sentBack }[TF.check];
  const rows = cs.tickets.filter((t) => (TF.person === 'all' || (t.assignee ?? 'unassigned') === TF.person) && (TF.type === 'all' || t.type === TF.type) && (TF.state === 'all' || t.state === TF.state) && check(t));
  if (!rows.length) return `<tr><td colspan="11" class="muted">No tickets match.</td></tr>`;
  const showWhy = TF.check !== 'all';
  const icon = (cls, glyph, label, why) => `<span class="st ${cls} chk${showWhy && why ? ' why' : ''}" title="${esc(label)}${why ? ': ' + esc(why) : ''}"><i aria-hidden="true">${glyph}</i>${showWhy && why ? esc(why) : `<span class="sr">${esc(label)}</span>`}</span>`;
  const ready = (t) => t.ready.ok ? icon('green', '✓', 'Ready') : t.state === 'todo' ? icon('none', '○', 'Not ready yet', t.ready.missing.join(', ')) : icon('red', '▲', 'Started when not ready', t.ready.missing.join(', '));
  const done = (t) => !t.done ? '<span class="muted">·</span>' : t.done.ok ? icon('green', '✓', 'Done properly') : icon('red', '▲', 'Not done properly', t.done.missing.join(', '));
  const req = (t) => { const c = t.churn, why = c.changes ? `${c.changes} ${c.changes === 1 ? 'edit' : 'edits'} after start${c.by?.length ? ` by ${c.by.join(', ')}` : ''} (${c.fields.map(fieldWord).join(', ')})` : '';
    return `${c.changes ? icon('amber', `✎${c.changes}`, 'Requirements changed after start', why) : ''}${c.sentBack ? ` ${icon('red', '↩', 'Sent back to refinement', 'moved back to to do after work started')}` : ''}` || '<span class="muted">·</span>'; };
  return rows.map((t) => `<tr><td>${cs.jiraBrowse ? `<a href="${esc(cs.jiraBrowse + t.key)}" target="_blank" rel="noopener"><code>${esc(t.key)}</code></a>` : `<code>${esc(t.key)}</code>`}</td><td>${esc(t.summary)}${t.addedLate ? ' <span class="muted" title="Added after the sprint started">+</span>' : ''}</td><td>${esc(t.type)}</td>
    <td>${esc(t.status)}${t.waiting || t.flagged ? ` <span class="st amber"><i aria-hidden="true">●</i>${t.flagged ? 'flagged' : 'waiting'}</span>` : ''}</td>${named ? `<td>${esc(t.assignee ?? 'unassigned')}</td>` : ''}<td class="num">${esc(t.points ?? '·')}</td>
    <td data-sort="${t.ready.ok ? 2 : t.state === 'todo' ? 1 : 0}">${ready(t)}</td><td data-sort="${!t.done ? 1 : t.done.ok ? 2 : 0}">${done(t)}</td><td data-sort="${t.churn.changes + (t.churn.sentBack ? 100 : 0)}">${req(t)}</td>
    <td class="num ${t.old ? 'warn' : ''}">${t.days == null ? '·' : esc(t.days)}${t.old ? ' ▲' : ''}</td><td class="num">${t.daysSinceMove == null ? '·' : esc(t.daysSinceMove)}</td></tr>`).join('');
}
document.addEventListener('change', (e) => { const k = e.target.dataset?.tf; if (!k || !TICKETS) return; TF[k] = e.target.value; $('#tickets tbody').innerHTML = ticketRows(TICKETS); });

// ---------- Ready and Done over time (team page) ----------
function definitionsPanel(d, p) {
  const drill = p.areas.flatMap((a) => a.headlines.flatMap((h) => h.drill));
  const cur = { ready: drill.find((m) => m.id === 'ready_rate'), done: drill.find((m) => m.id === 'done_rate'), changed: drill.find((m) => m.id === 'requirements_changed') };
  if (!cur.ready && !cur.done) return '';
  const tile = (m, k, label) => !m ? '' : `<div class="tile"><div class="k">${esc(label)}</div><div class="v">${m.value == null ? '·' : `${esc(chartFmt(m.value))}<small>%</small>`}</div>
    <div class="s">${esc(countsText(m).replace(/<[^>]+>/g, ''))}${m.trend ? ` · ${trendArrow(m.trend)}` : ''}${m.note ? `<br>${esc(m.note)}` : ''}</div></div>`;
  const sp = (d?.sprints ?? []).filter((x) => x.ready.of || x.done.of);
  const short = (n) => n.replace(/^.*?(\d+)$/, 'Sprint $1');
  return `<div class="card defpanel mt"><h3>Ready, Done and requirements <span class="muted small">how often work started ready, finished properly done, and had its requirements changed on the way</span></h3>
    <div class="tiles">${tile(cur.ready, 'ready', 'Started when ready, this period')}${tile(cur.done, 'done', 'Done means done, this period')}${tile(cur.changed, 'changed', 'Requirements changed after start, this period')}</div>
    ${sp.length > 1 ? `${barChart('defs-trend', { labels: sp.map((x) => x.sprint), xLabel: short, unit: '%', W: 900, H: 200, series: [
        { name: 'Started when ready', key: 's1', values: sp.map((x) => x.ready.pct) }, { name: 'Done means done', key: 's2', values: sp.map((x) => x.done.pct) }, { name: 'Requirements changed after start', key: 'muted', values: sp.map((x) => x.changed?.pct ?? null) }],
        detail: (i) => ({ subtitle: `${sp[i].ready.n} of ${sp[i].ready.of} started ready · ${sp[i].done.n} of ${sp[i].done.of} done properly`, rows: [
          ...(sp[i].ready.missing ? [{ name: 'Ready, most often missing', value: sp[i].ready.missing }] : []), ...(sp[i].done.missing ? [{ name: 'Done, most often missing', value: sp[i].done.missing }] : [])] }) })}
      <p class="note">Per closed sprint: tickets started in it that met the Definition of Ready, tickets finished in it that met the Definition of Done, and tickets started in it whose requirements were edited after work started. Hover a sprint for the counts and what was missed most.</p>` : '<p class="note">The trend per sprint appears once two closed sprints have data.</p>'}
    <details class="defs"><summary>The definitions in force</summary><div class="twocol">
      <div><b>Definition of Ready</b><ul>${(d?.definitions.ready ?? []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No checks switched on.</li>'}</ul></div>
      <div><b>Definition of Done</b><ul>${(d?.definitions.done ?? []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No checks switched on.</li>'}</ul></div></div>
      <p class="note">Set in Admin. The ticket by ticket view is on the current sprint page.</p></details></div>`;
}

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
    <div class="sb-now">${rightNow(cs)}</div>
    <div class="card sb-tickets">${ticketList(cs)}</div>
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

const trendArrow = (t) => (t === 'better' ? '<span class="up">↑ better</span>' : t === 'worse' ? '<span class="down">↓ worse</span>' : t === 'same' ? '<span class="muted">no change</span>' : '');

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
    <div class="twocol mt"><div class="card"><h3>Improved</h3>${r.improved.length ? `<ul class="plain">${r.improved.map((x) => `<li><span class="up">↑</span> ${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Nothing improved clearly.</p>'}</div>
      <div class="card"><h3>Got worse</h3>${r.worse.length ? `<ul class="plain">${r.worse.map((x) => `<li><span class="down">↓</span> ${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Nothing got clearly worse.</p>'}</div></div>
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
      <div class="card"><h3>Features shipped</h3>${r.detail.features.length ? `<table class="t"><tr><th>Feature</th><th>Team</th><th>Done</th></tr>
        ${r.detail.features.map((f) => `<tr><td><code>${esc(f.key)}</code> ${esc(f.summary)}</td><td>${esc(f.board)}</td><td>${esc(shortDate(f.resolved))}</td></tr>`).join('')}</table>` : '<p class="note">None.</p>'}
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
