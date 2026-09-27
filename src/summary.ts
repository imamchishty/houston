import { boardData } from './board.js';
import { bandFor, doraTier } from './metrics.js';
import { headcountGate } from './recommend.js';
import { featureCosts } from './cost.js';
import { rosterFor } from './identity.js';
import { config } from './config.js';
import type { Finding } from './types.js';

// One team on one card: what an IDP (Backstage entity page, portal tile) needs, and nothing per person.
const AREAS = [['sprint', 'Sprint process'], ['flow', 'Flow & DORA'], ['quality', 'Quality'], ['features', 'Features'], ['ops', 'Production & cost'], ['docs', 'Docs']] as const;

// Points each non-green check would add to its area score if it went green, biggest first.
export function scoreGains(areas: { name: string; findings: Finding[] }[], top = 5) {
  return areas.flatMap(({ name, findings }) => {
    const possible = findings.reduce((t, f) => t + (f.weight ?? 0), 0);
    return possible ? findings.filter((f) => f.rag !== 'green' && f.weight)
      .map((f) => ({ metric: f.ruleId, title: f.title, area: name, gain: Math.round(((f.weight! * (f.rag === 'amber' ? 0.5 : 1)) / possible) * 100) })) : [];
  }).sort((a, b) => b.gain - a.gain).slice(0, top);
}

export function teamSummary(board: string) {
  const b = boardData(board);
  if (!b.latest) return null;
  const byKey = { sprint: b.latest, flow: b.flow, quality: b.quality, features: b.features, ops: b.ops, docs: b.docs };
  const areas = AREAS.flatMap(([key, name]) => (byKey[key] ? [{ key, name, score: byKey[key]!.score, band: bandFor(byKey[key]!.score), findings: byKey[key]!.findings }] : []));
  const all = areas.flatMap((a) => a.findings);
  const prev = b.history[b.history.length - 2];
  const cost = config.cost.fteDay || config.cost.contractorDay
    ? featureCosts({ sprints: b.sprints, epics: b.raw.epics, rates: config.cost, roster: rosterFor(board), weekend: config.weekend })
    : null;
  const base = config.publicUrl;
  return {
    board,
    sprint: b.latest.sprintName,
    score: b.latest.score,
    band: bandFor(b.latest.score),
    change: prev ? b.latest.score - prev.score : 0,
    areas: areas.map(({ key, name, score, band }) => ({ area: key, name, score, band })),
    dora: all.flatMap((f) => { const tier = doraTier(f.ruleId, f.value); return tier ? [{ metric: f.ruleId, title: f.title, value: f.value, unit: f.unit, tier }] : []; }),
    gains: scoreGains(areas.map((a) => ({ name: a.name, findings: a.findings }))),
    headcountGateOpen: headcountGate({ card: b.latest, history: b.history, quality: b.quality, people: b.people }).ready,
    cost: cost && { currency: cost.currency, sprints: cost.sprints, teamCost: cost.teamCost, onFeaturesPct: cost.teamCost ? Math.round((cost.onFeatures / cost.teamCost) * 100) : 0, costPerPoint: cost.costPerPoint },
    links: { ui: `${base}/#${encodeURIComponent(board)}`, digest: `${base}/api/teams/${encodeURIComponent(board)}/digest.md`, api: `${base}/api/teams/${encodeURIComponent(board)}` },
  };
}
