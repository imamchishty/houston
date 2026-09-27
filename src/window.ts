import { config } from './config.js';
import type { Finding, Scorecard } from './types.js';

// The 90 day window: the clock the team is on, with the targets that open the headcount gate and a couple more.
export interface WindowTarget { rule: string; name: string; target: string; start: number | null; now: number | null; met: boolean; direction: 'up' | 'down'; }
export interface WindowStatus {
  active: boolean; start: string; end: string; daysLeft: number; sprintsLeft: number; sprintsDone: number;
  targets: WindowTarget[]; onTrack: boolean; verdict: string;
}

const targets: { rule: string; name: string; target: string; threshold: number; direction: 'up' | 'down'; source: 'sprint' | 'flow' | 'quality' | 'report' }[] = [
  { rule: 'commit_completion', name: 'Committed points delivered', target: '80%+', threshold: 80, direction: 'up', source: 'sprint' },
  { rule: 'no_estimate', name: 'Unestimated items', target: '0%', threshold: 0, direction: 'down', source: 'sprint' },
  { rule: 'no_acceptance_criteria', name: 'Stories without acceptance criteria', target: 'under 10%', threshold: 10, direction: 'down', source: 'sprint' },
  { rule: 'stale_in_progress', name: 'Work in progress far longer than normal', target: '1 or fewer', threshold: 1, direction: 'down', source: 'sprint' },
  { rule: 'new_code_coverage', name: 'Coverage on new code', target: '70%+', threshold: 70, direction: 'up', source: 'quality' },
  { rule: 'pickup_time', name: 'Time to first review', target: 'under 1 day', threshold: 1, direction: 'down', source: 'flow' },
  { rule: 'pr_review_rate', name: 'PRs reviewed by someone else', target: '95%+', threshold: 95, direction: 'up', source: 'report' },
];

// "At start" for sprint targets is the last sprint before the window; for the others it is the value the nightly
// snapshot recorded on or just before the window's first day (history database), or nothing if there was none yet.
export function windowStatus(history: Scorecard[], flow: Finding[] | undefined, quality: Finding[] | undefined,
  report: Record<string, number | null> = {}, recordedAt: (rule: string, source: string, day: string) => number | null = () => null): WindowStatus | null {
  if (!config.window.start) return null;
  const start = new Date(config.window.start), end = new Date(start.getTime() + config.window.days * 86_400_000), now = new Date();
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
  const inWindow = history.filter((h) => h.sprintEnd >= start.toISOString());
  const baseline = history.filter((h) => h.sprintEnd < start.toISOString()).slice(-1)[0] ?? history[0];
  const latest = history[history.length - 1];
  const val = (src: string, rule: string, card?: Scorecard) => {
    if (src === 'report') return report[rule] ?? null;
    const list = src === 'sprint' ? card?.findings : src === 'flow' ? flow : quality;
    return list?.find((f) => f.ruleId === rule)?.value ?? null;
  };
  const startDay = start.toISOString().slice(0, 10);
  const ts: WindowTarget[] = targets.map((t) => {
    const s = t.source === 'sprint' ? val(t.source, t.rule, baseline) : recordedAt(t.rule, t.source, startDay), n = val(t.source, t.rule, latest);
    const met = n != null && (t.direction === 'up' ? n >= t.threshold : n <= t.threshold);
    return { rule: t.rule, name: t.name, target: t.target, start: s, now: n, met, direction: t.direction };
  });
  const metCount = ts.filter((t) => t.met).length;
  const sprintsLeft = Math.ceil(daysLeft / 14);
  const onTrack = metCount >= Math.round(ts.length * (1 - daysLeft / config.window.days));
  return {
    active: now >= start && now <= end, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10),
    daysLeft, sprintsLeft, sprintsDone: inWindow.length, targets: ts, onTrack,
    verdict: now < start ? `Window starts ${start.toISOString().slice(0, 10)}. ${ts.length} targets, ${metCount} already met.`
      : daysLeft === 0 ? `Window closed. ${metCount} of ${ts.length} targets met.`
      : `${daysLeft} days and about ${sprintsLeft} sprints left. ${metCount} of ${ts.length} targets met. ${onTrack ? 'On track.' : 'Behind where it should be by now.'}`,
  };
}
