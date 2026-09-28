# Setting up Houston, step by step

For someone new to Node.js and Azure. Commands go in the **Terminal** app on your Mac (Applications, Utilities,
Terminal). Type or paste one command at a time and press Enter. Lines starting with `#` are comments; you don't type them.

- **Part 1:** run Houston on your Mac with demo data (15 minutes)
- **Part 2:** point it at your real Jira and GitHub (an hour, once you have the tokens)
- **Part 3:** put it on Azure (an hour or two the first time)

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

---

## Part 3: put it on Azure

The script `deploy/azure.sh` does everything: it builds Houston in Azure, creates the app, a nightly job that
collects the data, a Friday job that posts to Teams, and a file share where the data lives so it survives every new
version. You run the same script for the first deploy and for every update.

### 3.1 What you need (once)

1. **Access to an Azure subscription**, with **Owner** on the resource group Houston will use (or Contributor plus
   User Access Administrator: the script gives the app permission to pull its own image). Ask your Azure admin to
   create an empty resource group, for example `rg-houston` in `uaenorth`, and give you that role on it.
2. **The Azure command line (`az`)**. The easiest way on a Mac is Homebrew (https://brew.sh), then:

   ```
   brew install azure-cli
   az extension add --name containerapp --upgrade
   ```

   Without Homebrew, use the macOS installer from https://learn.microsoft.com/cli/azure/install-azure-cli-macos.
3. **Python's YAML library** (the script uses it to attach the file share):

   ```
   pip3 install --user pyyaml
   ```
4. Your filled-in `.env` from Part 2, with these for a live system:
   - `HOUSTON_MODE=jira`
   - `HOUSTON_PASSWORD` set: Houston will not start live without it.
   - `HOUSTON_ADMIN_PASSWORD` of **14 characters or more**, not a common password; otherwise the admin section stays off.
   - `HOUSTON_URL=https://...` once you know the address (step 3.4), for links in the Teams post.
   - `TEAMS_WEBHOOK` if you want the Friday post.

   The script turns the passwords and tokens in `.env` into Azure secrets; nothing secret goes into the image.

### 3.2 Sign in to Azure

```
az login
az account show --query name -o tsv
```

`az login` opens the browser to sign in. The second command shows which subscription you are on. If it is the wrong
one: `az account set --subscription "<name or id>"`.

The first time on a subscription, let it run Container Apps (safe to run again):

```
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

### 3.3 Decide who can reach it

Choose one:

- **Internal (default):** only reachable from the company network. The Container Apps environment has to be connected
  to your company network (a VNet). This needs your network team: ask them for a Container Apps environment in the
  right VNet, **in the same resource group**, and pass its name as `ENV=`. Without that, internal means nobody can open it.
- **External, limited to your addresses (quickest):** a normal https address, protected by `HOUSTON_PASSWORD` and
  allowed only from the IP addresses you list (your office and VPN; ask IT for them).

### 3.4 Deploy

From the `houston` folder:

```
cd ~/houston
chmod +x deploy/azure.sh
```

External, limited to your addresses:

```
RG=rg-houston LOC=uaenorth INGRESS=external ALLOWED_IPS=203.0.113.10/32,198.51.100.0/24 ./deploy/azure.sh
```

Or internal, in the environment your network team gave you:

```
RG=rg-houston LOC=uaenorth ENV=<their environment name> ./deploy/azure.sh
```

What happens, in order (10 to 20 minutes the first time):

1. All the tests run on your Mac (`npm run report`). If any fail, it stops and deploys nothing.
2. Houston is built in Azure (Azure Container Registry), so you don't need Docker.
3. It creates what is missing: the registry, the Container Apps environment, the storage account and file share for
   the data, the app, and the two jobs. Anything that already exists is reused.
4. It prints Houston's address, for example `Houston 1a2b3c4: houston.<something>.uaenorth.azurecontainerapps.io`.

Put `https://` in front of that address and open it. Then add it to `.env` as `HOUSTON_URL` and run the same command
again, so the Teams post links to it.

### 3.5 First data

The nightly job runs at 02:00 UAE time. To collect now instead of waiting:

```
az containerapp job start -n houston-nightly -g rg-houston
```

Give it 20 to 40 minutes the first time, then refresh the page. To see what it did:

```
az containerapp job execution list -n houston-nightly -g rg-houston -o table
az containerapp logs show -n houston -g rg-houston --tail 50
```

### 3.6 Protect the data (once)

The data lives on the file share the script printed at the end. Houston keeps 30 daily copies of its history there,
but also turn on **Azure Backup** for that file share (Azure portal: the storage account, File shares, the share,
Backup; daily, keep 30 days). The only ways to lose history are deleting the storage account or share, or deploying
with a different `RG`.

### 3.7 New versions

```
cd ~/houston
git pull
npm install
RG=rg-houston LOC=uaenorth INGRESS=external ALLOWED_IPS=<same as before> ./deploy/azure.sh
```

Always the same `RG` and the same options. It updates the app and both jobs to the new version and keeps the same data.
If a new version changes the history database, it saves a copy first. To roll back, check out the previous version
(`git checkout <commit>`) and run the script again.

### 3.8 Changing settings

- Tokens, passwords and most settings: edit `.env` and run the script again.
- SLAs, the working week and teams: change them in **Admin** on the live site; they apply at once and survive updates.

---

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
| The Azure address doesn't open | Internal ingress without a company VNet can't be reached; redeploy with `INGRESS=external ALLOWED_IPS=...`, or check your IP is in `ALLOWED_IPS`. |
| Numbers look wrong | Admin, Data checks first; then compare a few tickets by hand. It is almost always a setting. |
