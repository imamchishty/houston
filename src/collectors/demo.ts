import type { Issue, Sprint } from '../types.js';

// Deterministic fake data for one struggling team (Ossi) over 6 sprints, plus a healthier comparison team.
// Lets Houston run end to end with no Jira access.

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// Matches the demo TEAM_ROSTER: Karim and Dinesh (OSSI) are on the roster but take no tickets.
const teams: Record<string, string[]> = { OSSI: ['Aisha', 'Rahul', 'Omar', 'Priya', 'Tom', 'Fatima'], PLAT: ['Lena', 'Yusuf', 'Mei', 'Sam'] };
const day = 86_400_000;

function makeSprint(board: string, n: number, health: number, seed: number, baseId: number, epicCount: number): Sprint {
  const r = rng(seed);
  // Six two-week sprints ending with the one in progress now: it started on this week's Monday.
  const monday = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); })();
  const start = new Date(monday - (6 - n) * 14 * day);
  const end = new Date(start.getTime() + 14 * day);
  const issues: Issue[] = [];
  const people = teams[board];
  const count = 18 + Math.floor(r() * 6);
  for (let i = 0; i < count; i++) {
    const type = r() < 0.15 + (1 - health) * 0.25 ? 'Bug' : r() < 0.8 ? 'Story' : 'Task';
    const carried = r() < (1 - health) * 0.5;
    const lateAdd = !carried && r() < (1 - health) * 0.4;
    const done = r() < 0.45 + health * 0.5;
    const inProg = !done && r() < 0.6;
    const addedAt = lateAdd ? new Date(start.getTime() + (2 + r() * 8) * day) : new Date(start.getTime() - 2 * day);
    issues.push({
      key: `${board}-${baseId + n * 100 + i}`,
      summary: `${type} ${i + 1}`,
      type,
      status: done ? 'Done' : inProg ? (r() < 0.35 ? 'In Review' : 'In Progress') : 'To Do',
      statusCategory: done ? 'done' : inProg ? 'inprogress' : 'todo',
      points: r() < (1 - health) * 0.35 ? null : [1, 2, 3, 5, 8][Math.floor(r() * 5)],
      assignee: inProg && r() < (1 - health) * 0.25 ? null : people[Math.floor(r() * people.length)],
      hasAcceptanceCriteria: r() > (1 - health) * 0.6,
      created: new Date(start.getTime() - 20 * day).toISOString(),
      resolved: done ? new Date(start.getTime() + (3 + r() * 10) * day).toISOString() : null,
      addedToSprintAt: addedAt.toISOString(),
      sprintIds: carried ? [baseId + n - 1, baseId + n] : [baseId + n],
      inProgressSince: inProg
        ? new Date(start.getTime() + (1 + r() * 12) * day).toISOString()
        : done ? new Date(start.getTime() + (0.5 + r() * 2) * day).toISOString() : null,
    });
  }
  // features: bugs are mostly unplanned work with no epic; stories and tasks spread over the board's epics (see demoEpics)
  for (const i of issues) i.epic = i.type === 'Bug' && r() < 0.7 ? null : `${board}-E${1 + Math.floor(r() * epicCount)}`;
  // Status paths, for flow efficiency and QA rejection: waits (Blocked, Ready for Review, Ready for QA) and QA bounces.
  // The weak team waits longer and bounces more. Times are spread between start and resolution (or now).
  const histories = (i: Issue, end: number) => {
    const start = Date.parse(i.inProgressSince!), span = Math.max(end - start, 3_600_000);
    const steps: [string, string, number][] = [['In Progress', 'indeterminate', 0.35 + r() * 0.1]];
    if (r() < (health < 0.5 ? 0.35 : 0.08)) steps.push(['Blocked', 'indeterminate', 0.1 + r() * 0.1]);
    steps.push(['Ready for Review', 'indeterminate', health < 0.5 ? 0.15 + r() * 0.1 : 0.04], ['In Review', 'indeterminate', 0.08]);
    steps.push(['Ready for QA', 'indeterminate', health < 0.5 ? 0.12 : 0.03], ['QA', 'indeterminate', 0.08]);
    if (r() < (health < 0.5 ? 0.3 : 0.06)) steps.push(['In Progress', 'indeterminate', 0.08], ['QA', 'indeterminate', 0.05]);
    const total = steps.reduce((t, x) => t + x[2], 0);
    let t = start; const h = [{ at: new Date(Date.parse(i.created)).toISOString(), to: 'To Do', category: 'new' }];
    for (const [to, category, w] of steps) { h.push({ at: new Date(t).toISOString(), to, category }); t += (span * w) / total; }
    return h;
  };
  // cycle time: size drives it, and two people on the weak team run slow
  for (const i of issues) {
    if (i.statusCategory !== 'done' || !i.inProgressSince) continue;
    const size = i.points ?? 3;
    const slow = health < 0.5 && (i.assignee === 'Tom' || i.assignee === 'Omar') && r() < 0.6 ? 2.5 : 1;
    const days = (0.6 + size * 0.7 + r() * 1.5) * slow;
    i.resolved = new Date(new Date(i.inProgressSince).getTime() + days * day).toISOString();
  }
  // The sprint in progress cannot have work finished in the future: anything "done" later than now is still in progress.
  const now = Date.now();
  if (n === 6) for (const i of issues) {
    if (i.resolved && Date.parse(i.resolved) > now) Object.assign(i, { resolved: null, statusCategory: 'inprogress', status: 'In Progress' });
    if (i.inProgressSince && Date.parse(i.inProgressSince) > now) Object.assign(i, { inProgressSince: null, statusCategory: 'todo', status: 'To Do' });
    if (i.addedToSprintAt && Date.parse(i.addedToSprintAt) > now) i.addedToSprintAt = new Date(now - day).toISOString();
  }
  // Status histories last, once resolution times and the in-progress sprint are final.
  for (const i of issues) {
    if (!i.inProgressSince) { i.statusHistory = [{ at: i.created, to: 'To Do', category: 'new' }]; continue; }
    const done = i.statusCategory === 'done' && i.resolved;
    const stop = done ? Date.parse(i.resolved!) : Math.min(Date.now(), end.getTime());
    const h = histories(i, stop);
    if (done) h.push({ at: i.resolved!, to: 'Done', category: 'done' });
    else { const last = h[h.length - 1]; i.status = last.to; } // an open ticket's status is where its history ends
    i.statusHistory = h;
  }
  return {
    id: baseId + n,
    name: `${board} Sprint ${n + 8}`,
    board,
    goal: health > 0.5 || r() > 0.6 ? `Ship increment ${n} of the ${board} roadmap` : null,
    start: start.toISOString(),
    end: end.toISOString(),
    state: n === 6 ? 'active' : 'closed',
    issues,
  };
}

export function demoSprints(): Sprint[] {
  const out: Sprint[] = [];
  for (let n = 1; n <= 6; n++) {
    out.push(makeSprint('OSSI', n, 0.25 + n * 0.02, 100 + n, 1000, 8));
    out.push(makeSprint('PLAT', n, 0.8, 200 + n, 2000, 7));
  }
  return out;
}
