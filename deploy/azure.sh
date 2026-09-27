#!/usr/bin/env bash
# Deploys Houston to Azure Container Apps with a nightly collect job. Run once from a machine with az cli signed in.
# Usage: RG=rg-houston LOC=uaenorth ./deploy/azure.sh
set -euo pipefail
RG=${RG:-rg-houston}; LOC=${LOC:-uaenorth}; ENV=${ENV:-houston-env}; ACR=${ACR:-houstonacr$RANDOM}; APP=houston

az group create -n "$RG" -l "$LOC" -o none
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none
az acr build -r "$ACR" -t houston:latest . -o none

az containerapp env create -n "$ENV" -g "$RG" -l "$LOC" -o none
az storage account create -n "${ACR}st" -g "$RG" -l "$LOC" --sku Standard_LRS -o none
KEY=$(az storage account keys list -n "${ACR}st" -g "$RG" --query '[0].value' -o tsv)
az storage share create -n houston-data --account-name "${ACR}st" --account-key "$KEY" -o none
az containerapp env storage set -n "$ENV" -g "$RG" --storage-name data --azure-file-account-name "${ACR}st" --azure-file-account-key "$KEY" --azure-file-share-name houston-data --access-mode ReadWrite -o none

# Secrets come from .env. Put real values there first. Never commit it.
SECRETS=$(grep -E '^(JIRA_API_TOKEN|GITHUB_TOKEN|SONAR_TOKEN|TESTMO_TOKEN|HOUSTON_PASSWORD)=' .env | sed 's/=/=/' | tr '\n' ' ')
ENVVARS=$(grep -vE '^(#|$|JIRA_API_TOKEN|GITHUB_TOKEN|SONAR_TOKEN|TESTMO_TOKEN|HOUSTON_PASSWORD)' .env | tr '\n' ' ')

az containerapp create -n "$APP" -g "$RG" --environment "$ENV" \
  --image "$ACR.azurecr.io/houston:latest" --registry-server "$ACR.azurecr.io" \
  --target-port 4000 --ingress internal --min-replicas 1 --max-replicas 1 \
  --secrets $SECRETS --env-vars $ENVVARS HOUSTON_DATA_DIR=/data \
  JIRA_API_TOKEN=secretref:jira_api_token GITHUB_TOKEN=secretref:github_token SONAR_TOKEN=secretref:sonar_token TESTMO_TOKEN=secretref:testmo_token HOUSTON_PASSWORD=secretref:houston_password -o none

# Mount the share so scorecards persist across restarts
az containerapp show -n "$APP" -g "$RG" -o yaml > /tmp/app.yaml
python3 - <<'PY'
import yaml
a=yaml.safe_load(open('/tmp/app.yaml'))
t=a['properties']['template']
t['volumes']=[{'name':'data','storageType':'AzureFile','storageName':'data'}]
t['containers'][0]['volumeMounts']=[{'volumeName':'data','mountPath':'/data'}]
yaml.safe_dump(a,open('/tmp/app.yaml','w'))
PY
az containerapp update -n "$APP" -g "$RG" --yaml /tmp/app.yaml -o none

# Nightly collect at 02:00 Gulf time (22:00 UTC)
az containerapp job create -n houston-nightly -g "$RG" --environment "$ENV" --trigger-type Schedule --cron-expression "0 22 * * *" \
  --image "$ACR.azurecr.io/houston:latest" --registry-server "$ACR.azurecr.io" --command "tsx" "src/cli.ts" \
  --secrets $SECRETS --env-vars $ENVVARS HOUSTON_DATA_DIR=/data \
  JIRA_API_TOKEN=secretref:jira_api_token GITHUB_TOKEN=secretref:github_token SONAR_TOKEN=secretref:sonar_token TESTMO_TOKEN=secretref:testmo_token -o none

echo "Houston: $(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)"
echo "Ingress is internal (VNet only). Put it behind your usual internal gateway or SSO proxy."
