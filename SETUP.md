# Setting up Houston, step by step

For someone new to Node.js and Azure. Commands go in the **Terminal** app on your Mac (Applications, Utilities,
Terminal). Type or paste one command at a time and press Enter. Lines starting with `#` are comments; you don't type them.

- **Part 1:** run Houston on your Mac with demo data (15 minutes)
- **Part 2:** point it at your real Jira and GitHub (an hour, once you have the tokens)
- **Part 3:** put it on Azure, deployed from GitHub with one click (an hour the first time, with your Azure admin)

Once it is running, `RUNNING.md` is the one-page guide to using it day to day.

---

## Part 1: run it on your Mac with demo data

### 1.1 Install the tools (once)

**Node.js** runs Houston. It needs version **22.13 or newer**; the current LTS (24) is best.

1. Go to https://nodejs.org and download the **LTS** installer for macOS. Open it and click through.
2. Close Terminal and open it again, then check:

   ```
   node -v
   ```

   It should print `v24...` (or `v22.13` or higher). `npm` (Node's package installer) comes with it.

**Git** fetches the code. Check with `git --version`. If macOS offers to install the developer tools, click Install.

### 1.2 Get the code (once)

```
cd ~
git clone https://github.com/imamchishty/houston.git
cd houston
npm install
```

`npm install` downloads the libraries Houston uses into a `node_modules` folder. It takes a minute or two. Warnings are
normal; an error in red with `ERR!` is not (see Troubleshooting at the end).

### 1.3 Your settings file

Houston reads its settings from a file called `.env` in the `houston` folder. It is never committed to git, so
passwords in it stay on your machine. For the demo you only need the admin login:

```
printf 'HOUSTON_ADMIN_USER=admin\nHOUSTON_ADMIN_PASSWORD=admin1234\n' > .env
```

(`admin1234` is only allowed in demo mode. Anywhere real the admin password must be 14 characters or more.)

### 1.4 Start it

```
npm run dev
```

Leave that Terminal window open: Houston runs as long as it is open. When it prints that it is listening, open
**http://localhost:4000** in your browser.

- **Dashboard:** two made-up teams, OSSI (struggling) and PLAT (healthy), on the 10 headline measures.
- Click a team for its score, missed targets and what drives each number. **Monthly** is the monthly report.
- The footer has **Metrics** (what every number means), **Data checks** and **Admin**. Admin asks for the user and
  password from step 1.3.

To stop Houston, click the Terminal window and press **Ctrl + C**. To start it again later:

```
cd ~/houston
npm run dev
```

### 1.5 Getting new versions

```
cd ~/houston
git pull
npm install
npm run dev
```

---

## Part 2: connect your real Jira and GitHub

Ask the admins for these (read-only service accounts, not your personal login):

| What | Who gives it | Where it goes in `.env` |
|---|---|---|
| Jira API token for a service account | Jira admin | `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| Each team's Jira board id (the number in the board's web address) and project key | You / Jira | `JIRA_BOARDS=OSSI:42`, `JIRA_PROJECTS=OSSI:OSS` |
| GitHub token: read only, with `repo`, `read:org`, `security_events` | GitHub admin | `GITHUB_TOKEN` |
| Each team's repos | Tech leads | `GITHUB_REPOS=OSSI:m42/ossi-api\|m42/ossi-web` |
| The name of the GitHub Actions workflow that deploys to production | Tech leads | `GITHUB_DEPLOY_WORKFLOW` |
| SonarQube token and project keys (optional) | Sonar admin | `SONAR_URL`, `SONAR_TOKEN`, `SONAR_PROJECTS` |
| Testmo token and project ids (optional) | QA lead | `TESTMO_URL`, `TESTMO_TOKEN`, `TESTMO_PROJECTS` |
| Azure service principal, App Insights ids, resource groups (optional: incidents, errors) | Azure admin | `AZURE_*` |

1. Start from the example file, which explains every setting:

   ```
   cp .env.example .env
   open -e .env
   ```

   `open -e` opens it in TextEdit. Fill in what you have, and set:

   ```
   HOUSTON_MODE=jira
   TZ_OFFSET_HOURS=4
   HOUSTON_USER=imam
   HOUSTON_PASSWORD=choose-a-password
   HOUSTON_ADMIN_USER=admin
   HOUSTON_ADMIN_PASSWORD=at-least-14-characters-long
   ```

   Leave anything you don't have blank: blank means "not connected", not an error. Save and close.

2. Check the connections:

   ```
   npm run check
   ```

   Every line says OK, SKIP (not set) or FAIL with the reason. Fix each FAIL (usually a wrong id or a missing token
   permission) and run it again.

3. Fetch the data (the first time can take 20 to 40 minutes with GitHub):

   ```
   npm run collect
   ```

4. Start Houston with `npm run dev` and open http://localhost:4000.

5. In **Admin**, set your support SLAs per priority (**SLAs and working week**), and check **Connections** and
   **Data checks**. Before showing anyone, compare one real sprint by hand (about 10 tickets and 10 PRs) with what
   Houston says. A mismatch is almost always a setting (a status name, a label, the deploy workflow), not the maths.

Teams can also be added or changed in **Admin, Teams**, with a Test connection button for each source.

### 2.1 Checklist: every integration working, before you deploy

Tick each one on your Mac. The `.env` that passes this list is exactly what you give GitHub in part 3, so what you
proved here is what runs on Azure.

| Check | How | Working looks like |
|---|---|---|
| Settings valid | `npm run check`, section Config | `ok values look valid` |
| Jira | `npm run check`, section Jira | signed in, each board shows its sprints, story points field present |
| Support tickets | `npm run check`, section Support tickets | each team has support tickets; the SLAs listed are yours |
| GitHub | `npm run check`, section GitHub | signed in; each repo reachable, deploy workflow matched, security alerts readable |
| SonarQube, Testmo, Azure | `npm run check`, their sections | ok for each one you use (skip for ones you don't) |
| Data | `npm run collect`, then `npm run check` again, section Data quality | no FAIL; read each WARN and fix what you can |
| Admin | http://localhost:4000, footer, Admin, **Connections**, Check connections now | every source you use says Works; the GitHub token has no missing permissions and is not about to expire |
| Teams | Admin, **Teams**, Edit, Test connection, for each team | every line Works |
| SLAs | Admin, **SLAs and working week** | a row for every priority on your tickets (no "No SLA yet" warning) |
| Numbers | The dashboard and each team page | every team shows its headline measures; one sprint checked by hand matches |

When everything is ticked, go to part 3.

### 2.2 Optional extras

All off until set. Each is a line or two in `.env` (restart Houston after changing it).

| Extra | What you get | Settings |
|---|---|---|
| **Compass (Core42)** | The weekly note reworded in smoother prose (every number checked against Houston's own text), and **Ask Houston**: a question box on the dashboard and each team page, answered from Houston's numbers. Questions about people are refused. | `COMPASS_URL` (the OpenAI-compatible base, `https://...`), `COMPASS_KEY`, `COMPASS_MODEL` |
| **Rough sprint cost** | On Admin, Allocation: people with tickets in the sprint × working days × a blended cost per person-day | `RATE_DAY`, `CURRENCY` |
| **Ownership measures** | Full-stack tickets handed off, what each hand-off cost, engineers working across frontend and backend. Needs Houston to know which paths are frontend and backend. | `GITHUB_LANES=frontend=web/,src/ui/;backend=api/,src/server/` (edit to match your repos) |
| **Teams post** | Each team's weekly note in a Teams channel every Friday | `TEAMS_WEBHOOK`, `HOUSTON_URL` |
| **Who sees names on tickets** | Everyone signed in by default | `HOUSTON_PEOPLE_VIEWERS` to narrow it to named users |

Once Houston is running, the day-to-day guide is `RUNNING.md`.

---

## Part 3: put it on Azure, deployed from GitHub

After a one-time setup, deploying is a button in GitHub: **Actions, Deploy to Azure, Run workflow**. GitHub's machines
run all the tests (a failure stops the deploy), build Houston in Azure, and update the app and its two jobs (the
nightly data collection and the Friday Teams post). The data lives on an Azure file share and survives every deploy.

### 3.1 One-time setup in Azure (your Azure admin, about 15 minutes)

Send your Azure admin this section. They need rights to create an app registration and assign roles.

```
# 1. A resource group for Houston (skip if it exists), and Container Apps turned on for the subscription
az group create -n rg-houston -l uaenorth
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry

# 2. A login for GitHub, with no password: Azure trusts GitHub's own identity for this repo's "production" environment
APP_ID=$(az ad app create --display-name houston-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{"name":"houston-production","issuer":"https://token.actions.githubusercontent.com","subject":"repo:imamchishty/houston:environment:production","audiences":["api://AzureADTokenExchange"]}'

# 3. Allowed to manage only that resource group. Owner, because the deploy gives the app permission to pull its image.
az role assignment create --assignee "$APP_ID" --role Owner --scope "$(az group show -n rg-houston --query id -o tsv)"

# 4. The three values to put in GitHub
echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)"
```

If you want Houston on the company network only, also ask your network team for a Container Apps environment in the
company VNet, **in `rg-houston`**, and its name (see 3.3).

### 3.2 One-time setup in GitHub (you, about 10 minutes)

In the repo on github.com: **Settings**, then:

1. **Environments**, New environment, name it exactly `production`. Optional: add yourself under Required reviewers,
   so every deploy waits for your approval.
2. **Secrets and variables, Actions**:
   - **Secrets** tab, New repository secret: name `HOUSTON_ENV`, value: the whole contents of the `.env` you verified in
     part 2 (open it with `open -e .env`, select all, copy, paste). Check it has, for a live system:
     `HOUSTON_MODE=jira`, a `HOUSTON_PASSWORD`, and a `HOUSTON_ADMIN_PASSWORD` of 14 or more characters.
   - **Variables** tab, add:

     | Name | Value |
     |---|---|
     | `AZURE_CLIENT_ID` | from your Azure admin |
     | `AZURE_TENANT_ID` | from your Azure admin |
     | `AZURE_SUBSCRIPTION_ID` | from your Azure admin |
     | `HOUSTON_RG` | `rg-houston` |
     | `HOUSTON_LOCATION` | `uaenorth` |
     | `HOUSTON_INGRESS` | `external` or `internal` (3.3) |
     | `HOUSTON_ALLOWED_IPS` | for external: your office and VPN addresses, e.g. `203.0.113.10/32,198.51.100.0/24` |
     | `HOUSTON_CONTAINERAPPS_ENV` | only for internal: the environment name from your network team |

GitHub keeps the secret encrypted and hides it in logs. The deploy writes it to a private file on the build machine
and deletes it at the end, even if the deploy fails.

### 3.3 Who can reach it

- **External (quickest):** a normal https address, protected by `HOUSTON_PASSWORD` and reachable only from the
  addresses in `HOUSTON_ALLOWED_IPS`. Ask IT for your office and VPN public IP ranges.
- **Internal:** only from the company network. Needs the Container Apps environment in the company VNet from your
  network team. Without it, internal means nobody can open Houston.

### 3.4 Deploy

GitHub, **Actions**, **Deploy to Azure**, **Run workflow**, Run. (If you added yourself as a reviewer, approve it.)
The first deploy takes 15 to 25 minutes. Open the run, then the last step of **Test, build and deploy**: it prints
Houston's address, for example `houston.<something>.uaenorth.azurecontainerapps.io`. Put `https://` in front.

Then:

1. Add `HOUSTON_URL=https://<that address>` to your `.env` and to the `HOUSTON_ENV` secret, and run the deploy again,
   so the Teams post links to Houston.
2. First data, without waiting for 02:00: ask your Azure admin (or anyone with access) to run
   `az containerapp job start -n houston-nightly -g rg-houston`, or wait for the night. It takes 20 to 40 minutes the first time.
3. Turn on **Azure Backup** for the file share (Azure portal: the storage account in `rg-houston`, File shares,
   `houston-data`, Backup; daily, keep 30 days). Houston also keeps 30 daily copies of its history on the share.

### 3.5 New versions and changes

- New version: push to `main`, then **Run workflow** again. To deploy on every push, uncomment the `push:` lines at
  the top of `.github/workflows/deploy.yml`.
- Tokens and settings: change them in `.env`, check locally (part 2), paste the new `.env` into the `HOUSTON_ENV`
  secret, and run the deploy.
- SLAs, the working week and teams: change them in **Admin** on the live site; they apply at once and survive deploys.
- Roll back: in Actions, **Run workflow** on an older commit (Use workflow from, choose a tag or branch), or revert
  the commit and deploy. If a newer version upgraded the history database, see GO-LIVE.md, "Deploying a new version".

### 3.6 Alternative: deploy from your Mac

The same script, run by hand. You need the Azure command line (`brew install azure-cli`, then
`az extension add --name containerapp --upgrade`), `pip3 install --user pyyaml`, `az login`, and Owner on `rg-houston`:

```
cd ~/houston
RG=rg-houston LOC=uaenorth INGRESS=external ALLOWED_IPS=203.0.113.10/32 bash deploy/azure.sh
```

## Troubleshooting

| You see | What to do |
|---|---|
| `command not found: node` or `npm` | Close and reopen Terminal after installing Node. If it persists, reinstall from nodejs.org. |
| `node -v` shows v20 or lower | Install the current LTS from nodejs.org; Houston needs 22.13 or newer. |
| `EADDRINUSE` / port 4000 in use | Houston is already running in another Terminal window. Close it, or run `PORT=4001 npm run dev`. |
| Browser asks for a user and password | That is `HOUSTON_USER` / `HOUSTON_PASSWORD` from `.env` (or, for Admin, the admin ones). |
| Admin says the section is off | Set `HOUSTON_ADMIN_USER` and `HOUSTON_ADMIN_PASSWORD`; live, the password must be 14+ characters. |
| `npm run check` shows FAIL | Read the reason on that line; it names the setting. |
| `Needs PyYAML` from the deploy script | `pip3 install --user pyyaml` |
| `Tests failed: not deploying` | Run `npm run bdd` to see which, and send me the output. |
| `AuthorizationFailed` from `az` | You need Owner (or Contributor + User Access Administrator) on the resource group. |
| Deploy workflow: `Add the HOUSTON_ENV secret` | Create the secret in Settings, Secrets and variables, Actions (3.2). |
| Deploy workflow fails at Azure login (`AADSTS70021`, no matching federated identity) | The environment must be named exactly `production`, and the Azure admin's federated credential must name this repo (3.1). |
| Deploy workflow: `Tests failed: not deploying` | Open the run, download the `test-report` artifact, or run `npm run bdd` locally, and send me the output. |
| The Azure address doesn't open | Internal ingress without a company VNet can't be reached; redeploy with `INGRESS=external ALLOWED_IPS=...`, or check your IP is in `ALLOWED_IPS`. |
| Numbers look wrong | Admin, Data checks first; then compare a few tickets by hand. It is almost always a setting. |
