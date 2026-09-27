# Houston go-live, one week

Owner: Imam. Engineer: one platform engineer, about two days of their time.

## Monday: connect

| Task | Who | Notes |
|---|---|---|
| Jira API token (Cloud) for a read only service account | Jira admin | Board IDs from the board URL, `rapidView=NN` |
| GHES PAT, read only, repo + read:org, for a service account | GitHub admin | API base is `https://<host>/api/v3` |
| SonarQube user token, Browse on Ossi projects | Sonar admin | Project key from the project page |
| Testmo API token and project ID | QA lead | Project ID in the URL |
| Fill `.env` from `.env.example`, set `HOUSTON_MODE=jira`, `HOUSTON_PASSWORD` | Engineer | Never commit `.env` |
| `npm run check` until nothing says FAIL | Engineer | Fixes are usually a field id or a repo name |
| `npm run collect && npm run score`, open the UI locally | Engineer | First GitHub pull can take 20 to 40 minutes |

## Tuesday: validate

| Task | Who |
|---|---|
| Fill `PEOPLE=` so Jira names and GitHub logins map to one person, and `TEAM_ROSTER=` | Engineer with the lead |
| Set `GITHUB_LANES` to real folder paths and `GITHUB_DEPLOY_WORKFLOW` to the real deploy workflow name | Engineer |
| Hand check sprint 14: 10 tickets, 10 PRs, against what Houston says | Imam and tech lead, one hour |
| Fix every mismatch (it is always a mapping, not the maths) | Engineer |
| Deploy: `deploy/azure.sh` or `docker compose -f deploy/docker-compose.yml up -d` on an internal VM | Engineer |

## Wednesday: live to you

Houston on an internal URL, basic auth on, people views restricted to `HOUSTON_PEOPLE_VIEWERS`.
You and the lead read the recommendations and the headcount gate together. Agree which two you act on this sprint.

## Thursday: tell the team

One meeting: the P&L number, the headcount gate, and that a sprint digest will arrive every Friday.
Show them the team page, not the people table.

## Friday: first digest

`/api/teams/OSSI/digest.md` into Confluence before the retro. Same list you saw Wednesday, without names.
With `TEAMS_WEBHOOK` and `HOUSTON_URL` set, the headline is posted to Teams at 09:00 automatically (`npm run notify` to send it by hand).

## Rules for the first month

1. Thresholds frozen after the Tuesday check. Change them once, in a month, with the lead.
2. Nothing is a verdict until it has been true for three sprints.
3. If a number surprises you, check the raw data first (`data/*.json`), then the mapping, then the person.

## Access

Basic auth is enough for week one on an internal network. Before opening it wider, put it behind your SSO proxy
(App Gateway or the Backstage proxy) and leave `HOUSTON_PASSWORD` set as a second layer.
