import { config } from './config.js';
import { store } from './store/index.js';
import { scoreFlow } from './rules/flowRules.js';
import { scoreQuality } from './rules/qualityRules.js';
import { scoreFeatures } from './rules/featureRules.js';

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

// The digest headline for one board: scores and the top three red findings. No per person data, it goes to the whole team.
export function digestHeadline(board: string): { title: string; lines: string[] } | null {
  const latest = store.scorecards().filter((c) => c.board === board).sort((a, b) => b.sprintId - a.sprintId)[0];
  if (!latest) return null;
  const g = store.github().find((x) => x.board === board), q = store.quality().find((x) => x.board === board), epics = store.epics()[board] ?? [];
  const flow = g ? scoreFlow(g) : null, quality = q ? scoreQuality(q) : null, features = epics.length ? scoreFeatures(epics) : null;
  const gaps = [...latest.findings, ...(flow?.findings ?? []), ...(quality?.findings ?? [])].filter((f) => f.rag === 'red').slice(0, 3);
  const link = `${config.publicUrl}/api/teams/${encodeURIComponent(board)}/digest.md`;
  return {
    title: `Houston: ${latest.board}, ${md(latest.sprintName)}`,
    lines: [
      `Sprint ${latest.score} (${latest.rag})${flow ? `, flow ${flow.score}` : ''}${quality ? `, quality ${quality.score}` : ''}${features ? `, features ${features.score}` : ''}`,
      ...gaps.map((f) => `**${f.title}**: ${f.message}`),
      config.publicUrl ? `[Full digest](${link})` : `Full digest: /api/teams/${board}/digest.md (set HOUSTON_URL for a clickable link)`,
    ],
  };
}

export async function notifyBoard(board: string) {
  const d = digestHeadline(board);
  if (!d) return { board, posted: false, reason: 'No scorecards' };
  return { board, ...(await postToTeams(d.title, d.lines)) };
}

// Every board with scorecards. Run from the Friday job: `tsx src/cli.ts notify`.
export async function notifyAll() {
  const boards = [...new Set(store.scorecards().map((c) => c.board))];
  const out = [];
  for (const b of boards) out.push(await notifyBoard(b));
  return out;
}
