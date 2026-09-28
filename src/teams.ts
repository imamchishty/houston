import { config } from './config.js';
import { boards } from './performance.js';
import { weeklyNote } from './note.js';

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

// The weekly post for one team: the note (what changed, why, what is likely next), with a link to the team page.
// Team level only: it goes to the whole channel.
export function digestHeadline(board: string, now = Date.now()): { title: string; lines: string[] } | null {
  const n = weeklyNote(board, now);
  if (!n) return null;
  const link = config.publicUrl ? `${config.publicUrl}/#${encodeURIComponent(board)}` : '';
  return { title: `Houston: ${md(board)}`, lines: [...n.lines.map((l) => mdKeep(l)), link ? `[Open ${md(board)} in Houston](${link})` : 'Set HOUSTON_URL for a link to the team page.'] };
}
// Escape free text from Jira (sprint names) inside a note line, keeping the note's own **bold**.
const mdKeep = (line: string) => line.split('**').map((part, i) => (i % 2 ? part : md(part).replace(/\\\./g, '.').replace(/\\,/g, ','))).join('**');

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
