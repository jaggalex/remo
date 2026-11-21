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
2. Database: `POSTGRES_PASSWORD='<strong>' POSTGRES_PORT=127.0.0.1:5432 pnpm db:up`, then apply the schema as the owner: `REMO_MIGRATION_DATABASE_URL=postgres://<owner>:<password>@127.0.0.1:5432/remo pnpm db:check`. The port with the host is mandatory: without it Postgres listens on every interface. `db:check` applies the schema but does not enable RLS policies.
3. Roles and RLS: the owner role must be a superuser or have `BYPASSRLS`. Create the application role and enable the policies:
   ```sh
   export REMO_MIGRATION_DATABASE_URL=postgres://<owner>:<password>@127.0.0.1:5432/remo
   REMO_APP_DB_PASSWORD='<app password>' pnpm db:rls:setup
   pnpm db:rls:enable
   pnpm db:rls --check
   pnpm db:rls:enable --check
   ```
   `remo_app` gets DML only, with no table ownership and no `BYPASSRLS`; the service runs as it. `db:rls --check` checks every table with organisation data, `db:rls:enable --check` checks the applied set.
4. Environment: create `/srv/remo/.env` with `DATABASE_URL` (the `remo_app` role), `REMO_MIGRATION_DATABASE_URL` (the owner), `NODE_ENV=production`, `PORT=1234`, `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN`, `REMO_METRICS_TOKEN`, `REMO_KEK`, `REMO_KEK_ID`; `chmod 600`.
5. Build: `sudo -u remo pnpm build`. The static files land in `apps/web/dist`.
6. Service: copy `deploy/remo-sync.service` to `/etc/systemd/system/`, enable and start it.
7. nginx: copy `deploy/nginx-remo.conf`, replace the domain, enable the site, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d <domain>`.
8. Documentation portal: `pnpm guide:build` and `rsync -a --delete docs-site/ /srv/remo/docs-site/`; nginx serves it at `/guide/`.

## Mail

`REMO_MAIL_DRIVER=disabled` by default: password reset and address confirmation are not shown, and no letter leaves the server. This is the safe state — turn mail on when the domain is ready.

1. Send from a separate subdomain, such as `mail.example.com`, not the main one: mail reputation stays apart from the application. The address in `REMO_MAIL_FROM` must sit on that subdomain.
2. Add the domain at the provider (Resend or an SMTP service) and create the DNS records:
   - SPF — TXT on `mail.example.com`: `v=spf1 include:<provider> -all`;
   - DKIM — TXT; the provider gives the name and value;
   - DMARC — TXT on `_dmarc.mail.example.com`: `v=DMARC1; p=none; rua=mailto:<reports mailbox>`. Start with `p=none`: the policy only observes and does not reject mail while you read the reports.
3. Set `REMO_MAIL_DRIVER`, `REMO_MAIL_FROM` and the key of the chosen driver: `REMO_RESEND_API_KEY` for `resend` or `REMO_SMTP_URL` for `smtp`. SMTP accepts ports 465 and 587 only. `REMO_APP_ORIGIN` must be `https` without a trailing `/`.
4. Restart the service. It refuses to start on an incomplete configuration: better than silently losing reset links.
5. Check delivery: `pnpm mail:test --to <your address>`. The letter goes through the real queue; the command prints the id of the sent letter or the reason it failed.
6. Work through failures: `pnpm mail:dead` lists the latest 50 letters that could not be sent. `pnpm mail:dead --retry <id>` puts a letter back in the queue only when its link is still intact; after an ordinary failure the link is cleared, and the person must request a new letter.

`console` is refused in production: it prints links to the service log.

## AI gateway

The gateway moves model calls to a separate server: remo sends the request over a tunnel, and only the gateway reaches providers. It is optional. Without it, agents call providers directly as before; our service keeps the gateway on to manage the provider list, kill switches and limits.

You need two servers: one with remo and a separate one, where 1 vCPU and 1 GB of memory are enough. Both need `wireguard-tools`; the gateway server also needs `nftables`.

1. **Tunnel.** The subnet is `10.77.0.0/30`: remo is `10.77.0.1`, the gateway is `10.77.0.2`. Generate keys on each machine, exchange the public keys, and keep only the other side's address in `AllowedIPs`. Ready-made configurations and the order of steps are in `deploy/ai-gateway/wireguard.md`. Do not route all traffic through the tunnel: that would remove the isolation.
2. **Firewall.** On the gateway server apply `deploy/ai-gateway/nftables.conf`: SSH from your addresses only, WireGuard UDP from remo's address only, and on `wg0` only TCP 8080 from `10.77.0.1`. Outbound is TCP 443 and DNS only. The management port 8081 listens on `127.0.0.1` and is not opened.
3. **Start.** Choose one way:
   - Compose: `deploy/ai-gateway/compose.yml`, variables in `/etc/remo-ai-gateway/gateway.env`, state in `/var/lib/remo-ai-gateway`;
   - systemd: `deploy/ai-gateway/remo-ai-gateway.service`.

   Both run one process as a dedicated user, with a read-only filesystem and writes only to the state directory. Do not enable both. Create the `remo-gateway` user and the directories from the list at the top of `compose.yml`.
4. **Registry.** Start from `config.example.json` in the gateway directory and save it as `/etc/remo-ai-gateway/config.json` with mode 600, owned by the gateway user. List providers, models, regions, timeouts and limits. Put installation keys in `gateway.env` under the names from `keyEnv`. What is not in the registry does not exist: an arbitrary provider address is refused.
5. **Certificate.** Issue a self-signed certificate with the IP address `10.77.0.2` in a SAN and put it and its key in `/etc/remo-ai-gateway/tls/`, owned by the gateway user. On the remo server set `REMO_AI_GATEWAY_URL=https://10.77.0.2:8080`, the shared `REMO_AI_GATEWAY_TOKEN`, the certificate PEM in `REMO_AI_GATEWAY_CA` and the region in `REMO_AI_REGION`. Sync pins the certificate: without the pin the connection is refused. The PEM spans lines, so a systemd `EnvironmentFile` cannot carry it: start sync through a wrapper that reads the certificate file and exports the variable.
6. **Check.** From the remo server: `curl --cacert gateway-ca.pem https://10.77.0.2:8080/healthz` → `{"status":"ok"}`. On the gateway server: `remo-gw status` and `remo-gw providers`. Then run an agent task in a room.

