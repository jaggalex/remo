## Что получится

Работающая установка на одном сервере: nginx терминирует HTTPS, sync-сервис держит комнаты и API, Postgres хранит комнаты и доступ.

**Один экземпляр.** Комнаты, открытые сокеты и проверка доступа живут в процессе; две копии за балансировщиком не увидят комнат друг друга. В этой версии масштабирование — вверх, не вширь.

## Подготовка

Ubuntu 24.04, Node 22 LTS, pnpm 11, Postgres 16. Нужны `nginx`, `certbot`, `git`, `ufw`.

```sh
apt install -y nginx certbot python3-certbot-nginx git curl ufw
corepack enable && corepack prepare pnpm@11.2.2 --activate
useradd --create-home --shell /bin/bash remo
install -d -o remo -g remo /srv/remo
```

## Шаги

1. Код: `sudo -u remo git clone <repo> /srv/remo && cd /srv/remo && sudo -u remo pnpm install --frozen-lockfile`.
2. База: `POSTGRES_PASSWORD='<сильный>' POSTGRES_PORT=127.0.0.1:5432 pnpm db:up`, затем примените схему от owner-роли: `REMO_MIGRATION_DATABASE_URL=postgres://<owner>:<пароль>@127.0.0.1:5432/remo pnpm db:check`. Порт с хостом обязателен: без него Postgres слушает все интерфейсы. `db:check` применяет схему, но не включает политики RLS.
3. Роли и RLS: owner-роль должна быть superuser или иметь `BYPASSRLS`. Создайте роль приложения и включите политики:
   ```sh
   export REMO_MIGRATION_DATABASE_URL=postgres://<owner>:<пароль>@127.0.0.1:5432/remo
   REMO_APP_DB_PASSWORD='<пароль приложения>' pnpm db:rls:setup
   pnpm db:rls:enable
   pnpm db:rls --check
   pnpm db:rls:enable --check
   ```
   `remo_app` получает только DML, без владения таблицами и без `BYPASSRLS`; сервис работает от неё. `db:rls --check` проверяет все таблицы с данными организаций, `db:rls:enable --check` — применённый набор.
4. Окружение: создайте `/srv/remo/.env` с `DATABASE_URL` (роль `remo_app`), `REMO_MIGRATION_DATABASE_URL` (owner), `NODE_ENV=production`, `PORT=1234`, `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN`, `REMO_METRICS_TOKEN`, `REMO_KEK`, `REMO_KEK_ID`; `chmod 600`.
5. Сборка: `sudo -u remo pnpm build`. Статика окажется в `apps/web/dist`.
6. Сервис: скопируйте `deploy/remo-sync.service` в `/etc/systemd/system/`, включите и запустите.
7. nginx: скопируйте `deploy/nginx-remo.conf`, замените домен, включите сайт, `nginx -t && systemctl reload nginx`, затем `certbot --nginx -d <домен>`.
8. Портал документации: `pnpm guide:build` и `rsync -a --delete docs-site/ /srv/remo/docs-site/`; nginx отдаёт его по `/guide/`.

## Проверка

```sh
curl -s https://<домен>/api/health          # {"ok":true,"version":"0.2.0","build":"1247",…}
curl -sI https://<домен>/                    # 200
curl -sI https://<домен>/guide/              # 200, документация
```

В браузере: регистрация, комната, вторая вкладка в приватном окне, перетаскивание стикера. В сети сокет должен показать `101 Switching Protocols`.

## Ограничения

- Один процесс: перезапуск рвёт сокеты, клиенты переподключаются сами.
- Одна задача агента выполняется за раз: медленная модель задерживает очередь агентов, но не холст.

## Куда дальше

[Безопасность установки](/guide/admin/security) — что закрыть до первого пользователя.
