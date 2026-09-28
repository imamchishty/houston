#!/usr/bin/env bash
# Runs deploy/azure.sh twice against a fake az and checks that a redeploy keeps the data:
# the second run creates nothing, reuses the same storage account and share, and mounts the share on the app and both jobs.
# Needs python3 with PyYAML (azure.sh needs it too). CI: npm run test:deploy
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/state" "$T/repo"

cat > "$T/bin/az" <<'FAKE'
#!/usr/bin/env bash
# Fake az: logs every call, remembers what was created, answers show and query calls.
echo "az $*" >> "$AZ_STATE/log"
case "$*" in
  "account show"*) echo "00000000-0000-0000-0000-000000000000"; exit 0;;
  *"keys list"*) echo "fake-key"; exit 0;;
  *"ingress.fqdn"*) echo "houston.internal.test"; exit 0;;
esac
kind=$(echo "$*" | sed -E 's/ (show|create|update|build|set|secret).*//' | tr ' ' '_')
verb=$(echo "$*" | grep -oE ' (show|create|update|build|set)( |$)' | head -1 | tr -d ' ')
name=""; prev=""; for a in "$@"; do [ "$prev" = "-n" ] && name=$a; prev=$a; done
f="$AZ_STATE/${kind}__${name}"
case $verb in
  show) [ -f "$f" ] || exit 3; case "$*" in *"-o yaml"*) printf 'properties:\n  template:\n    containers:\n    - name: houston\n';; esac;;
  create) touch "$f";;
esac
exit 0
FAKE
chmod +x "$T/bin/az"

cd "$T/repo"
git init -q && git -c user.email=ci@test -c user.name=ci commit -q --allow-empty -m test
printf 'HOUSTON_MODE=jira\nJIRA_API_TOKEN=token\nHOUSTON_PASSWORD="two words"\nGITHUB_TOKEN=   # blank\nCONFLUENCE_ADR_MARKERS=adr,architecture decision\n' > .env

fail() { echo "FAIL: $*"; exit 1; }
run() { : > "$T/state/log"; PATH="$T/bin:$PATH" AZ_STATE="$T/state" RG=rg-test HOUSTON_SKIP_REPORT=1 INGRESS="${INGRESS:-internal}" ALLOWED_IPS="${ALLOWED_IPS:-}" bash "$ROOT/deploy/azure.sh" > "$T/out" 2>&1 || { cat "$T/out"; fail "azure.sh exited non-zero on run $1"; }; cp "$T/state/log" "$T/log$1"; }
count() { grep -cE -- "$1" "$2" || true; }

run 1
[ "$(count 'storage account create' "$T/log1")" = 1 ] || fail "first deploy should create the storage account once"
[ "$(count 'storage share-rm create' "$T/log1")" = 1 ] || fail "first deploy should create the share once"
[ "$(count 'update .* --yaml ' "$T/log1")" = 3 ] || fail "share should be mounted on the app and both jobs"

run 2
[ "$(count ' create ' "$T/log2")" = 0 ] || { grep ' create ' "$T/log2"; fail "a redeploy must not create anything"; }
[ "$(count 'containerapp update -n houston -g rg-test --image' "$T/log2")" = 1 ] || fail "redeploy should update the app image"
[ "$(count 'job update -n houston-(nightly|friday) -g rg-test --image' "$T/log2")" = 2 ] || fail "redeploy should update both jobs"
[ "$(count 'update .* --yaml ' "$T/log2")" = 3 ] || fail "redeploy should keep the share mounted on all three"
s1=$(grep -oE 'storage-account [a-z0-9]+' "$T/log1" | head -1); s2=$(grep -oE 'azure-file-account-name [a-z0-9]+' "$T/log2" | head -1 | sed 's/azure-file-account-name/storage-account/')
[ "$s1" = "$s2" ] || fail "redeploy pointed at a different storage account ($s1 vs $s2)"
grep -q 'HOUSTON_PASSWORD=secretref:houston-password' "$T/log2" || fail "password should be a secret reference"
grep -q 'GITHUB_TOKEN' "$T/log2" && fail "blank GITHUB_TOKEN should be skipped"
grep -q 'ingress update -n houston -g rg-test --type internal' "$T/log2" || fail "default ingress should be internal"
grep -q 'access-restriction' "$T/log2" && fail "internal ingress should set no IP rules"

INGRESS=external ALLOWED_IPS=1.2.3.4/32,5.6.7.0/24 run 3
grep -q 'ingress update -n houston -g rg-test --type external' "$T/log3" || fail "INGRESS=external should make the app external"
[ "$(count 'access-restriction set .*--action Allow' "$T/log3")" = 2 ] || fail "each ALLOWED_IPS address should get an allow rule"
echo "deploy test ok: first deploy creates storage once, redeploy reuses $s1 and keeps /data mounted on app and jobs"
