## What you get

A working installation on one server: nginx terminates HTTPS, the sync service holds rooms and the API, Postgres stores rooms and access.

**One instance.** Rooms, open sockets and access checks live in the process; two copies behind a load balancer will not see each other's rooms. In this version scaling is up, not out.

## Before you start

Ubuntu 24.04, Node 22 LTS, pnpm 11, Postgres 16. `nginx`, `certbot`, `git` and `ufw` are required.

```sh
apt install -y nginx certbot python3-certbot-nginx git curl ufw
corepack enable && corepack prepare pnpm@11.2.2 --activate
useradd --create-home --shell /bin/bash remo
install -d -o remo -g remo /srv/remo
```

## Steps

1. Code: `sudo -u remo git clone <repo> /srv/remo && cd /srv/remo && sudo -u remo pnpm install --frozen-lockfile`.
2. Database: `POSTGRES_PASSWORD='<strong>' POSTGRES_PORT=127.0.0.1:5432 pnpm db:up`, then `pnpm db:check`. The port with the host is mandatory: without it Postgres listens on every interface.
3. Environment: create `/srv/remo/.env` with `DATABASE_URL`, `NODE_ENV=production`, `PORT=1234`, `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN`, `REMO_METRICS_TOKEN`, `REMO_KEK`, `REMO_KEK_ID`; `chmod 600`.
4. Build: `sudo -u remo pnpm build`. The static files land in `apps/web/dist`.
5. Service: copy `deploy/remo-sync.service` to `/etc/systemd/system/`, enable and start it.
6. nginx: copy `deploy/nginx-remo.conf`, replace the domain, enable the site, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d <domain>`.
7. Documentation portal: `pnpm guide:build` and `rsync -a --delete docs-site/ /srv/remo/docs-site/`; nginx serves it at `/guide/`.

## Check

```sh
curl -s https://<domain>/api/health          # {"ok":true,…}
curl -sI https://<domain>/                    # 200
curl -sI https://<domain>/guide/              # 200, documentation
```

In the browser: sign-up, a room, a second tab in a private window, dragging a sticky note. In the Network panel the socket must show `101 Switching Protocols`.

## Limitations

- One process: a restart breaks sockets, clients reconnect on their own.
- One agent task runs at a time: a slow model delays the agent queue, not the canvas.

## Where to go next

[Installation security](/guide/admin/security) — what to close before the first user.
