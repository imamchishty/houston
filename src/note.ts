import { performance, PLAIN } from './performance.js';
import { currentSprint } from './sprintNow.js';
import type { Measure } from './reports.js';

// The weekly note: what changed, why, and what is likely next, for one team, in plain English. Built from the
// measures Houston already has, by rules, so it is exact and testable. Every sentence carries the numbers it rests
// on. It says what moved with a headline (a drill-down measure that changed the same way), never who, and never
// grades the team. composeNote is pure: it takes the performance result and the sprint, so tests can feed exact numbers.

export interface Note {
  team: string; period: { days: number; from: string; to: string };
  score: { pct: number | null; previousPct: number | null; met: number; of: number };
  changes: Change[];           // headline measures that moved, biggest first
  sprint: SprintOutlook | null;
  lines: string[];             // the note, one paragraph per line; **bold** is the only markup
}
export interface Change { id: string; title: string; from: number; to: number; unit: string; better: boolean; met: boolean | null; driver: Driver | null }
export interface Driver { id: string; title: string; from: number; to: number; unit: string; text: string }
export interface SprintOutlook { name: string; outlook: string; done: number; scope: number; projected: number; daysLeft: number; daysElapsed: number; needPerDay: number | null; blocked: number; ageing: number }

// What composeNote reads: the shape /api/teams/:board returns, and the sprint board.
export interface PerfLike {
  from: string; to: string; summary: string;
  score: { pct: number | null; previousPct: number | null; met: number; of: number; trend: string | null };
  missed: { id: string; title: string; missedTwice: boolean }[];
  areas: { headlines: { measure: Measure; drill: Measure[] }[] }[];
}
export interface SprintLike { sprint: string; state: string; outlook: string; points: { done: number; scope: number; projected: number }; workingDaysLeft: number; workingDaysElapsed: number; blocked: unknown[]; ageing: unknown[] }

