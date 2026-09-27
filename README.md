# Houston

Engineering health checks for M42 teams. Pulls sprint data from Jira, scores each team
against a set of plain English rules, and tells the team what to fix first.

This repo: Jira sprint delivery and hygiene checks, GitHub flow and DORA checks, SonarQube and Testmo quality checks, per person views, recommendations, headcount gate, scorecard UI, retro digest, JSON API.
Phase 2: GitHub PR flow and quality. Phase 3: Confluence docs checks. Phase 4: DORA rollup and Apollo hooks.

## Run today

See `RUN-TODAY.md`: `npm install`, `npm run dev`, open http://localhost:4000. Demo data, no tokens.

## Going live this week

See `GO-LIVE.md`. Short version: fill `.env`, `npm run check`, fix any FAIL, `npm run collect && npm run score`, deploy with `deploy/azure.sh` or `deploy/docker-compose.yml`.

## Run it in 2 minutes (demo data, no Jira needed)

```
npm install
cp .env.example .env      # HOUSTON_MODE=demo is the default
npm run dev
```

Open http://localhost:4000

## Point it at real Jira

Edit `.env`:

```
HOUSTON_MODE=jira
JIRA_BASE_URL=https://m42.atlassian.net
JIRA_EMAIL=you@m42.ae
JIRA_API_TOKEN=...            # Cloud: API token. Data Center: leave JIRA_EMAIL blank, use a PAT.
JIRA_BOARDS=OSSI:42,PLAT:57   # DisplayName:boardId, the id is in the board URL (rapidView=42)
JIRA_POINTS_FIELD=customfield_10016
JIRA_AC_FIELD=                # optional custom field for acceptance criteria
```

Then `npm run dev`, or `npx tsx src/cli.ts` for a one-off collect and score.
Schedule that command nightly (cron, Azure Container Apps job, or GitHub Actions).

## GitHub (Enterprise Server or github.com)

```
GITHUB_API=https://github.m42.internal/api/v3    # GHES. For github.com: https://api.github.com
GITHUB_TOKEN=...                                  # read only PAT: repo read, read:org
GITHUB_REPOS=OSSI:m42/ossi-api|m42/ossi-web       # DisplayName:owner/repo|owner/repo
GITHUB_DAYS=90
GITHUB_LANES=frontend=web/,src/ui/;backend=api/,services/;infra=infra/,helm/;tests=test/,tests/;docs=docs/,*.md
GITHUB_DEPLOY_WORKFLOW=deploy                     # Actions workflow name that means a production deploy
TEAM_ROSTER=OSSI:aisha|rahul|karim|dinesh         # so people with zero activity still appear
```

Flow checks (12): pickup time, review to merge, PR size, stale PRs, merges without review, PRs with no Jira key,
review concentration, lane crossing, CI failure rate, and DORA deployment frequency, lead time and change failure rate.
Time to restore (DORA 4) needs incident data, planned for the Azure collector.

Per person from GitHub: PRs authored and merged, lines, median PR size, reviews given and share of all reviews,
pickup speed as a reviewer, lanes touched, cross lane PRs, PRs with no ticket, hotfixes, and plain English flags
("reviews only", "no activity in 90 days", "stays in backend only", "does 79% of reviews").

`GITHUB_LANES` maps path prefixes to areas. Edit it to match your repos; the lane crossing check depends on it.
First collection is slow (reviews and files per PR). Run it nightly and it stays current.

## SonarQube and Testmo

Add to `.env` (see `.env.example`). Each is optional; the quality score uses whatever is configured.

```
SONAR_URL=https://sonar.m42.internal
SONAR_TOKEN=...                 # user token with Browse on the projects
SONAR_PROJECTS=OSSI:m42-ossi    # DisplayName:sonarProjectKey
TESTMO_URL=https://m42.testmo.net
TESTMO_TOKEN=...                # Testmo API token
TESTMO_PROJECTS=OSSI:12         # DisplayName:testmoProjectId
```

Quality checks: quality gate, coverage (overall and on new code), vulnerabilities, Sonar bugs, duplication,
Testmo pass rate, run frequency, automation share, and bugs raised during the sprint from Jira.
Thresholds in `src/rules/qualityRules.ts`.

## Metric definitions

Every formula and threshold is in `METRICS.md`. Every finding links to its raw evidence in the UI.

## Identity and access

`PEOPLE=Aisha Khan=akhan|aisha.khan;Karim Haddad=karimh` maps Jira display names and GitHub logins to one person.
`TEAM_ROSTER=OSSI:Aisha Khan|Karim Haddad|...` lists who is on the team so zero activity still shows.
`HOUSTON_USER` and `HOUSTON_PASSWORD` turn on basic auth for everything. Outside demo mode Houston will not start without a password.
After 10 failed sign-ins from one address it answers 429 for 15 minutes. Serve it over HTTPS (your proxy or gateway), since basic auth sends the password with every request. `HOUSTON_PEOPLE_VIEWERS` restricts
the per person endpoints to named users; everyone else gets team level only. Recommendations name people only
for those viewers; everyone else, the digest and Teams posts get a count ("2 people, names in the people view").

## Security

