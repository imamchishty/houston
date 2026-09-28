import { config } from './config.js';
import { boards, performance } from './performance.js';
import { currentSprint } from './sprintNow.js';
import { monthlyReport, monthOf, prevMonth } from './monthly.js';
import { history } from './store/history.js';
import { metricById, metricCatalogue } from './metrics.js';
import { weeklyNote } from './note.js';
import { PERIODS, type Period } from './reports.js';
import { compassChat, compassConfigured, numbersOnlyFrom } from './compass.js';

// Ask Houston: a question about a team or all teams, answered from Houston's own numbers. Compass picks which of a
// fixed set of Houston lookups to run (it never queries anything itself), Houston runs them, and Compass writes the
// answer from those facts. Every number in the answer must be in the facts, or the facts are shown instead. Questions
// about people are refused before anything is sent: Houston measures teams, not people.

export interface ChatAnswer { answer: string; basedOn: { title: string; href: string }[]; refused?: boolean; fromFacts?: boolean }

// Anything asking about a person. Houston holds no roster and shows no per person numbers, so there is nothing to answer.
const PEOPLE = /\b(who|whose|whom|person|people|individual|individuals|someone|anyone|engineer|engineers|developer|developers|dev|devs|assignee|assignees|member|members|staff|headcount|manager|lead|leads|owner|owners|name|names)\b/i;
export const aboutPeople = (q: string) => PEOPLE.test(q);
const REFUSAL = 'Houston measures teams, not people. It holds no list of who is on a team and no per person numbers, so it cannot answer that. Ask about a team\'s measures, its sprint, or a month.';

// The lookups Compass may ask for. Each returns compact facts (no definitions, no failing-item lists, no assignees).
type Lookup = { name: string; describe: string; run: (a: Record<string, unknown>) => { facts: unknown; link: { title: string; href: string } } | null };
const period = (v: unknown): Period => ((PERIODS as readonly number[]).includes(Number(v)) ? (Number(v) as Period) : 30);
const team = (v: unknown, fallback: string) => (typeof v === 'string' && (v === 'all' || boards().includes(v)) ? v : fallback);
const slim = (m: { id: string; title: string; value: number | null; unit: string; target: unknown; met: boolean | null; previous?: number | null; trend?: string | null; num?: number | null; den?: number | null }) =>
  ({ id: m.id, title: m.title, value: m.value, unit: m.unit, target: m.target, met: m.met, previous: m.previous ?? null, trend: m.trend ?? null, count: m.num != null && m.den != null ? `${m.num} of ${m.den}` : undefined });