const r1 = (v: number) => Math.round(v * 10) / 10;
const unitWord = (m: { id: string; unit: string }) => (m.id === 'deploy_frequency' ? ' a week' : m.unit === '%' ? '%' : m.unit === 'count' ? '' : ` ${m.unit}`);
const fmt = (v: number, m: { id: string; unit: string }) => `${r1(v)}${unitWord(m)}`;
const plainTitle = (m: Measure) => m.title.replace(/ \(median\)$/, '').replace(/ \(DORA\)$/, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Lower-case a title mid-sentence, leaving acronyms (PR, CI, SLA) alone.
const low = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
// How much a value moved, relative, so a 2 to 4 day lead time (100%) outranks 60% to 62% completion.
const movement = (m: Measure) => (m.previous == null || m.value == null ? 0 : Math.abs(m.value - m.previous) / Math.max(Math.abs(m.previous), 1));

// The drill-down measure that moved the same way as the headline, and most. A measure with a target must have got
// worse when the headline got worse (or better when better). One without a target has no "worse", so only more of it
// can explain a worse headline, and only less of it a better one.
export function driverFor(head: Measure, drill: Measure[]): Driver | null {
  const worse = head.trend === 'worse';
  const fits = (d: Measure) => (d.target ? d.trend === (worse ? 'worse' : 'better') : worse ? d.value! > d.previous! : d.value! < d.previous!);
  const d = drill.filter((x) => x.previous != null && x.value != null && movement(x) >= 0.15 && fits(x)).sort((a, b) => movement(b) - movement(a))[0];
  if (!d) return null;
  const verb = d.target ? (worse ? 'got worse' : 'improved') : worse ? 'rose' : 'fell';
  return { id: d.id, title: plainTitle(d), from: d.previous!, to: d.value!, unit: d.unit, text: `${low(plainTitle(d))} ${verb} from ${fmt(d.previous!, d)} to ${fmt(d.value!, d)}` };
}

export function composeNote(team: string, p: PerfLike, cs: SprintLike | null): Note {
  const heads = p.areas.flatMap((a) => a.headlines);
  // What changed: headlines that moved by 10% or more relative, or crossed their target; biggest movement first, at most three.
  const changes: Change[] = heads
    .filter((h) => h.measure.previous != null && h.measure.value != null && !h.measure.smallSample && (movement(h.measure) >= 0.1 || h.measure.met !== h.measure.previousMet))
    .sort((a, b) => movement(b.measure) - movement(a.measure))
    .slice(0, 3)
    .map((h) => ({ id: h.measure.id, title: plainTitle(h.measure), from: h.measure.previous!, to: h.measure.value!, unit: h.measure.unit,
      better: h.measure.trend === 'better', met: h.measure.met, driver: driverFor(h.measure, h.drill) }));

  const sprint: SprintOutlook | null = cs && cs.state === 'active' ? {
    name: cs.sprint, outlook: cs.outlook, done: cs.points.done, scope: cs.points.scope, projected: cs.points.projected, daysLeft: cs.workingDaysLeft, daysElapsed: cs.workingDaysElapsed,
    needPerDay: cs.workingDaysLeft ? r1((cs.points.scope - cs.points.done) / cs.workingDaysLeft) : null, blocked: cs.blocked.length, ageing: cs.ageing.length,
  } : null;

  const s = p.score, lines: string[] = [];
  // 1. The score, what is missed, and for how long.
  const trend = s.previousPct == null ? '' : s.trend === 'better' ? `, up from ${s.previousPct}%` : s.trend === 'worse' ? `, down from ${s.previousPct}%` : ', unchanged';
  const twice = p.missed.filter((m) => m.missedTwice), name = (m: { id: string; title: string }) => PLAIN[m.id] ?? m.title.toLowerCase();
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  let first = `**${s.pct}% of targets met** (${s.met} of ${s.of}) over the last 30 days${trend}.`;
  if (p.missed.length) {
    first += ` Missing: ${list(p.missed.map(name))}.`;
    if (twice.length === p.missed.length) first += p.missed.length === 1 ? ' Two periods running.' : ' All of them two periods running.';
    else if (twice.length) first += ` Two periods running: ${list(twice.map(name))}.`;
  }
  lines.push(first);
  // 2. What changed, and what moved with it.
  if (changes.length) {
    lines.push('**What changed.** ' + changes.map((c) => {
      const m = { id: c.id, unit: c.unit };
      const status = c.met === false && c.better ? ' Still short of the target.' : c.met === true && !c.better ? ' Still within target.' : '';
      return `${c.title} ${c.better ? 'improved' : 'got worse'}: ${fmt(c.from, m)} to ${fmt(c.to, m)}.${c.driver ? ` What moved with it: ${c.driver.text}.` : ''}${status}`;
    }).join(' '));
  } else lines.push('**What changed.** Nothing moved by much: every headline is within 10% of the 30 days before.');
  // 3. What is likely next: the sprint in progress. Under two working days in, there is no pace to project from.
  if (sprint) {
    const days = (n: number) => `${n} working ${n === 1 ? 'day' : 'days'}`;
    const stuck = [sprint.blocked ? `${sprint.blocked} ${sprint.blocked === 1 ? 'item is' : 'items are'} blocked or waiting` : '', sprint.ageing ? `${sprint.ageing} ${sprint.ageing === 1 ? 'has' : 'have'} been in progress far longer than normal` : ''].filter(Boolean);
    const stuckText = stuck.length ? ` ${cap(stuck.join(', and '))}.` : '';
    if (sprint.daysElapsed < 2) lines.push(`**Likely next.** ${sprint.name} has just started: ${sprint.done} of ${sprint.scope} points done, ${days(sprint.daysLeft)} left. Too early to project.${stuckText}`);
    else {
      const need = sprint.needPerDay != null && sprint.projected < sprint.scope ? ` Finishing the plan needs ${sprint.needPerDay} points a day for the remaining ${days(sprint.daysLeft)}.` : '';
      lines.push(`**Likely next.** ${sprint.name} is ${sprint.outlook.toLowerCase()}: ${sprint.done} of ${sprint.scope} points done with ${days(sprint.daysLeft)} left. At the current pace it finishes about ${sprint.projected} of ${sprint.scope} points.${need}${stuckText}`);
    }
  }
  return { team, period: { days: 30, from: p.from, to: p.to }, score: { pct: s.pct, previousPct: s.previousPct, met: s.met, of: s.of }, changes, sprint, lines };
}

export function weeklyNote(board: string, now = Date.now()): Note | null {
  const p = performance(board, 30, now);
  if (!p.score.of) return null;
  return composeNote(board, p, board === 'all' ? null : currentSprint(board, false, now));
}
