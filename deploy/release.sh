#!/usr/bin/env bash
# Run from the local repository. Only committed source enters the release archive.
set -Eeuo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$ROOT"
git diff --quiet && git diff --cached --quiet || {
  echo 'Commit tracked changes before releasing.' >&2; exit 1;
}
revision=$(git rev-parse HEAD)
for private_file in .env .config/remo/deploy.env; do
  if git cat-file -e "$revision:$private_file" 2>/dev/null; then
    echo "Refusing to archive tracked private configuration: $private_file" >&2; exit 1
  fi
done
config=${REMO_DEPLOY_ENV_FILE:-$ROOT/.config/remo/deploy.env}
[[ $config = /* ]] || config="$ROOT/$config"
if [[ -e $config || -n ${REMO_DEPLOY_ENV_FILE:-} ]]; then
  [[ -f $config && -r $config ]] || { echo "Cannot read release configuration: $config" >&2; exit 1; }
  if git ls-files --error-unmatch -- "$config" >/dev/null 2>&1; then
    echo "Refusing to load tracked release configuration: $config" >&2; exit 1
  fi
  # The operator owns this file and may use Bash assignments in it.
  source "$config"
fi
HOST=${REMO_DEPLOY_HOST:?Set REMO_DEPLOY_HOST (for example deploy@your-host)}
APP_ORIGIN=${REMO_APP_ORIGIN:?Set REMO_APP_ORIGIN}
DOCS_ORIGIN=${REMO_DOCS_ORIGIN:?Set REMO_DOCS_ORIGIN}
[[ $HOST =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] || { echo 'Invalid SSH destination.' >&2; exit 1; }
for origin in "$APP_ORIGIN" "$DOCS_ORIGIN"; do
  [[ $origin =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || {
    echo 'Release origins must be HTTPS origins without paths or trailing slashes.' >&2; exit 1;
  }
done
if [[ -n $(git ls-files --others --exclude-standard -- apps packages scripts deploy content guide e2e) ]]; then
  echo 'Commit or remove untracked source/test/deployment files before releasing.' >&2; exit 1
fi
git cat-file -e "$revision:deploy/compose.production.yml" || {
  echo 'Commit deployment files before the first release.' >&2; exit 1;
}
pnpm verify --e2e
[[ $(git rev-parse HEAD) == "$revision" ]] || { echo 'HEAD changed during verification.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo 'Verification changed tracked files; review and commit them.' >&2; exit 1;
}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive --format=tar.gz --output="$work/$revision.tar.gz" "$revision"
ssh "$HOST" 'test -f /srv/remo/shared/production.env && test -x /srv/remo/remo'
scp "$work/$revision.tar.gz" "$HOST:/srv/remo/releases/$revision.tar.gz"
ssh "$HOST" bash -s -- "$revision" <<'REMOTE'
set -Eeuo pipefail
revision=$1
[[ $revision =~ ^[0-9a-f]{40}$ ]]
directory="/srv/remo/releases/$revision"
if [[ ! -d "$directory" ]]; then
  mkdir "$directory"
  tar -xzf "/srv/remo/releases/$revision.tar.gz" -C "$directory"
fi
rm -f "/srv/remo/releases/$revision.tar.gz"
/srv/remo/remo deploy "$revision"
REMOTE
curl --fail --silent --show-error "$APP_ORIGIN/api/health"
curl --fail --silent --show-error --output /dev/null "$DOCS_ORIGIN/guide/ru/overview/index.html"
echo "Published $revision"
