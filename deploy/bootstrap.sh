#!/usr/bin/env bash
# Run once after the shared database and /srv/remo/shared/production.env are provisioned.
set -Eeuo pipefail
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 /srv/remo
mkdir -p /srv/remo/{shared,releases,backups}
test -s /srv/remo/shared/production.env || {
  echo 'Provision the remo database and production.env first; see docs/self-hosting.md.' >&2; exit 1;
}
chmod 600 /srv/remo/shared/production.env
install -m 700 "$HERE/remo" /srv/remo/remo
docker network inspect "${REMO_EDGE_NETWORK:?Set REMO_EDGE_NETWORK}" > /dev/null
docker network inspect "${REMO_DB_NETWORK:?Set REMO_DB_NETWORK}" > /dev/null
echo 'Prepared /srv/remo. Copy shared/production.env to a secure off-machine backup.'
echo 'Next: commit source, run deploy/release.sh, validate and reload the Caddy snippet.'
