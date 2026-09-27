#!/usr/bin/env bash
# Deploys Houston to Azure Container Apps, with a nightly collect job and a Friday digest job.
# Run it for the first deploy and for every new version: it creates what is missing and updates what exists.
# Data lives on an Azure Files share mounted at /data in the app and in both jobs, so it survives every redeploy.
# Usage: RG=rg-houston LOC=uaenorth ./deploy/azure.sh
set -euo pipefail
RG=${RG:-rg-houston}; LOC=${LOC:-uaenorth}; ENV=${ENV:-houston-env}; APP=houston; SHARE=houston-data

python3 -c 'import yaml' 2>/dev/null || { echo "Needs PyYAML: pip3 install pyyaml"; exit 1; }
[ -f .env ] || { echo "Run from the repo root with a filled .env"; exit 1; }

# Stable names: the same subscription and resource group always give the same registry and storage account,
# so a redeploy finds the existing data instead of creating a new, empty share. Override with ACR= and STORAGE=.
hash8() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -c1-8; }
SUFFIX=$(printf '%s/%s' "$(az account show --query id -o tsv)" "$RG" | hash8)
ACR=${ACR:-houstonacr$SUFFIX}; STORAGE=${STORAGE:-houstonst$SUFFIX}
exists() { "$@" >/dev/null 2>&1; }

exists az group show -n "$RG" || az group create -n "$RG" -l "$LOC" -o none
# No admin user on the registry: the app and jobs pull with their own managed identity (AcrPull).
exists az acr show -n "$ACR" -g "$RG" || az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled false -o none
# Tag with the commit so every deploy is traceable. .dockerignore keeps .env out of the upload.
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)
IMAGE="$ACR.azurecr.io/houston:$TAG"
az acr build -r "$ACR" -t "houston:$TAG" -o none \
  --build-arg BUILD_NUMBER="$TAG" --build-arg GIT_SHA="$(git rev-parse HEAD 2>/dev/null)" --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .

exists az containerapp env show -n "$ENV" -g "$RG" || az containerapp env create -n "$ENV" -g "$RG" -l "$LOC" -o none
# The data share. Created once, never recreated: deleting or renaming it is the only way to lose history.
exists az storage account show -n "$STORAGE" -g "$RG" || az storage account create -n "$STORAGE" -g "$RG" -l "$LOC" --sku Standard_LRS -o none
exists az storage share-rm show --storage-account "$STORAGE" -g "$RG" -n "$SHARE" \
  || az storage share-rm create --storage-account "$STORAGE" -g "$RG" -n "$SHARE" -o none
KEY=$(az storage account keys list -n "$STORAGE" -g "$RG" --query '[0].value' -o tsv)
az containerapp env storage set -n "$ENV" -g "$RG" --storage-name data --azure-file-account-name "$STORAGE" \
  --azure-file-account-key "$KEY" --azure-file-share-name "$SHARE" --access-mode ReadWrite -o none

# Secrets and settings come from .env. Put real values there first. Never commit it.
# Container Apps secret names allow only lowercase letters, digits and hyphens, so JIRA_API_TOKEN is stored as jira-api-token.
SECRET_KEYS="JIRA_API_TOKEN GITHUB_TOKEN SONAR_TOKEN TESTMO_TOKEN HOUSTON_PASSWORD AZURE_CLIENT_SECRET TEAMS_WEBHOOK HOUSTON_API_TOKENS"
# Value of one key: last definition wins, inline "  # comment" and surrounding quotes removed.
# A key missing from .env is just blank: grep finding nothing must not stop the script (set -e, pipefail).
envval() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/'; }
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
ALL_ENV=(${ENVVARS[@]+"${ENVVARS[@]}"} ${SECRET_REFS[@]+"${SECRET_REFS[@]}"} HOUSTON_DATA_DIR=/data)
SECRET_ARGS=(); [ ${#SECRETS[@]} -gt 0 ] && SECRET_ARGS=(--secrets "${SECRETS[@]}")
NODE=(node --disable-warning=ExperimentalWarning dist/cli.js)

# Mount the data share at /data in an app ("app") or a job ("job"). Safe to run on every deploy.
mount_share() {
  local kind=$1 name=$2 f cmd
  if [ "$kind" = job ]; then cmd=(az containerapp job); else cmd=(az containerapp); fi
  f=$(umask 077; mktemp "${TMPDIR:-/tmp}/houston-$name.XXXXXX")   # private temp file, not a fixed /tmp path
  "${cmd[@]}" show -n "$name" -g "$RG" -o yaml > "$f"
  YAML_FILE="$f" python3 - <<'PY'
import os, yaml
p = os.environ['YAML_FILE']
a = yaml.safe_load(open(p))
t = a['properties']['template']
t['volumes'] = [{'name': 'data', 'storageType': 'AzureFile', 'storageName': 'data'}]
for c in t['containers']:
    c['volumeMounts'] = [{'volumeName': 'data', 'mountPath': '/data'}]
yaml.safe_dump(a, open(p, 'w'))
PY
  "${cmd[@]}" update -n "$name" -g "$RG" --yaml "$f" -o none
  rm -f "$f"
}

# The app: create the first time, afterwards new image and settings on the same app (same share, same data).
if exists az containerapp show -n "$APP" -g "$RG"; then
  [ ${#SECRETS[@]} -gt 0 ] && az containerapp secret set -n "$APP" -g "$RG" --secrets "${SECRETS[@]}" -o none
  az containerapp update -n "$APP" -g "$RG" --image "$IMAGE" --set-env-vars "${ALL_ENV[@]}" -o none
else
  az containerapp create -n "$APP" -g "$RG" --environment "$ENV" \
    --image "$IMAGE" --registry-server "$ACR.azurecr.io" --registry-identity system \
    --target-port 4000 --ingress internal --min-replicas 1 --max-replicas 1 \
    ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"} --env-vars "${ALL_ENV[@]}" -o none
fi
mount_share app "$APP"

# Jobs write the history, so they need the share too. $1 name, $2 cron, rest: command.
deploy_job() {
  local name=$1 cron=$2; shift 2
  if exists az containerapp job show -n "$name" -g "$RG"; then
    [ ${#SECRETS[@]} -gt 0 ] && az containerapp job secret set -n "$name" -g "$RG" --secrets "${SECRETS[@]}" -o none
    az containerapp job update -n "$name" -g "$RG" --image "$IMAGE" --cron-expression "$cron" --set-env-vars "${ALL_ENV[@]}" -o none
  else
    az containerapp job create -n "$name" -g "$RG" --environment "$ENV" --trigger-type Schedule --cron-expression "$cron" \
      --image "$IMAGE" --registry-server "$ACR.azurecr.io" --registry-identity system --command "$@" \
      ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"} --env-vars "${ALL_ENV[@]}" -o none
  fi
  mount_share job "$name"
}
# Nightly collect at 02:00 Gulf time (22:00 UTC)
deploy_job houston-nightly "0 22 * * *" "${NODE[@]}"
# Friday digest to Teams at 09:00 Gulf time (05:00 UTC), before the retro. Needs TEAMS_WEBHOOK and HOUSTON_URL in .env.
deploy_job houston-friday "0 5 * * 5" "${NODE[@]}" notify

echo "Houston $TAG: $(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
echo "Data: share $SHARE on storage account $STORAGE. Turn on Azure Backup for it (GO-LIVE.md)."
echo "Ingress is internal (VNet only). Put it behind your usual internal gateway or SSO proxy."
