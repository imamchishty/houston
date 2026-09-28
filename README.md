# Houston

How M42 teams are performing. Houston reads Jira, GitHub (Enterprise), SonarQube, Testmo and Azure, and shows each
team on **10 headline measures** in five areas:

| Area | The question | Headline measures |
|---|---|---|
| Planning | Did we deliver what we planned? | Sprint completion (drill-down: predicted vs actual per sprint, scope added, unplanned work, carried over) |
| Execution | Does work flow and reach users fast, and where is time wasted? | Deployment frequency, lead time for changes, flow efficiency (drill-down: where tickets wait, blocked now, ageing work) |
| Quality | Are we shipping good work? | Bugs reaching customers, time spent on bugs |
| Stability and support | How often do things break, how fast do we recover, are customers helped in time? | Change failure rate, time to restore, support resolved within SLA |
| Security | Are serious security issues fixed in time? | Critical and high issues fixed on time |

Each headline has a target. A team's **score** is the share of its headline targets met, with the trend against the
period before. Everything else is drill-down: under each headline, the measures and charts that explain it. Nothing is
per person. Definitions, targets and why each matters: `METRICS.md` (generated from the code).

Pages: **Dashboard** (every team on the 10 measures, alphabetical), **Team** (click a team: score, missed targets,
each headline with what drives it, the current sprint), **Monthly** (a month against the one before, six months of trend).
The footer links to Metrics, Data checks and Admin.

## Run it in 2 minutes (demo data, no tokens)

```
npm install
npm run dev
```

Open http://localhost:4000. For the admin section add `HOUSTON_ADMIN_USER` and `HOUSTON_ADMIN_PASSWORD` to `.env`.
Needs Node.js 22.13 or newer. **New to Node or Azure? Follow `SETUP.md`**: step by step from installing Node to running on Azure.

## Going live

See `GO-LIVE.md`. Short version: fill `.env` (start from `.env.example`), `npm run check`, fix any FAIL, `npm run collect`,
deploy from GitHub with one click (Actions, Deploy to Azure; one-time setup in `SETUP.md` part 3), or run `deploy/azure.sh`
yourself. Choose `INGRESS=internal` with a company VNet, or `INGRESS=external` with `ALLOWED_IPS`. Teams, SLAs and the working week can also be changed later in the admin page.

### Jira

```
HOUSTON_MODE=jira
JIRA_BASE_URL=https://m42.atlassian.net
JIRA_EMAIL=you@m42.ae
JIRA_API_TOKEN=...            # Cloud: API token. Data Center: leave JIRA_EMAIL blank, use a PAT.
JIRA_BOARDS=OSSI:42,PLAT:57   # Team:boardId, the id is in the board URL
JIRA_PROJECTS=OSSI:OSS        # Team:project key, when it differs from the team name
```

Support tickets are plain Jira: a separate project per team (`SUPPORT_PROJECTS`), or support issue types and labels in the
team's own project. SLAs per priority in working time: `SUPPORT_SLA`, `WORKING_HOURS`, `WEEKEND`, `TZ_OFFSET_HOURS`.

### GitHub (Enterprise Server or github.com)

```
GITHUB_API=https://github.m42.internal/api/v3    # GHES. For github.com: https://api.github.com
GITHUB_TOKEN=...                                  # read only: repo, read:org, security_events
GITHUB_REPOS=OSSI:m42/ossi-api|m42/ossi-web       # Team:owner/repo|owner/repo
GITHUB_DEPLOY_WORKFLOW=deploy                     # the Actions workflow that means a production deploy
SECURITY_DEADLINE_DAYS=critical:7,high:30,medium:90
```

### SonarQube, Testmo, Azure

Optional, per team: `SONAR_PROJECTS`, `TESTMO_PROJECTS`, `AZURE_APPINSIGHTS` (server errors, availability) and
`AZURE_RESOURCE_GROUPS` with `AZURE_LOG_WORKSPACE` (incidents, time to restore). See `.env.example`.

## History and backups

`history.db` (SQLite, built into Node) keeps each day's score and every measure, so trends keep growing beyond what the
tools still return. Each completed month's numbers are saved for good for the monthly report.