- `npm audit` clean. CI fails on any high or critical advisory.
- Strict Content Security Policy (no inline script or style), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS when `HOUSTON_URL` is https.
- Every POST needs `X-Requested-With: houston` (the UI sends it), which blocks cross-site form posts:
  `curl -X POST -u user:pass -H 'X-Requested-With: houston' https://houston.internal/api/refresh`
- Refresh runs one at a time, at most every 5 minutes. Action log entries are validated and capped at 16 KB.
- Per person data (people view, names in recommendations, assignees and authors in raw evidence) only for `HOUSTON_PEOPLE_VIEWERS`.
- `.env` values are validated at startup and by `npm run check`, before they reach any API path or JQL/KQL query.
- Container runs compiled JS as the unprivileged `node` user, with a health check. Errors return a generic message; details go to the log.

## Friday digest in Teams

Set `TEAMS_WEBHOOK` and `HOUSTON_URL` (so the post links to the full digest). `npm run notify` posts every board's
headline: scores and the top three red findings, no names. `deploy/azure.sh` schedules it for 09:00 Gulf time on Fridays,
and the compose `nightly` service runs it on Fridays after the collect.

`npm run check` tests every configured connection and reports what it can see. Run it before the first collect.

## Docker

```
docker build -t houston .
docker run -p 4000:4000 -v houston-data:/data --env-file .env houston
```

## API

| Endpoint | Returns |
|---|---|
| `GET /api/teams` | Every team: latest score, RAG, 6 sprint trend, top 3 gaps |
| `GET /api/teams/:board` | Latest scorecard plus history for one team |
| `GET /api/teams/:board/digest.md` | Markdown retro digest, paste into Confluence. No names; people viewers can add `?named=1` |
| `GET /api/teams/:board/people` | Per person: tickets and points done, median cycle time vs team, tickets over the size norm, stuck, carried over |
| `GET /api/teams/:board/recommendations` | Ranked recommendations (pattern across findings, owner, steps) and the headcount gate |
| `GET /api/teams/:board/evidence/:ruleId` | The raw tickets, PRs, pages or epics behind one finding |
| `GET/POST /api/teams/:board/actions` | Action log: accepted, rejected, done per recommendation, with the numbers frozen at that moment and their movement since |
| `GET /api/rules` | The rules, thresholds and weights |
| `POST /api/teams/:board/notify` | Post the digest headline to Teams now |
| `POST /api/refresh` | Re-collect and re-score now |
| `GET /api/health` | Liveness |

## The checks

| Check | Amber | Red | Weight |
|---|---|---|---|
| Sprint commitment delivered | below 80% | below 60% | 25 |
| Carried over from earlier sprint | 20% | 40% | 15 |
| Stories without acceptance criteria | 15% | 35% | 15 |
| Scope added after sprint start | 15% | 30% | 10 |
| Items without an estimate | 10% | 25% | 10 |
| Items stuck in progress over 5 days | 2 | 4 | 10 |
| Tickets over double the team norm for their size | 15% | 30% | 15 |
| Share of sprint spent on bugs | 25% | 40% | 5 |
| In-progress items with no owner | 1 | 3 | 5 |
| Sprint has a goal | missing | missing | 5 |

Score: a green check earns its full weight, amber half, red none. 75 and above is green, 50 to 74 amber, below 50 red.
Thresholds live in `src/rules/sprintRules.ts`. Adding a rule is one object in that file.

## Recommendations and the headcount gate

`src/recommend.ts` reads all findings for a team together and matches patterns (unready intake, over commitment,
interrupts, stuck flow, quality debt, security, ownership). Each recommendation has the evidence, the owner,
a horizon and ordered steps. Top five by impact are shown on the team page and in the digest.

The headcount gate is three conditions that must hold before adding people: 80% of committed points delivered
for three consecutive sprints, 0% unestimated items for three sprints, and 70% coverage on new code.
Edit the targets in `headcountGate()`.

## Cycle time and the people view

Cycle time is In Progress to Done. Houston learns the team's median cycle time per story point size
from its own history, so "normal" means normal for that team. A ticket is flagged when it takes more
than double that norm (and at least 2 days over).

`/api/teams/:board/people` breaks the same numbers down by assignee. Two rules for using it:

1. Treat every line as a question, not a finding. The data cannot see who got the legacy tickets or who spent the sprint unblocking others.
2. Keep it off the shared team page in production and behind auth. Check with HR before per person metrics are stored or shown anywhere shared.

## Integrating with the IDP (Backstage)

Houston is API first, so the Backstage plugin is thin:

1. Annotate each catalog Component or Group with `houston.m42.ae/board: OSSI`.
2. A frontend plugin fetches `/api/teams/:board` and renders the score chip on the entity card
   and the full findings list on a Team Health tab.
3. Proxy config in `app-config.yaml`:

```yaml
proxy:
  '/houston':
    target: http://houston.internal:4000/api
```

The scorecard JSON shape is in `src/types.ts` and is stable. The bundled UI is optional once the plugin exists.

## Layout

```
src/
  collectors/jira.ts    Jira Agile API, changelog based carry-over and scope-add detection
  collectors/demo.ts    fixture generator, two teams over six sprints
  rules/sprintRules.ts  the checks (edit thresholds here)
  rules/engine.ts       scoring
  store/                JSON file store, swap for Postgres when needed
  index.ts              Fastify server and endpoints
  ui/index.html         scorecard page
  cli.ts                collect and score, for cron
```