`remo-gw` runs on the gateway server and calls the management API on `127.0.0.1`. The token lives in `/etc/remo-ai-gateway/admin.token`.

| Command | What it does |
|---|---|
| `remo-gw status` | version, configuration, kill switches, load |
| `remo-gw providers` | providers, models, regions, errors and latency |
| `remo-gw limits` | effective limits and overrides |
| `remo-gw usage` | tokens and cost by day and organisation |
| `remo-gw kill provider openrouter` | switch a provider off without restarting remo |
| `remo-gw unkill provider openrouter` | switch it back on |
| `remo-gw reload` | re-read `config.json` |

### Monitoring and alerts

- `/healthz` answers without a token and without details; `/metrics` only with `GATEWAY_METRICS_TOKEN`.
- Alert when the provider error share is above 20% over 10 minutes.
- Alert when agents receive `503 AI_GATEWAY_UNAVAILABLE`: tasks answer “AI is temporarily unavailable” while the room keeps working. Look at the sync log and at `remo-gw status` on the gateway.
- Alert on the daily cost: `remo-gw usage` and `limits.global.costPerDay`.

The gateway does not change the legal side: if text goes to a provider abroad, it is still a transfer of data across a border. The provider list in the registry and the privacy policy must agree.

### Address for external agents

Give external agents and integrations a separate name, `agents.<domain>`: `deploy/nginx-remo-agents.conf` proxies only the agent and integration API, without static files or sockets, with its own limits by address and by token. On the main domain bearer tokens keep working for compatibility, but instructions should use `https://agents.<domain>`.

### What a self-hosted installation may not have

If `REMO_AI_GATEWAY_URL` is not set, agents call the provider directly: no tunnel, no second server, no `remo-gw`. Such an installation works as before. Turn the gateway on when you need one provider list, kill switches and per-organisation limits.

## Check

```sh
curl -s https://<domain>/api/health          # {"ok":true,"version":"0.2.0","build":"1247",…}
curl -sI https://<domain>/                    # 200
curl -sI https://<domain>/guide/              # 200, documentation
```

In the browser: sign-up, a room, a second tab in a private window, dragging a sticky note. In the Network panel the socket must show `101 Switching Protocols`.

If mail is on, send yourself a letter with `pnpm mail:test --to <your address>` and open the link in it. `pnpm mail:dead` lists the letters that could not be sent.

## Limitations

- One process: a restart breaks sockets, clients reconnect on their own.
- One agent task runs at a time: a slow model delays the agent queue, not the canvas.

## Where to go next

[Installation security](/guide/admin/security) — what to close before the first user.