const LOOKUPS: Lookup[] = [
  { name: 'performance', describe: 'A team (or "all") on its headline measures with drill-down, score and missed targets. args: team, days (7|30|90)',
    run: (a) => { const t = team(a.team, 'all'), p = performance(t, period(a.days));
      return { facts: { team: t, days: p.days, score: p.score, summary: p.summary, missed: p.missed.map((m) => ({ id: m.id, title: m.title, missedTwice: m.missedTwice })),
        areas: p.areas.map((ar) => ({ area: ar.title, headlines: ar.headlines.map((h) => ({ ...slim(h.measure), drill: h.drill.map(slim) })) })) }, link: { title: `${t === 'all' ? 'All teams' : t}, last ${p.days} days`, href: `#${encodeURIComponent(t)}` } }; } },
  { name: 'teams', describe: 'Every team with its score and summary, last 30 days, to compare teams. args: none',
    run: () => ({ facts: boards().map((b) => { const p = performance(b, 30); return { team: b, score: p.score, summary: p.summary, missed: p.missed.map((m) => m.title) }; }), link: { title: 'Dashboard', href: '#' } }) },
  { name: 'sprint', describe: 'The sprint in progress for a team: points, days, outlook, blocked and ageing items (no people). args: team',
    run: (a) => { const t = team(a.team, ''); if (!t || t === 'all') return null; const cs = currentSprint(t, false); if (!cs) return null;
      return { facts: { team: t, sprint: cs.sprint, state: cs.state, outlook: cs.outlook, points: cs.points, workingDays: cs.workingDays, workingDaysLeft: cs.workingDaysLeft, workingDaysElapsed: cs.workingDaysElapsed, unestimated: cs.unestimated,
        blocked: cs.blocked.map((b) => ({ key: b.key, summary: b.summary, status: b.status, workingDaysThere: b.days })), ageing: cs.ageing.map((x) => ({ key: x.key, summary: x.summary, daysInProgress: x.days, normal: x.typical })) }, link: { title: `${t}: current sprint`, href: `#${encodeURIComponent(t)}/sprint` } }; } },
  { name: 'monthly', describe: 'The monthly report for a team (or "all") for a month (YYYY-MM, default last month): each key number against the month before. args: team, month',
    run: (a) => { const t = team(a.team, 'all'), m = typeof a.month === 'string' && /^\d{4}-\d{2}$/.test(a.month) ? a.month : prevMonth(monthOf(Date.now())); const r = monthlyReport(t, m);
      return { facts: { team: t, month: r.name, status: r.status, summary: r.summary, headline: r.headline.map((h) => ({ id: h.id, title: h.title, value: h.value, previous: h.previous, change: h.change, trend: h.trend, met: h.met, unit: h.unit })), improved: r.improved, worse: r.worse }, link: { title: `Monthly report, ${r.name}`, href: '#_monthly' } }; } },
  { name: 'history', describe: 'A team\'s score or one headline measure by day, for a trend. args: team, metric (score or a measure id), days',
    run: (a) => { const t = team(a.team, ''); if (!t || t === 'all') return null; const id = String(a.metric ?? 'score'); const key = id === 'score' ? 'score' : `r:${id}`;
      const h = history(t, [key], Math.min(Number(a.days) || 90, 365)); const s = h.series[key] ?? []; if (!s.length) return null;
      return { facts: { team: t, metric: id, first: s[0], last: s[s.length - 1], points: s.length, series: s.filter((_, i) => i % Math.max(1, Math.floor(s.length / 12)) === 0) }, link: { title: `${t}: history`, href: `#${encodeURIComponent(t)}` } }; } },
  { name: 'define', describe: 'What a measure means, why it matters, how it is calculated, its target. args: measure (id or name)',
    run: (a) => { const q = String(a.measure ?? '').toLowerCase(); const m = metricById(q) ?? metricCatalogue().find((x) => x.name.toLowerCase() === q) ?? metricCatalogue().find((x) => x.name.toLowerCase().includes(q));
      return m ? { facts: { id: m.id, name: m.name, area: m.area, headline: m.headline, why: m.why, how: m.how, target: m.target }, link: { title: `Metrics: ${m.name}`, href: `#_metrics` } } : null; } },
  { name: 'note', describe: 'The weekly note for a team: what changed, what moved with it, what is likely next. args: team',
    run: (a) => { const t = team(a.team, 'all'); const n = weeklyNote(t); return n ? { facts: { team: t, note: n.lines }, link: { title: `${t === 'all' ? 'All teams' : t}: this week`, href: `#${encodeURIComponent(t)}` } } : null; } },
];

const MAX_CALLS = 4;
function parseCalls(text: string): { tool: string; args: Record<string, unknown> }[] {
  try {
    const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const calls = Array.isArray(j?.calls) ? j.calls : [];
    return calls.filter((c: any) => c && typeof c.tool === 'string' && LOOKUPS.some((l) => l.name === c.tool)).slice(0, MAX_CALLS)
      .map((c: any) => ({ tool: c.tool, args: c.args && typeof c.args === 'object' ? c.args : {} }));
  } catch { return []; }
}

