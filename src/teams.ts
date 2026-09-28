import { config } from './config.js';
import { boards, performance } from './performance.js';

// Posts a markdown-ish card to a Teams incoming webhook. Used for the Friday digest and the Monday note.
export async function postToTeams(title: string, lines: string[]) {
  if (!config.teamsWebhook) return { posted: false, reason: 'TEAMS_WEBHOOK not set' };
  const res = await fetch(config.teamsWebhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ '@type': 'MessageCard', '@context': 'https://schema.org/extensions', summary: title, themeColor: '2F5D9E', title, text: lines.join('\n\n') }),
  });
  return { posted: res.ok, status: res.status };
}

// Markdown escape for free text from Jira (sprint names), so it cannot inject links or formatting.
export const md = (s: string) => s.replace(/[\\`*_{}\[\]()<>#+!|~-]/g, (c) => '\\' + c);

// The weekly post for one team: its score and trend, the plain summary, and what has missed its target two periods
// running. Team level only: it goes to the whole channel.
export function digestHeadline(board: string, now = Date.now()): { title: string; lines: string[] } | null {
  const p = performance(board, 30, now);
  if (!p.score.of) return null;
  const s = p.score, twice = p.missed.filter((m) => m.missedTwice);
  const trend = s.previousPct == null ? '' : s.trend === 'better' ? `, up from ${s.previousPct}%` : s.trend === 'worse' ? `, down from ${s.previousPct}%` : ', no change';
  const link = config.publicUrl ? `${config.publicUrl}/#${encodeURIComponent(board)}` : '';
  return {
    title: `Houston: ${md(board)}`,
    lines: [
      `**${s.pct}% of targets met** (${s.met} of ${s.of}) over the last 30 days${trend}.`,
      md(p.summary),
      ...(twice.length ? [`Missed two periods running: ${twice.map((m) => md(m.title)).join(', ')}.`] : []),
      link ? `[Open ${md(board)} in Houston](${link})` : 'Set HOUSTON_URL for a link to the team page.',
    ],
  };
}

export async function notifyBoard(board: string) {
  const d = digestHeadline(board);
  if (!d) return { board, posted: false, reason: 'Nothing to judge yet' };
  return { board, ...(await postToTeams(d.title, d.lines)) };
}

// Every team. Run from the weekly job: `tsx src/cli.ts notify`.
export async function notifyAll() {
  const out = [];
  for (const b of boards()) out.push(await notifyBoard(b));
  return out;
}
