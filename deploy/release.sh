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

# The release configuration is data, not a program: `source` would let a file the
# script merely reads run commands (and change the environment the gate below sees).
# `deploy/config.sh` reads strict `KEY=VALUE` lines and checks ownership and mode.
# shellcheck source=config.sh
. "$ROOT/deploy/config.sh"

if [[ -e $config || -n ${REMO_DEPLOY_ENV_FILE:-} ]]; then
  if git ls-files --error-unmatch -- "$config" >/dev/null 2>&1; then
    echo "Refusing to load tracked release configuration: $config" >&2; exit 1
  fi
  read_release_config "$config" || exit 1
fi
HOST=${REMO_DEPLOY_HOST:?Set REMO_DEPLOY_HOST (for example deploy@your-host)}
APP_ORIGIN=${REMO_APP_ORIGIN:?Set REMO_APP_ORIGIN}
DOCS_ORIGIN=${REMO_DOCS_ORIGIN:?Set REMO_DOCS_ORIGIN}
# One optional `user@`, then a hostname or IPv4 address. A leading `-` (an ssh option)
# and a second `@` are not destinations.
[[ $HOST =~ ^([A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9.-]+$ ]] || {
  echo 'Invalid SSH destination (use user@host or host).' >&2; exit 1;
}
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
staging=""
cleanup() { [[ -n $staging ]] && rm -rf "$staging"; }
trap cleanup EXIT
if [[ ! -d "$directory" ]]; then
  # Extract beside the final directory and rename only after a successful unpack.
  # Creating the final directory first made a failed retry look complete and deploy
  # a partial tree.
  staging="$directory.tmp.$$"
  rm -rf "$staging"
  mkdir "$staging"
  tar -xzf "/srv/remo/releases/$revision.tar.gz" -C "$staging"
  mv "$staging" "$directory"
  staging=""
fi
rm -f "/srv/remo/releases/$revision.tar.gz"
/srv/remo/remo deploy "$revision"
REMOTE
curl --fail --silent --show-error "$APP_ORIGIN/api/health"
curl --fail --silent --show-error --output /dev/null "$DOCS_ORIGIN/guide/ru/overview/index.html"
echo "Published $revision"
