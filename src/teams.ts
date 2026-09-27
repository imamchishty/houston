import { config } from './config.js';

// Posts a markdown-ish card to a Teams incoming webhook. Used for the Friday digest and the Monday note.
export async function postToTeams(title: string, lines: string[]) {
  if (!config.teamsWebhook) return { posted: false, reason: 'TEAMS_WEBHOOK not set' };
  const res = await fetch(config.teamsWebhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ '@type': 'MessageCard', '@context': 'https://schema.org/extensions', summary: title, themeColor: '2F5D9E', title, text: lines.join('\n\n') }),
  });
  return { posted: res.ok, status: res.status };
}
