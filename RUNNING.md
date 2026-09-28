# Running Houston, day to day

One page for using Houston once it is set up (setting it up is `SETUP.md`).

## Start and stop on your Mac

```
cd ~/houston
npm run dev
```

Open http://localhost:4000. Leave that Terminal window open; **Ctrl + C** stops it. New version: `git pull`, then
`npm install`, then `npm run dev` again.

On Azure nothing to start: the data is collected every night at 02:00 UAE time and the site is always up.
**Refresh now** (top right) collects again straight away, at most once every 5 minutes.

## Signing in

- Everyone: the user and password in `HOUSTON_USER` / `HOUSTON_PASSWORD`.
- Admin (footer, Admin): `HOUSTON_ADMIN_USER` / `HOUSTON_ADMIN_PASSWORD`. Only you.

## The pages

| Page | What it is for |
|---|---|
| **Dashboard** | All teams first, then one card per team: score (share of the 10 headline targets met), ↑↓ against the 30 days before, the measures by area. Needs attention = missed two periods running. Click a card. |
| **Team** | The score and trend, **This week** (what changed, what moved with it, what is likely next), missed targets worst first, then each area. Under every headline, **What drives** it. **Current sprint →** for the sprint. |
| **Current sprint** | Days and points left, outlook, **Blocked or waiting now**, **Ageing work**, every ticket with its person (filter by person, type, state), burndown, bug trend. |
| **Monthly** | One month against the one before, six months of trend. **Copy as Markdown** for Confluence. |
| **Ask Houston** (with Compass) | A question box on the dashboard and each team page. Answers come from Houston's numbers only; questions about people are refused. |
| Footer: **Metrics** | What every measure means, why it matters, how it is calculated, its target. |
| Footer: **Data checks** | Whether the numbers can be trusted: missing fields, unread alerts, data hygiene. Look here first when a number looks wrong. |
| Footer: **Admin** | Allocation (yours only), the test report for this build, connection health, teams, SLAs and working week, change log. |

## A weekly rhythm that works

1. **Friday:** the weekly note lands in Teams (or read **This week** on the team page). Two minutes per team.
2. **Anything "two periods running":** open the team, expand **What drives** it, decide one thing to change. Not five.
3. **Sprint planning:** open **Current sprint** of the last sprint: committed vs done, and what was added late.
4. **Month end:** **Monthly**, Copy as Markdown, into Confluence or the leadership note.
5. **Allocation** (Admin): only when something is stuck. Find the ticket, ask about the ticket.

## When a number looks wrong

1. Hover it, or open **What is this?** under it: the counts behind it and the exact definition.
2. Footer, **Data checks**: is a field, a status name or a token missing?
3. Compare two or three tickets by hand in Jira. It is almost always a setting, not the maths.
4. Settings that change numbers live in `.env` (`SUPPORT_*`, `GITHUB_LANES`, `JIRA_WAIT_STATUSES`, `BUG_PROD_LABELS`) or in Admin (SLAs, working week, teams). After changing `.env`: restart, then **Refresh now**.

## Changing things

| Change | Where |
|---|---|
| Add or edit a team, its repos, Sonar, Testmo, Azure, support project | Admin, **Teams** (Test connection before Save) |
| Support SLAs per priority, working day, weekend, time zone, what counts as a support ticket | Admin, **SLAs and working week** |
| Tokens and passwords | `.env` on your Mac; on Azure, the `HOUSTON_ENV` secret in GitHub, then Run workflow |
| Who sees names on tickets | Everyone signed in; `HOUSTON_PEOPLE_VIEWERS` narrows it |
| Rough sprint cost on Allocation | `RATE_DAY` (blended cost per person-day) and `CURRENCY` in `.env` |
| Compass (weekly note wording, Ask Houston) | `COMPASS_URL`, `COMPASS_KEY`, `COMPASS_MODEL` in `.env` |
| Deploy a new version to Azure | GitHub, Actions, **Deploy to Azure**, Run workflow |

## Keeping it healthy

- Tokens expire. Admin, **Connections**, Check connections now, once a month; it shows the GitHub token's expiry and missing permissions.
- **Data** on the dashboard says Stale when the nightly run was missed. Check the `houston-nightly` job in Azure.
- History is kept in `history.db` on the Azure file share, with 30 daily copies in `backups/`. Turn on Azure Backup for the share (SETUP.md 3.4).