// Plain text from the facts, when Compass's answer cannot be trusted or is missing.
function plainFacts(results: { tool: string; facts: any }[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (r.tool === 'performance') parts.push(`${r.facts.team === 'all' ? 'All teams' : r.facts.team}, last ${r.facts.days} days: ${r.facts.summary}`);
    else if (r.tool === 'teams') for (const t of r.facts) parts.push(`${t.team}: ${t.summary}`);
    else if (r.tool === 'sprint') parts.push(`${r.facts.sprint} is ${String(r.facts.outlook).toLowerCase()}: ${r.facts.points.done} of ${r.facts.points.scope} points done, ${r.facts.workingDaysLeft} working days left; ${r.facts.blocked.length} blocked or waiting, ${r.facts.ageing.length} ageing.`);
    else if (r.tool === 'monthly') parts.push(r.facts.summary);
    else if (r.tool === 'history') parts.push(`${r.facts.team} ${r.facts.metric}: ${r.facts.first.value} on ${r.facts.first.day}, ${r.facts.last.value} on ${r.facts.last.day}.`);
    else if (r.tool === 'define') parts.push(`${r.facts.name}: ${r.facts.why} How: ${r.facts.how}${r.facts.target ? ` Target: ${r.facts.target}.` : ''}`);
    else if (r.tool === 'note') parts.push(...r.facts.note.map((l: string) => l.replace(/\*\*/g, '')));
  }
  return parts.length ? `Here is what Houston found:\n\n${parts.join('\n\n')}` : 'Houston found nothing for that question. Try asking about a team, its sprint, a measure, or a month.';
}

export const chatEnabled = () => compassConfigured();

export async function ask(question: string, scope: string): Promise<ChatAnswer> {
  const q = question.trim().slice(0, 500);
  if (aboutPeople(q)) return { answer: REFUSAL, basedOn: [], refused: true };
  const teamsList = boards();
  const context = scope !== 'all' && teamsList.includes(scope) ? `The person is looking at team ${scope}: use team "${scope}" unless the question names another team or asks about all teams.` : 'The person is looking at the dashboard of all teams.';
  // 1. Which lookups to run.
  const plan = await compassChat([
    { role: 'system', content: `You choose which lookups to run to answer a question about engineering team performance. Teams: ${teamsList.join(', ')} (or "all"). Lookups:\n${LOOKUPS.map((l) => `- ${l.name}: ${l.describe}`).join('\n')}\n${context}\nReply with JSON only: {"calls":[{"tool":"name","args":{...}}]} with at most ${MAX_CALLS} calls. Never ask about people.` },
    { role: 'user', content: q },
  ], { json: true, timeoutMs: 15_000, maxTokens: 300 });
  let calls = plan ? parseCalls(plan) : [];
  if (!calls.length) calls = [{ tool: 'performance', args: { team: scope, days: 30 } }];
  // The page's team wins over the model's choice unless the question clearly asks about others.
  const results: { tool: string; facts: unknown; link: { title: string; href: string } }[] = [];
  for (const c of calls) {
    const l = LOOKUPS.find((x) => x.name === c.tool)!;
    const r = l.run(scope !== 'all' && !/\b(all teams|other team|compare|versus|vs\.?|every team)\b/i.test(q) && c.tool !== 'teams' && c.tool !== 'define' ? { ...c.args, team: scope } : c.args);
    if (r) results.push({ tool: c.tool, ...r });
  }
  const basedOn = [...new Map(results.map((r) => [r.link.href, r.link])).values()];
  const facts = JSON.stringify(results.map((r) => ({ [r.tool]: r.facts })));
  // 2. The answer, from the facts only.
  const answer = await compassChat([
    { role: 'system', content: 'Answer the question from the FACTS only, in plain English for a busy engineering manager, in at most 120 words. Use only numbers that appear in the facts, written the same way. If the facts do not answer it, say what Houston does not know. Never name, guess at or judge people; the numbers are about teams. No advice unless asked. No headings or lists longer than four items.' },
    { role: 'user', content: `Question: ${q}\n\nFACTS: ${facts}` },
  ], { timeoutMs: 20_000, maxTokens: 400 });
  if (!answer || !numbersOnlyFrom(answer, facts) || aboutPeople(answer.replace(/\bpeople\b/gi, ''))) return { answer: plainFacts(results), basedOn, fromFacts: true };
  return { answer, basedOn };
}

export const chatSettings = () => ({ enabled: chatEnabled(), model: chatEnabled() ? config.compass.model : null });
