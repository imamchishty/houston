#!/usr/bin/env bash
# Deploys Houston to Azure Container Apps with a nightly collect job. Run once from a machine with az cli signed in.
# Usage: RG=rg-houston LOC=uaenorth ./deploy/azure.sh
set -euo pipefail
RG=${RG:-rg-houston}; LOC=${LOC:-uaenorth}; ENV=${ENV:-houston-env}; ACR=${ACR:-houstonacr$RANDOM}; APP=houston

az group create -n "$RG" -l "$LOC" -o none
# No admin user on the registry: the app and jobs pull with their own managed identity (AcrPull).
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled false -o none
# Tag with the commit so every deploy is traceable. .dockerignore keeps .env out of the upload.
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)
IMAGE="$ACR.azurecr.io/houston:$TAG"
az acr build -r "$ACR" -t "houston:$TAG" -o none \
  --build-arg BUILD_NUMBER="$TAG" --build-arg GIT_SHA="$(git rev-parse HEAD 2>/dev/null)" --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .

az containerapp env create -n "$ENV" -g "$RG" -l "$LOC" -o none
az storage account create -n "${ACR}st" -g "$RG" -l "$LOC" --sku Standard_LRS -o none
KEY=$(az storage account keys list -n "${ACR}st" -g "$RG" --query '[0].value' -o tsv)
az storage share create -n houston-data --account-name "${ACR}st" --account-key "$KEY" -o none
az containerapp env storage set -n "$ENV" -g "$RG" --storage-name data --azure-file-account-name "${ACR}st" --azure-file-account-key "$KEY" --azure-file-share-name houston-data --access-mode ReadWrite -o none

# Secrets and settings come from .env. Put real values there first. Never commit it.
# Container Apps secret names allow only lowercase letters, digits and hyphens, so JIRA_API_TOKEN is stored as jira-api-token.
SECRET_KEYS="JIRA_API_TOKEN GITHUB_TOKEN SONAR_TOKEN TESTMO_TOKEN HOUSTON_PASSWORD AZURE_CLIENT_SECRET TEAMS_WEBHOOK"
# Value of one key: last definition wins, inline "  # comment" and surrounding quotes removed.
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/'; }
SECRETS=(); SECRET_REFS=(); ENVVARS=()
for k in $SECRET_KEYS; do
  v=$(envval "$k"); [ -z "$v" ] && continue          # blank means not configured, skip it
  n=$(echo "$k" | tr 'A-Z_' 'a-z-'); SECRETS+=("$n=$v"); SECRET_REFS+=("$k=secretref:$n")
done
for k in $(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | tr -d '=' | sort -u); do
  case " $SECRET_KEYS HOUSTON_DATA_DIR " in *" $k "*) continue;; esac
  v=$(envval "$k"); [ -n "$v" ] && ENVVARS+=("$k=$v")   # array keeps values with spaces intact
done
# Empty-array safe expansion for the bash 3.2 that ships with macOS.
SECRET_ARGS=(); [ ${#SECRETS[@]} -gt 0 ] && SECRET_ARGS=(--secrets "${SECRETS[@]}")
ENV_ARGS=(--env-vars ${ENVVARS[@]+"${ENVVARS[@]}"} ${SECRET_REFS[@]+"${SECRET_REFS[@]}"} HOUSTON_DATA_DIR=/data)

az containerapp create -n "$APP" -g "$RG" --environment "$ENV" \
  --image "$IMAGE" --registry-server "$ACR.azurecr.io" --registry-identity system \
  --target-port 4000 --ingress internal --min-replicas 1 --max-replicas 1 \
  ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"} "${ENV_ARGS[@]}" -o none

# Mount the share so scorecards persist across restarts
# Private temp file (not a fixed /tmp path), removed on exit.
APP_YAML=$(umask 077; mktemp "${TMPDIR:-/tmp}/houston-app.XXXXXX")
trap 'rm -f "$APP_YAML"' EXIT
az containerapp show -n "$APP" -g "$RG" -o yaml > "$APP_YAML"
APP_YAML="$APP_YAML" python3 - <<'PY'
import os, yaml
p=os.environ['APP_YAML']
a=yaml.safe_load(open(p))
t=a['properties']['template']
t['volumes']=[{'name':'data','storageType':'AzureFile','storageName':'data'}]
t['containers'][0]['volumeMounts']=[{'volumeName':'data','mountPath':'/data'}]
yaml.safe_dump(a,open(p,'w'))
PY
az containerapp update -n "$APP" -g "$RG" --yaml "$APP_YAML" -o none

# Nightly collect at 02:00 Gulf time (22:00 UTC)
az containerapp job create -n houston-nightly -g "$RG" --environment "$ENV" --trigger-type Schedule --cron-expression "0 22 * * *" \
  --image "$IMAGE" --registry-server "$ACR.azurecr.io" --registry-identity system --command "node" "dist/cli.js" \
  ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"} "${ENV_ARGS[@]}" -o none

# Friday digest to Teams at 09:00 Gulf time (05:00 UTC), before the retro. Needs TEAMS_WEBHOOK and HOUSTON_URL in .env.
az containerapp job create -n houston-friday -g "$RG" --environment "$ENV" --trigger-type Schedule --cron-expression "0 5 * * 5" \
  --image "$IMAGE" --registry-server "$ACR.azurecr.io" --registry-identity system --command "node" "dist/cli.js" "notify" \
  ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"} "${ENV_ARGS[@]}" -o none

echo "Houston: $(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)"
echo "Ingress is internal (VNet only). Put it behind your usual internal gateway or SSO proxy."
