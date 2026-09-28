# Houston go-live, one week

Owner: Imam. Engineer: one platform engineer, about two days of their time.

## Monday: connect

| Task | Who | Notes |
|---|---|---|
| Jira API token (Cloud) for a read only service account | Jira admin | Board IDs from the board URL, `rapidView=NN` |
| GHES PAT, read only, repo + read:org + security_events, for a service account | GitHub admin | API base is `https://<host>/api/v3` |
| SonarQube user token, Browse on Ossi projects | Sonar admin | Project key from the project page |
| Testmo API token and project ID | QA lead | Project ID in the URL |
| Fill `.env` from `.env.example`, set `HOUSTON_MODE=jira`, `HOUSTON_PASSWORD` | Engineer | Never commit `.env` |
| `npm run check` until nothing says FAIL | Engineer | Fixes are usually a field id or a repo name |
| `npm run collect`, open the UI locally | Engineer | First GitHub pull can take 20 to 40 minutes |

## Tuesday: validate

| Task | Who |
|---|---|
| Set `GITHUB_DEPLOY_WORKFLOW` to the real deploy workflow name, and the support settings (`SUPPORT_PROJECTS` or types and labels, `SUPPORT_SLA`) | Engineer |
| Hand check sprint 14: 10 tickets, 10 PRs, against what Houston says | Imam and tech lead, one hour |
| Fix every mismatch (it is always a mapping, not the maths) | Engineer |
| Deploy: `deploy/azure.sh` (see `SETUP.md` part 3) or `docker compose -f deploy/docker-compose.yml up -d` on an internal VM | Engineer |

## Wednesday: live to you

Houston on an internal URL, basic auth on. You and the lead read the team page together: the score, the missed targets,
and what drives them. Agree which two you act on this sprint.

## Thursday: tell the team

One meeting: the 10 headline measures and their targets, and that a short post will arrive in Teams every Friday.
Houston measures the team, never individuals.

## Friday: first weekly post

With `TEAMS_WEBHOOK` and `HOUSTON_URL` set, each team's score, trend and missed targets are posted to Teams at 09:00
automatically (`npm run notify` to send it by hand). The monthly report (`/api/monthly.md`) goes into Confluence at month end.

## Before go-live: storage

- Data folder on persistent storage (azure.sh mounts an Azure Files share at /data).
- Turn on Azure Backup for that file share, daily, 30 days. Houston also keeps 30 daily copies of its history in /data/backups.
- If Backstage will call Houston, create an API token (`openssl rand -hex 32`) and set `HOUSTON_API_TOKENS=backstage:<token>`.

## Deploying a new version

Run the same `./deploy/azure.sh` with the same `RG`. It finds the existing registry, storage account and share (their
names come from the subscription and resource group), updates the app and both jobs to the new image, and keeps the share
mounted at `/data` on all three. Nothing is created twice and no data moves. CI checks this on every push (`npm run test:deploy`).

If the new version changes the history schema, it saves `backups/history-before-schema-N-<date>.db` first, then upgrades.
To roll back, deploy the previous commit. If the newer version had upgraded the schema, the older one will refuse to start
the history and say so: restore the `history-before-schema` copy over `history.db`, then deploy the older version.

The only ways to lose history: deleting the storage account or the share, or running with a different `RG`.
Azure Backup on the share covers the first.

## Rules for the first month

1. Thresholds frozen after the Tuesday check. Change them once, in a month, with the lead.
2. Nothing is a verdict until it has been true for three sprints.
3. If a number surprises you, check the raw data first (`data/*.json`), then the mapping, then the person.

## Access

Basic auth is enough for week one on an internal network. Before opening it wider, put it behind your SSO proxy
(App Gateway or the Backstage proxy) and leave `HOUSTON_PASSWORD` set as a second layer.
