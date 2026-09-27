import type { GithubSnapshot } from './types.js';
import { median } from './cycle.js';

export interface GithubPersonStats {
  name: string;
  prsAuthored: number;
  prsMerged: number;
  linesChanged: number;
  medianPrSize: number;
  reviewsGiven: number;
  reviewShare: number;          // % of all reviews on the board
  medianPickupHoursAsReviewer: number | null; // how fast they pick up others' PRs
  lanes: string[];              // areas they touched
  crossLanePrs: number;         // PRs touching both frontend and backend
  noTicketPrs: number;
  hotfixPrs: number;
  lastActivity: string | null;
  flags: string[];              // plain English observations
}

export function githubPeople(s: GithubSnapshot, known: string[] = []): GithubPersonStats[] {
  const by = new Map<string, GithubPersonStats>();
  const get = (n: string) => {
    if (!by.has(n)) by.set(n, { name: n, prsAuthored: 0, prsMerged: 0, linesChanged: 0, medianPrSize: 0, reviewsGiven: 0, reviewShare: 0,
      medianPickupHoursAsReviewer: null, lanes: [], crossLanePrs: 0, noTicketPrs: 0, hotfixPrs: 0, lastActivity: null, flags: [] });
    return by.get(n)!;
  };
  for (const n of known) get(n);
  const sizes = new Map<string, number[]>(), pickups = new Map<string, number[]>();
  let totalReviews = 0;
  for (const p of s.prs) {
    const a = get(p.author);
    a.prsAuthored++; if (p.mergedAt) a.prsMerged++;
    a.linesChanged += p.additions + p.deletions;
    (sizes.get(a.name) ?? sizes.set(a.name, []).get(a.name)!).push(p.additions + p.deletions);
    for (const l of p.areas) if (!a.lanes.includes(l)) a.lanes.push(l);
    if (p.areas.includes('frontend') && p.areas.includes('backend')) a.crossLanePrs++;
    if (!p.jiraKeys.length) a.noTicketPrs++;
    if (p.isHotfix) a.hotfixPrs++;
    if (!a.lastActivity || p.createdAt > a.lastActivity) a.lastActivity = p.createdAt;
    for (const r of p.reviewers) {
      const rv = get(r); rv.reviewsGiven++; totalReviews++;
      if (!rv.lastActivity || (p.firstReviewAt ?? p.createdAt) > rv.lastActivity) rv.lastActivity = p.firstReviewAt ?? p.createdAt;
      if (p.firstReviewAt) (pickups.get(r) ?? pickups.set(r, []).get(r)!).push((new Date(p.firstReviewAt).getTime() - new Date(p.createdAt).getTime()) / 3_600_000);
    }
  }
  const daysWindow = (new Date(s.until).getTime() - new Date(s.since).getTime()) / 86_400_000;
  for (const p of by.values()) {
    p.medianPrSize = Math.round(median(sizes.get(p.name) ?? []));
    p.reviewShare = totalReviews ? Math.round((p.reviewsGiven / totalReviews) * 100) : 0;
    const pk = pickups.get(p.name); p.medianPickupHoursAsReviewer = pk?.length ? Math.round(median(pk)) : null;
    if (p.prsAuthored === 0 && p.reviewsGiven === 0) p.flags.push(`No commits, PRs or reviews in ${Math.round(daysWindow)} days.`);
    else if (p.prsAuthored <= 1 && p.reviewsGiven >= 10) p.flags.push(`Reviews only: ${p.reviewsGiven} reviews, ${p.prsAuthored} PR authored.`);
    if (p.reviewShare >= 40) p.flags.push(`Does ${p.reviewShare}% of all reviews. Bottleneck.`);
    if (p.prsAuthored >= 5 && p.crossLanePrs === 0 && p.lanes.filter((l) => l === 'frontend' || l === 'backend').length === 1) p.flags.push(`Stays in ${p.lanes.find((l) => l === 'frontend' || l === 'backend')} only.`);
    if (p.prsAuthored >= 5 && p.noTicketPrs / p.prsAuthored > 0.3) p.flags.push(`${Math.round((p.noTicketPrs / p.prsAuthored) * 100)}% of PRs have no ticket.`);
    if (p.medianPrSize > 800) p.flags.push(`Median PR ${p.medianPrSize} lines.`);
  }
  return [...by.values()].sort((a, b) => b.flags.length - a.flags.length || b.prsAuthored - a.prsAuthored);
}
