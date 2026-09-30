// ---------- Admin ----------
// Test report for this build, connection health, team setup and the change log. Signs in with the admin account
// (the browser asks the first time an admin request is made). Token values are never shown or entered here.

const ADMIN_TABS = [['allocation', 'Allocation'], ['tests', 'Tests'], ['connections', 'Connections'], ['teams', 'Teams'], ['settings', 'Ready, Done, SLAs'], ['log', 'Change log']];
const adminApi = async (p, opts) => {
  const r = await fetch('/api/admin' + p, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body });
  return body;
};
// A JSON content type only when there is a body: Fastify refuses an empty JSON body.
const adminSend = (method, p, body) => adminApi(p, { method, headers: { 'X-Requested-With': 'houston', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ADMIN = { filter: 'all', q: '', editing: null };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '·');
const okChip = (ok, yes = 'Works', no = 'Failing', none = 'Not set') => ok === true ? `<span class="st green"><i aria-hidden="true">✓</i>${esc(yes)}</span>`
  : ok === false ? `<span class="st red"><i aria-hidden="true">▲</i>${esc(no)}</span>` : `<span class="st none"><i aria-hidden="true">·</i>${esc(none)}</span>`;

async function adminPage(tab = 'tests') {
  $('#crumbs').innerHTML = `<a href="#" data-go="">Dashboard</a><a class="on">Admin</a>`;
  let st;
  try { st = await adminApi('/status'); }
  catch (e) {
    $('#main').innerHTML = `<h2 class="big">Admin</h2><div class="card"><p>${esc(e.status === 401 ? 'Admin sign-in required. Reload the page to sign in with the admin account.' : e.message)}</p></div>`;
    return;
  }
  $('#main').innerHTML = `<div class="rephead"><div><h2 class="big">Admin</h2><p class="muted">Signed in as ${esc(st.user)} · ${esc(st.teams)} teams, ${esc(st.savedTeams)} set up here · ${esc(st.mode)} mode</p></div></div>
    ${st.weakPassword ? `<div class="card warnbox"><span class="st amber"><i aria-hidden="true">●</i>Weak admin password</span> Fine for trying Houston locally. Outside demo mode the admin section stays off until HOUSTON_ADMIN_PASSWORD is at least 14 characters and not a common password.</div>` : ''}
    <div class="tabs">${ADMIN_TABS.map(([k, l]) => `<a href="#_admin/${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>
    <div id="admin-body"><p class="muted">Loading…</p></div>`;
  const body = $('#admin-body');
  try { body.innerHTML = await ({ allocation: adminAllocation, tests: adminTests, connections: adminConnections, teams: adminTeams, settings: adminSettings, log: adminLog }[tab] ?? adminTests)(); }
  catch (e) { body.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}

// Allocation: who is working on what, for the admin only. Traces, never effort; no totals per person, no ranking.
async function adminAllocation() {
  const teams = (await adminApi('/teams')).map((t) => t.name);
  ADMIN.team = teams.includes(ADMIN.team) ? ADMIN.team : teams[0];
  if (!ADMIN.team) return '<p class="empty">No teams yet.</p>';
  const a = await adminApi(`/allocation/${encodeURIComponent(ADMIN.team)}`);
  const d1 = (v) => (v == null ? '·' : chartFmt(v));
  const person = (p) => `<section class="card person"><h3>${esc(p.name)} <span class="muted small">${p.lanes.length ? esc(p.lanes.join(' and ')) : 'no merged PRs in 90 days'} · last recorded ${p.lastTrace ? esc(p.lastTrace) : 'never'}</span></h3>
    ${p.signals.length ? `<p>${p.signals.map((s) => `<span class="st amber"><i aria-hidden="true">●</i>${esc(s)}</span>`).join(' ')}</p>` : ''}
    <details${p.inProgress.some((x) => x.stuck) ? ' open' : ''}><summary>In progress (${esc(p.inProgress.length)})</summary>${p.inProgress.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="num">Points</th><th class="num">Days in progress</th><th class="num">Days since it moved</th></tr>
      ${p.inProgress.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td>${esc(x.status)}${x.waiting ? ' <span class="st amber"><i aria-hidden="true">●</i>waiting</span>' : ''}${x.notReady.length ? ` <span class="st red" title="Started when not ready"><i aria-hidden="true">▲</i>${esc(x.notReady.join(', '))}</span>` : ''}</td><td class="num">${esc(x.points ?? '·')}</td><td class="num">${d1(x.daysInProgress)}</td><td class="num ${x.stuck ? 'warn' : ''}">${d1(x.daysSinceMove)}${x.stuck ? ' ▲' : ''}</td></tr>`).join('')}</table></div>` : '<p class="note">Nothing in progress.</p>'}</details>
    <details><summary>Finished, last 30 days (${esc(p.finished.length)})</summary>${p.finished.length ? `<div class="scrollx"><table class="t"><tr><th>Key</th><th>Summary</th><th class="num">Points</th><th>Done</th><th class="num">Days</th><th class="num">Team's normal for this size</th><th>Done properly</th></tr>
      ${p.finished.map((x) => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.summary)}</td><td class="num">${esc(x.points ?? '·')}</td><td>${esc(x.resolved)}</td><td class="num ${x.over ? 'warn' : ''}">${d1(x.days)}${x.over ? ' ▲' : ''}</td><td class="num">${d1(x.normal)}</td><td>${x.notDone.length ? `<span class="st red"><i aria-hidden="true">▲</i>${esc(x.notDone.join(', '))}</span>` : '<span class="st green"><i aria-hidden="true">✓</i>yes</span>'}</td></tr>`).join('')}</table></div>` : '<p class="note">Nothing finished in 30 days.</p>'}</details>
  </section>`;
  const c = a.capacity;
  return `<div class="card warnbox"><b>For your eyes only.</b> These are traces from Jira and GitHub, not effort. A quiet row can mean leave, incidents, reviews or design work. Use it to find the ticket to ask about, not to grade anyone. There are no totals or rankings per person here on purpose.</div>
    <div class="filters" role="group" aria-label="Team"><label>Team <select data-admin="allocteam">${teams.map((t) => `<option value="${esc(t)}"${t === ADMIN.team ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    ${c ? `<div class="tiles"><div class="tile"><div class="k">${esc(c.sprint)}</div><div class="v">${esc(c.people)}<small> people</small></div><div class="s">with tickets in the sprint</div></div>
      <div class="tile"><div class="k">Rough capacity</div><div class="v">${esc(c.personDays)}<small> person-days</small></div><div class="s">${esc(c.people)} people × ${esc(c.workingDays)} working days</div></div>
      ${c.cost != null ? `<div class="tile"><div class="k">Rough sprint cost</div><div class="v">${esc(c.currency)} ${esc(Math.round(c.cost).toLocaleString())}</div><div class="s">at ${esc(c.currency)} ${esc(c.rateDay.toLocaleString())} a person-day (RATE_DAY)</div></div>` : `<div class="tile"><div class="k">Rough sprint cost</div><div class="v small">Set RATE_DAY</div><div class="s">a blended cost per person-day in .env</div></div>`}</div>` : ''}
    ${a.worthAConversation.length ? `<div class="card attention"><h3>Worth a conversation</h3><ul>${a.worthAConversation.map((w) => `<li><b>${esc(w.name)}</b>: ${esc(w.signals.join('; '))}</li>`).join('')}</ul></div>` : '<p class="note">Nothing stands out: everything assigned is moving.</p>'}
    ${a.people.map(person).join('')}
    <p class="note">In progress: days since the ticket last changed status; ▲ 5 or more working days. Finished: days from start to done against the team's median for tickets of that size; ▲ more than 3× that. Lanes are from merged PRs in the last 90 days. Capacity counts people with tickets in the sprint, whatever their hours.</p>`;
}

// Tests: what was proven for this build.
async function adminTests() {
  const r = await adminApi('/tests');
  if (!r.available) return `<div class="card"><p>${esc(r.message)}</p></div>`;
  const b = r.bdd, v = r.audit.vulnerabilities ?? {};
  const q = ADMIN.q.toLowerCase();
  const features = r.featureList.map((f) => ({ ...f, scenarios: f.scenarios.filter((s) => (ADMIN.filter === 'all' || s.status !== 'passed') && (!q || `${f.name} ${s.name} ${s.steps.join(' ')}`.toLowerCase().includes(q))) }))
    .filter((f) => f.scenarios.length);
  const chip = (s) => okChip(s === 'passed' ? true : s === 'failed' ? false : null, 'Passed', 'Failed', 'Skipped');
  return `${r.sameBuild ? '' : `<div class="card warnbox"><span class="st amber"><i aria-hidden="true">●</i>Different build</span> This report is from ${esc(r.build.commit ?? 'an unknown commit')}${r.build.dirty ? ' with uncommitted changes' : ''}, built ${esc(when(r.build.builtAt))}. Houston is running ${esc(r.running.commit ?? 'an unknown commit')}.</div>`}
    <div class="tiles">
      <div class="tile"><div class="k">BDD scenarios</div><div class="v">${esc(b.passed)}<small> of ${esc(b.scenarios)}</small></div><div class="s">${okChip(b.ok, 'All passed', `${b.failed} failed`)} · ${esc(b.features)} features</div></div>
      <div class="tile"><div class="k">Unit tests</div><div class="v">${r.unit.ok ? 'Pass' : 'Fail'}</div><div class="s">${okChip(r.unit.ok, 'Passed', 'Failed')}</div></div>
      <div class="tile"><div class="k">npm audit</div><div class="v">${esc((v.critical ?? 0) + (v.high ?? 0))}<small> critical or high</small></div><div class="s">${okChip(r.audit.ok, 'Clean', 'Findings')} · ${esc(v.moderate ?? 0)} moderate, ${esc(v.low ?? 0)} low</div></div>
      <div class="tile"><div class="k">Build</div><div class="v">${esc(r.build.build ?? 'local')}</div><div class="s">${esc(r.build.commit ?? '')} · tested ${esc(when(r.generatedAt))}</div></div>
    </div>
    <div class="filters" role="group" aria-label="Filter scenarios">
      <label>Show <select data-admin="filter"><option value="all"${ADMIN.filter === 'all' ? ' selected' : ''}>All scenarios</option><option value="failed"${ADMIN.filter === 'failed' ? ' selected' : ''}>Failed or skipped only</option></select></label>
      <label>Search <input type="search" data-admin="q" value="${esc(ADMIN.q)}" placeholder="feature, scenario or step"></label>
    </div>
    ${features.length ? features.map((f) => {
      const failed = f.scenarios.filter((s) => s.status !== 'passed').length;
      return `<details class="card feat"${failed || q ? ' open' : ''}><summary><b>${esc(f.name)}</b> <span class="muted">${esc(f.scenarios.length)} scenarios${failed ? ` · ${esc(failed)} not passing` : ''} · ${esc(f.file)}</span></summary>
        ${f.description ? `<p class="muted">${esc(f.description)}</p>` : ''}
        ${f.scenarios.map((s) => `<details class="scen"><summary>${chip(s.status)} ${esc(s.name)} <span class="muted">${esc(s.ms)} ms</span></summary>
          <ol class="steps">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${s.error ? `<pre class="err">${esc(s.error)}</pre>` : ''}</details>`).join('')}
      </details>`;
    }).join('') : '<p class="empty">No scenarios match.</p>'}
    <p class="note">Written by <code>npm run report</code> when the image is built, and shipped inside it. The live service never runs tests.</p>`;
}

// Connections: does each one work, when does its token expire, what permission is missing. Never the token.
async function adminConnections() {
  const r = await adminApi('/connections');
  return `<div class="card"><p>Tokens stay in Key Vault (locally, in <code>.env</code>) and are never shown or entered here. To replace one, update the secret and restart Houston, then check again.</p>
    <p><button class="btn" data-admin="check">Check connections now</button> <span class="muted">${r.checkedAt ? `Last checked ${esc(when(r.checkedAt))}` : 'Not checked since Houston started'}</span></p></div>
    ${r.checks.length ? `<div class="card scrollx"><table class="t sortable"><thead><tr><th>Source</th><th>Status</th><th>What Houston found</th><th>Token expires</th><th>Missing permissions</th></tr></thead><tbody>
      ${r.checks.map((c) => `<tr><td><b>${esc(c.source)}</b></td><td data-sort="${c.ok === false ? 0 : c.ok == null ? 1 : 2}">${okChip(c.ok, 'Works', 'Failing', c.configured ? 'Not tested' : 'Not set')}</td>
        <td>${esc(c.detail)}</td><td>${c.expires ? esc(new Date(c.expires).toLocaleDateString()) : '<span class="muted">·</span>'}</td><td>${c.missing?.length ? esc(c.missing.join(', ')) : '<span class="muted">·</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : ''}`;
}

// Teams: every team and where its setup comes from; add or change one, test it, save it.
async function adminTeams() {
  const teams = await adminApi('/teams');
  const t = ADMIN.editing;
  const src = { admin: 'Admin page', env: '.env', demo: 'Demo data' };
  return `<div class="card scrollx"><table class="t sortable"><thead><tr><th>Team</th><th>Set up in</th><th>Jira</th><th>Repos</th><th>SonarQube</th><th>Testmo</th><th>Azure</th><th>Changed</th><th></th></tr></thead><tbody>
    ${teams.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(src[x.source])}</td><td>${x.jiraBoardId ? `${esc(x.jiraProject)} · board ${esc(x.jiraBoardId)}` : '<span class="muted">·</span>'}</td>
      <td class="num">${esc(x.repos.length)}</td><td>${esc(x.sonarProject || '·')}</td><td>${esc(x.testmoProject || '·')}</td><td>${esc(x.resourceGroup || '·')}</td>
      <td>${x.updatedAt ? `${esc(when(x.updatedAt))} by ${esc(x.updatedBy)}` : '<span class="muted">·</span>'}</td>
      <td>${x.source === 'demo' ? '' : `<button class="btn small" data-admin="edit" data-team="${esc(x.name)}">Edit</button>`}</td></tr>`).join('')}
  </tbody></table><p><button class="btn" data-admin="new">Add a team</button></p>
  <p class="note">A team saved here replaces the .env team of the same name. Its data is collected on the next nightly run, or press Refresh now.</p></div>
  ${t ? teamForm(t, teams.find((x) => x.name === t.name)?.source) : ''}`;
}
function teamForm(t, source) {
  const f = (k, label, v, hint = '', type = 'text') => `<label class="fld"><span>${esc(label)}</span><input type="${type}" name="${k}" value="${esc(v ?? '')}" autocomplete="off">${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`;
  const a = (k, label, v, hint) => `<label class="fld"><span>${esc(label)}</span><textarea name="${k}" rows="4">${esc((v ?? []).join('\n'))}</textarea><small class="muted">${esc(hint)}</small></label>`;
  return `<form class="card teamform" id="teamform" autocomplete="off"><h3>${t.isNew ? 'Add a team' : `Change ${esc(t.name)}`}</h3>
    <div class="grid2">
      ${f('name', 'Team name', t.name, 'As Houston shows it, e.g. OSSI. Letters, digits, - and _.')}
      ${f('jiraProject', 'Jira project key', t.jiraProject, 'e.g. OSS')}
      ${f('jiraBoardId', 'Jira board id', t.jiraBoardId || '', 'The number in the board URL: …/boards/123', 'number')}
      ${f('supportProject', 'Support project key', t.supportProject, 'Optional: a separate Jira project for support. Blank: support issue types and labels in the team\'s own project.')}
      ${f('sonarProject', 'SonarQube project key', t.sonarProject, 'Optional')}
      ${f('testmoProject', 'Testmo project id', t.testmoProject, 'Optional, a number')}
      ${f('resourceGroup', 'Azure resource group', t.resourceGroup, 'Optional: cloud cost and production data')}
      ${f('appInsights', 'Application Insights app id', t.appInsights, 'Optional: requests, errors, availability')}
    </div>
    <div class="grid3">
      ${a('repos', 'GitHub repos', t.repos, 'One per line, owner/name')}
    </div>
    <div id="teamresult"></div>
    <p><button type="button" class="btn" data-admin="test">Test connection</button> <button type="button" class="btn primary" data-admin="save">Save</button>
      ${source === 'admin' ? `<button type="button" class="btn danger" data-admin="delete" data-team="${esc(t.name)}">Remove</button>` : ''} <button type="button" class="btn" data-admin="cancel">Cancel</button></p>
  </form>`;
}
const formTeam = () => {
  const fd = new FormData($('#teamform'));
  return Object.fromEntries(['name', 'jiraProject', 'jiraBoardId', 'supportProject', 'sonarProject', 'testmoProject', 'resourceGroup', 'appInsights', 'repos'].map((k) => [k, String(fd.get(k) ?? '')]));
};
const showChecks = (checks) => `<div class="scrollx"><table class="t"><tr><th>Check</th><th>Result</th><th>Found</th></tr>${checks.map((c) => `<tr><td>${esc(c.source)}</td><td>${okChip(c.ok, 'Works', 'Failing', 'Not set')}</td><td>${esc(c.detail)}</td></tr>`).join('')}</table></div>`;
const showProblems = (e) => `<div class="warnbox"><b>${esc(e.message)}</b><ul>${(e.body?.problems ?? []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;

// SLAs per priority (any names: P0, P1, Highest...), the working week they run in, and how support tickets are found.
const DAYNAMES = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
async function adminSettings() {
  const r = await adminApi('/settings'), s = r.settings;
  const [start, end] = s.workingHours.split('-');
  const covered = new Set(s.supportSla.map((x) => x.priority.toLowerCase()));
  const missing = r.prioritiesSeen.filter((p) => !covered.has(p.toLowerCase()));
  const row = (x = { priority: '', response: '', resolution: '' }) => `<tr class="slarow"><td><input name="priority" value="${esc(x.priority)}" placeholder="P1" aria-label="Priority"></td>
    <td><input name="response" value="${esc(x.response)}" placeholder="4h" aria-label="Time to respond"></td><td><input name="resolution" value="${esc(x.resolution)}" placeholder="2d" aria-label="Time to resolve"></td>
    <td><button type="button" class="btn small" data-admin="slarm" aria-label="Remove this priority">Remove</button></td></tr>`;
  return `<form class="card settingsform" id="settingsform" autocomplete="off">
    <p class="muted">${r.source === 'admin' ? 'Set in this page.' : 'From .env. Saving here replaces those values; Reset brings them back.'} Changes apply at once; past days in history keep what was measured then.</p>
    <h3>Support SLAs per priority</h3>
    <p class="note">Times are working time: <b>h</b> for hours, <b>d</b> for working days (one working day = the working day below). Priority names exactly as in Jira, for example P0, P1 or Highest.</p>
    <table class="t" id="slatable"><thead><tr><th>Priority</th><th>Respond within</th><th>Resolve within</th><th></th></tr></thead><tbody>${s.supportSla.map(row).join('')}</tbody></table>
    <p><button type="button" class="btn small" data-admin="slaadd">Add a priority</button></p>
    ${r.prioritiesSeen.length ? `<p class="note">Priorities on support tickets now: ${r.prioritiesSeen.map((p) => esc(p)).join(', ')}.${missing.length ? ` <span class="st amber"><i aria-hidden="true">●</i>No SLA yet for ${missing.map((p) => esc(p)).join(', ')}</span>: those tickets are not judged.` : ''}</p>` : ''}
    <h3 class="mt">Working week</h3>
    <div class="grid2">
      <label class="fld"><span>Working day starts</span><input type="time" name="start" value="${esc(start)}"></label>
      <label class="fld"><span>Working day ends</span><input type="time" name="end" value="${esc(end)}"></label>
      <label class="fld"><span>Time zone, hours from UTC</span><input type="number" name="tzOffset" step="0.5" value="${esc(s.tzOffset)}"><small class="muted">4 for the UAE</small></label>
      <fieldset class="fld days"><span>Weekend</span>${DAYNAMES.map(([v, l]) => `<label><input type="checkbox" name="weekend" value="${v}"${s.weekend.includes(v) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
    </div>
    <h3 class="mt">Which tickets are support</h3>
    <p class="note">For teams without their own support project (set per team in Teams): tickets in the team's project with one of these issue types, or one of these labels.</p>
    <div class="grid2">
      <label class="fld"><span>Issue types</span><textarea name="supportTypes" rows="3">${esc(s.supportTypes.join('\n'))}</textarea><small class="muted">One per line</small></label>
      <label class="fld"><span>Labels</span><textarea name="supportLabels" rows="3">${esc(s.supportLabels.join('\n'))}</textarea><small class="muted">One per line</small></label>
    </div>
    <h3 class="mt">Definition of Ready</h3>
    <p class="note">What a ticket needs before work starts. A started ticket that misses any ticked check counts as "started when not ready".</p>
    <fieldset class="fld checks">${Object.entries(r.checks.ready).map(([id, label]) => `<label><input type="checkbox" name="readyChecks" value="${esc(id)}"${s.readyChecks.includes(id) ? ' checked' : ''}> ${esc(label)}${id === 'size' ? `: at most <input type="number" name="maxPoints" min="1" step="1" value="${esc(s.maxPoints)}" aria-label="Largest ticket, in points"> points` : ''}</label>`).join('')}</fieldset>
    <h3 class="mt">Definition of Done</h3>
    <p class="note">What a ticket needs to count as done. Checks Houston cannot judge for a ticket (no GitHub data, no QA status in the team's workflow, no tests lane in GITHUB_LANES, ticket types that need no code) are left out for it, not failed.</p>
    <fieldset class="fld checks">${Object.entries(r.checks.done).map(([id, label]) => `<label><input type="checkbox" name="doneChecks" value="${esc(id)}"${s.doneChecks.includes(id) ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</fieldset>
    <div id="settingsresult"></div>
    <p><button type="button" class="btn primary" data-admin="savesettings">Save</button> ${r.source === 'admin' ? '<button type="button" class="btn" data-admin="resetsettings">Reset to .env</button>' : ''}</p>
  </form>`;
}
const formSettings = () => {
  const f = $('#settingsform'), fd = new FormData(f);
  return {
    supportSla: [...f.querySelectorAll('tr.slarow')].map((tr) => ({ priority: tr.querySelector('[name=priority]').value, response: tr.querySelector('[name=response]').value, resolution: tr.querySelector('[name=resolution]').value })),
    workingHours: `${fd.get('start')}-${fd.get('end')}`, tzOffset: fd.get('tzOffset'), weekend: fd.getAll('weekend'),
    supportTypes: String(fd.get('supportTypes') ?? ''), supportLabels: String(fd.get('supportLabels') ?? ''),
    readyChecks: fd.getAll('readyChecks'), doneChecks: fd.getAll('doneChecks'), maxPoints: fd.get('maxPoints'),
  };
};

// Change log: what admins changed.
async function adminLog() {
  const rows = await adminApi('/log');
  return rows.length ? `<div class="card scrollx"><table class="t sortable"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td data-sort="${esc(r.at)}">${esc(when(r.at))}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td>${esc(r.detail?.name ?? (Array.isArray(r.detail) ? r.detail.map((c) => `${c.source}: ${c.ok === true ? 'works' : c.ok === false ? 'failing' : 'not set'}`).join(', ') : ''))}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">No admin changes yet.</p>';
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest?.('[data-admin]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const act = el.dataset.admin, out = () => $('#teamresult');
  try {
    if (act === 'check') { el.disabled = true; el.textContent = 'Checking…'; await adminSend('POST', '/connections/check'); return adminPage('connections'); }
    if (act === 'new') { ADMIN.editing = { isNew: true, repos: [] }; await adminPage('teams'); return $('#teamform')?.scrollIntoView(); }
    if (act === 'edit') { ADMIN.editing = (await adminApi('/teams')).find((x) => x.name === el.dataset.team) ?? null; await adminPage('teams'); return $('#teamform')?.scrollIntoView(); }
    if (act === 'cancel') { ADMIN.editing = null; return adminPage('teams'); }
    if (act === 'test') { out().innerHTML = '<p class="muted">Testing…</p>'; out().innerHTML = showChecks((await adminSend('POST', '/teams/test', formTeam())).checks); return; }
    if (act === 'save') { await adminSend('POST', '/teams', formTeam()); ADMIN.editing = null; await adminPage('teams'); return; }
    if (act === 'slaadd') { const tb = $('#slatable tbody'); tb.insertAdjacentHTML('beforeend', `<tr class="slarow"><td><input name="priority" placeholder="P1" aria-label="Priority"></td><td><input name="response" placeholder="4h" aria-label="Time to respond"></td><td><input name="resolution" placeholder="2d" aria-label="Time to resolve"></td><td><button type="button" class="btn small" data-admin="slarm" aria-label="Remove this priority">Remove</button></td></tr>`); tb.lastElementChild.querySelector('input').focus(); return; }
    if (act === 'slarm') { el.closest('tr').remove(); return; }
    if (act === 'savesettings') { await adminSend('POST', '/settings', formSettings()); await adminPage('settings'); $('#settingsresult').innerHTML = '<p><span class="st green"><i aria-hidden="true">✓</i>Saved</span> Applies from now; the next collection recalculates the numbers.</p>'; return; }
    if (act === 'resetsettings') { if (!confirm('Go back to the SLAs and working week in .env?')) return; await adminSend('DELETE', '/settings'); return adminPage('settings'); }
    if (act === 'delete') { if (!confirm(`Remove ${el.dataset.team} from the admin setup? If .env also defines it, that version comes back.`)) return; await adminSend('DELETE', `/teams/${encodeURIComponent(el.dataset.team)}`); ADMIN.editing = null; return adminPage('teams'); }
  } catch (err) { const box = out() ?? $('#settingsresult'); if (box) box.innerHTML = err.body?.problems ? showProblems(err) : `<div class="warnbox">${esc(err.message)}</div>`; else alert(err.message); }
});
document.addEventListener('change', (e) => { if (e.target.dataset?.admin === 'filter') { ADMIN.filter = e.target.value; adminPage('tests'); } });
document.addEventListener('input', (e) => {
  if (e.target.dataset?.admin !== 'q') return;
  ADMIN.q = e.target.value; clearTimeout(ADMIN.t);
  ADMIN.t = setTimeout(async () => { const pos = e.target.selectionStart; await adminPage('tests'); const i = $('input[data-admin="q"]'); i?.focus(); i?.setSelectionRange(pos, pos); }, 250);
});
