import type { Issue } from './types.js';

// Requirement churn, per ticket, from Jira's own history: edits to the description, title or acceptance criteria
// made after work started, and tickets sent back from in progress to to do. Houston cannot tell a clarification
// from a change of mind; over a sprint the pattern is what counts, and every row is a ticket to read.

export interface Churn { changes: number; by: string[]; fields: string[]; sentBack: boolean }

export function churn(i: Issue): Churn {
  const start = i.inProgressSince ? Date.parse(i.inProgressSince) : null;
  const after = start == null ? [] : (i.requirementEdits ?? []).filter((e) => Date.parse(e.at) > start);
  const h = i.statusHistory ?? [];
  // Sent back: a move to a to-do status after work had started.
  const sentBack = start != null && h.some((x) => x.category === 'new' && Date.parse(x.at) > start);
  return { changes: after.length, by: [...new Set(after.map((e) => e.by).filter((b): b is string => !!b))], fields: [...new Set(after.map((e) => e.field))], sentBack };
}
export const fieldWord = (f: string) => (f === 'summary' ? 'title' : f === 'acceptance' ? 'acceptance criteria' : f);
