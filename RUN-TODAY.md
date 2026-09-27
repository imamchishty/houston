# Run Houston today (demo data, no tokens needed)

Needs Node.js 20 or newer on your laptop. Check with `node -v`. If missing: https://nodejs.org, LTS.

1. Unzip houston.zip.
2. Open a terminal in the houston folder.
3. `npm install`
4. `npm run dev`
5. Open http://localhost:4000

You get two demo teams: OSSI (struggling, built to look like what you described) and PLAT (healthy).
Click through the scores, the recommendations, the people tables, the headcount gate.
Try Accept on a recommendation to see the action log. Open a "raw evidence" link.

Everything in demo mode is invented. Nothing is real until tomorrow's `.env` is filled.

# Tomorrow at work

1. Copy `.env.example` to `.env`. Set `HOUSTON_MODE=jira`.
2. Fill in whatever tokens you have. Anything blank is skipped, not an error.
3. `npm run check`, fix any FAIL.
4. `npm run collect && npm run score` (first run 20 to 40 minutes with GitHub).
5. `npm run dev`, look at the real numbers with the tech lead before anyone else.

What to bring tomorrow, so I can help fill the rest:
- Jira board IDs (number in the board URL), story points field id if not the default
- GHES host name and repo list for Ossi
- Sonar project keys, Testmo project id
- Azure: subscription id, resource group for Ossi production, App Insights app id, Log Analytics workspace id
- Confluence space keys
- Finance: rough monthly team cost for Ossi, for cost per feature