- Each night's snapshot is one transaction; re-running a day replaces it. A consistent copy goes to `backups/history-YYYY-MM-DD.db`; the last `HOUSTON_BACKUP_DAYS` (30) are kept.
- Keep the data folder on persistent storage. `deploy/azure.sh` reuses the same Azure Files share on every deploy and mounts it on the app and both jobs, so new versions keep the data.
- Schema changes are numbered steps in `src/store/history.ts` (`MIGRATIONS`). A copy is saved before any step runs, and an older version refuses a newer database.

## Tests

```
npm test          # core rules: working time, the score
npm run bdd       # behaviour, in plain English (features/*.feature): every measure's accuracy, access, security, admin
npm run report    # both, plus npm audit, into reports/test-report.json (shown on the admin page)
```

`deploy/azure.sh` runs `npm run report` before building the image; a failing test stops the deploy.

## Access and security

- `HOUSTON_USER` and `HOUSTON_PASSWORD`: basic auth for everything. Outside demo mode Houston will not start without a password. 10 failed sign-ins from one address lock it out for 15 minutes. Serve over HTTPS.
- `HOUSTON_API_TOKENS`: read-only bearer tokens for the IDP and other systems.
- `HOUSTON_PEOPLE_VIEWERS`: who may see assignees on the sprint board. Everything else is team level.
- `HOUSTON_ADMIN_USER` and `HOUSTON_ADMIN_PASSWORD`: the admin section (Allocation, test report for this build, connection health, team setup, SLAs, change log). Always its own sign-in; a weak password works in demo mode only. Tokens are never shown or entered there.
- **Allocation** (admin only): who is working on what now, items that have stopped moving, work finished against the team's own normal for its size, lanes worked in, the last recorded trace, and the sprint's rough person-days (with a cost at `RATE_DAY`). Traces from Jira and GitHub, not effort: no lines of code, no totals per person, no ranking, no AI estimates. Every row is a ticket to ask about.
- End to end ownership is a team measure under lead time: full-stack tickets handed between people, what each hand-off cost in waiting, and the share of engineers working across frontend and backend (needs `GITHUB_LANES`).
- Strict Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS when `HOUSTON_URL` is https. Every POST needs `X-Requested-With: houston`.
- `.env` values (and teams saved in the admin page) are validated before they reach any API path or query. `npm audit` is clean; CI fails on high or critical advisories.

## The weekly note and the post in Teams

Houston writes a note per team (top of the team page, `/api/teams/:board/note`): what changed, what moved with it,
and what is likely next for the sprint in progress. Built by rules from the measures, so every number is exact; it
names measures, never people. Optional: `COMPASS_URL`, `COMPASS_KEY` and `COMPASS_MODEL` (Core42 Compass, or any
OpenAI-compatible chat API) reword it; Houston checks every number survived, or keeps its own text.

With Compass set, **Ask Houston** appears on the dashboard and each team page: a question about a team or all teams,
answered from Houston's numbers. Compass only chooses which of Houston's lookups to run and words the answer; every
number in it must be in the facts fetched, or Houston shows the facts in its own words. Questions about people are
refused before anything is sent. People only (API tokens cannot ask), 30 questions an hour per address, nothing stored.


Set `TEAMS_WEBHOOK` and `HOUSTON_URL`. `npm run notify` posts each team's note with a link to the team page. No names.
`deploy/azure.sh` schedules it for Fridays.

## API

People sign in with basic auth; systems use a token (`Authorization: Bearer <token>`). The contract is at `/api/openapi.json`.

| Endpoint | What it returns |
|---|---|
| `GET /api/dashboard` | Every team on the 10 headline measures: score, trend, summary, needs attention, data freshness |
| `GET /api/teams` | Every team: score and summary |
| `GET /api/teams/:board?days=30` | One team, or `all`: areas, headlines with drill-down, score, missed targets worst first |
| `GET /api/teams/:board/history` | Score and headline measures by day |
| `GET /api/monthly?team=&month=` | The monthly report (`/api/monthly.md` for Markdown) |
| `GET /api/sprints/current?team=` | The sprint in progress |
| `GET /api/data-quality` | Data checks and data hygiene |
| `GET /api/metrics` | What each measure means, why it matters, how it is calculated |
| `POST /api/chat` | Ask Houston (needs Compass): `{question, team}` |
| `POST /api/refresh` | Collect now (at most every 5 minutes) |

## Version

The footer and `GET /api/version` show which build is running. In CI the build number is the Actions run number;
`deploy/azure.sh` passes the commit and build time into the image.

## Docker

```
docker build -t houston .
docker run -p 4000:4000 -v houston-data:/data --env-file .env houston
```
