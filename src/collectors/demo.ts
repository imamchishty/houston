import type { Issue, Sprint } from '../types.js';

// Deterministic fake data for one struggling team (Ossi) over 6 sprints, plus a healthier comparison team.
// Lets Houston run end to end with no Jira access.

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const people = ['Aisha', 'Rahul', 'Omar', 'Priya', 'Tom', 'Fatima'];
const day = 86_400_000;

function makeSprint(board: string, n: number, health: number, seed: number, baseId: number): Sprint {
  const r = rng(seed);
  const start = new Date(Date.UTC(2026, 5, 1) + (n - 1) * 14 * day);
  const end = new Date(start.getTime() + 14 * day);
  const issues: Issue[] = [];
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
      status: done ? 'Done' : inProg ? 'In Progress' : 'To Do',
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
  // cycle time: size drives it, and two people on the weak team run slow
  for (const i of issues) {
    if (i.statusCategory !== 'done' || !i.inProgressSince) continue;
    const size = i.points ?? 3;
    const slow = health < 0.5 && (i.assignee === 'Tom' || i.assignee === 'Omar') && r() < 0.6 ? 2.5 : 1;
    const days = (0.6 + size * 0.7 + r() * 1.5) * slow;
    i.resolved = new Date(new Date(i.inProgressSince).getTime() + days * day).toISOString();
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
    out.push(makeSprint('OSSI', n, 0.25 + n * 0.02, 100 + n, 1000));
    out.push(makeSprint('PLAT', n, 0.8, 200 + n, 2000));
  }
  return out;
}
