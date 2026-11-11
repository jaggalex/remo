# Running remo and testing it

Two things live here: **how to bring the stack up** (including after a reboot) and **the manual
test assignment** for the current acceptance run. Historical scope is in the ADR record, not in a separate file.

---

# 0. One gate: `pnpm verify`

Before calling anything finished, run the same command CI runs:

```bash
pnpm test:db:up       # dedicated test PostgreSQL on 127.0.0.1:55432
pnpm verify           # test environment → file sizes → typecheck → all tests → build → docs → ds
```

`pnpm verify` fails on the first broken step and prints a summary with durations. It
requires the dedicated test server: DB suites must not be skipped in the gate (ADR-089,
ADR-136). The development database is not used and does not need to be running. For the
inner loop, `pnpm verify:fast` skips the test-environment preflight and says so.

CI (`.github/workflows/ci.yml`) runs the same command against a job-local Postgres service
with the same role, control database and `REMO_TEST_POSTGRES_URL` contract, so the
empty-database migration is tested on every push.

### The test PostgreSQL (ADR-136)

Tests have their own server, project, volume, credentials and port:

```bash
pnpm test:db:up       # docker compose -p remo-test ... up --wait, then install identity
pnpm test:db:check    # readiness + installed environment identity (read-only)
pnpm test:db:down     # stop the container, KEEP the volume
pnpm test:db:logs     # follow the container log
```

| Property | Test environment | Development environment |
|---|---|---|
| Compose project | `remo-test` | default project |
| Container | `remo-test-postgres` | `remo-db` |
| Volume | `remo-test_remo-test-postgres-data` | `remiro_remo-db` |
| Endpoint | `127.0.0.1:55432` (loopback) | `:5432` |
| Role / database | `remo_test` / `remo_test_control` | `remo` / `remo` |
| Connection contract | `REMO_TEST_POSTGRES_URL` | `DATABASE_URL` |

The default contract is
`postgres://remo_test:remo_test@127.0.0.1:55432/remo_test_control`. Override it only with
another **dedicated test** server. There is no fallback to `DATABASE_URL` or to `.env`.
`test:db:init` refuses to bootstrap a server that already contains other databases, which
is how an accidental development URL is rejected before anything is written.

`pnpm test` never writes to your `remo` database. Each run creates a throwaway
`remo_test_<run>` on the test server, migrates it once through the same `schema.sql` the
service uses, and drops it at the end:

```bash
pnpm test                    # all tests, database included
pnpm test:watch              # same, in watch mode
pnpm test apps/sync/vote-api.test.mjs   # one file
```

The run token is `$$_<random>`, and the database carries a marker scoped to the installed
environment instance and run. Every suite verifies that identity through
`testDatabaseStore()` before it constructs a store or runs migrations. Teardown drops only
while the marker still names the run; nothing is deleted with `with (force)`, and no other
run's database is swept automatically. A database whose owner cannot be proven is left in
place for manual inspection. If `CREATE DATABASE` succeeds but the ownership marker cannot be
written, the run reports an explicit marker error and preserves the unmarked database — a
failed marker write is never treated as permission to delete.

Without a reachable test server the run says how many suites it is skipping and exits 0 —
that is the laptop-without-Docker case. Under `CI`, a missing URL, a failed connection or a
failed migration in any suite fails the gate; a successful startup probe is not accepted in
place of the suite's own connection.

Managed databases need `CREATEDB`; drops need no other connected session and are never
forced. Ownership is checked by marker, not by name, host, port or a local pid.

**Recovery and manual maintenance.** `pnpm test:db:down` keeps the volume; there is no
volume-deletion command. If identity verification fails, `pnpm test:db:check` prints the
reason; re-run `pnpm test:db:init` only against the dedicated server. A leftover
`remo_test_*` database from a killed run is preserved by design — inspect it with any
PostgreSQL client and drop it manually only after confirming it is yours. Removing the test
volume (`docker volume rm remo-test_remo-test-postgres-data`) is a manual last resort while
the container is stopped; it deletes only test data.

**Known limitations.** The local test credentials are fixed (`remo_test`/`remo_test`) and
the endpoint is loopback-only; this is a disposable local/CI server, not a hardened shared
service. A bootstrap requires an empty server (only the control and system databases), so a
server with unrelated databases must be pointed at a fresh volume instead. Bootstrap uses
`gen_random_uuid()` from PostgreSQL 16.

## 0.1 Browser acceptance (`pnpm e2e`)

The browser suite covers the paths that used to be checked by hand (ADR-090). It starts
its own disposable stack and never touches your dev servers:

```bash
pnpm exec playwright install chromium   # once
pnpm e2e                                # the scenarios below, ~3 min
pnpm verify --e2e                       # the full gate CI runs
```

<!-- generated:state:begin -->
_Tree facts, checked by `pnpm state:check`; run facts are printed by the commands themselves._

| Fact | Value |
|---|---|
| ADR | 203, latest ADR-203 |
| Schema version | 20 |
| Browser scenarios | 145 in 35 files |
| Help topics | 34 (RU + EN) |
| Portal pages | 69 |
| Baselines | 23 product + 12 DS |
| Largest file | `apps/web/src/BoardApp.tsx` — 800 lines |
<!-- generated:state:end -->

A run owns its ports, its database and its report directories (ADR-130), so two runs can
overlap — a second worktree or a second agent needs one variable:

```bash
E2E_PORT_BASE=1000 pnpm e2e    # ports 2235/2237/6175, database remo_test_e2e_1000_<run>
E2E_WORKERS=2 pnpm e2e         # file-level parallelism, opt-in (default 1)
```

Each run gets a random run id (`scripts/e2e-run.mjs`), and the database name and artifact
directories include it: `remo_test_e2e_<run>` or `remo_test_e2e_<suffix>_<run>`,
`test-results/<default|suffix>_<run>`, `e2e-report/<default|suffix>_<run>`. Default and
shifted runs therefore use sibling directories, never an ancestor relationship, so one run's
Playwright cleanup cannot delete another run's traces. The database is created on the test
server with an ownership marker and dropped by `pnpm e2e` only when the marker still names
that environment instance and run.

`E2E_SYNC_PORT`, `E2E_PROXY_PORT`, `E2E_WEB_PORT` override one port at a time.
`REMO_TEST_POSTGRES_URL` selects the test server for both unit and browser tests; there is no
browser-specific database URL that could bypass identity. `E2E_OUTPUT_DIR` and
`E2E_REPORT_DIR` override the artifact paths; they must be separate and non-nested, and
keeping overridden paths disjoint between concurrent runs is the caller's responsibility.
`scripts/e2e-db.mjs` recreates only a database carrying this run's marker — it fails closed
on anything else and never forces a drop.

The table lists the specs that encode product decisions; smaller specs cover gestures,
groups, tools and object panels, and unit suites cover the rest.

| Spec | Covers | Manual rows it replaces |
|---|---|---|
| `auth-board` | sign-up → room → sticky → `saved`; sign-out | ACC basics |
| `sharing-link` | link is read-only, hides people, no export, backup 403 | ACC-4, EXP-6 |
| `export-backup` | real PNG download; backup manifest; restore with confirmation | EXP-2, EXP-7, EXP-8 |
| `facilitation` | shared timer (countdown/pause/resume), vote cap/end/publish, follow + stop everyone | FAC-1…5, FAC-7…12, FAC-15…17 |
| `save-offline` | socket loss → `offline (N)` → reconnect → `saved` → reload keeps the note | SYNC-3…5 |
| `visual` | three connector routings differ; room/export/timer/vote fit 1440×900; PNGs | stage-1 baselines, visual part of FAC/EXP |
| `a11y` | axe on room, export, timer and vote dialogs | accessibility gate |
| `perf` | 120 connectors inside the frame budget | stage-1 FPS debt |
| `cards` | card status, assignee, date range survive a reload | M1 |
| `tags-links` | tag vocabulary, selection by tag, external and internal link | M2 |
| `presentation`, `presentation-viewer` | slide order of any object, presenter/followers, late viewer, camera restore | M3 |
| `comments` | thread, pin, resolve, reload, live frame, second `commenter` account | M4 |
| `lock` | author unlocks, editor refused, duplicate unlocked | M5 |
| `apps` | install, hello action, kill switch | Q6 |
| `theme` | light/dark/system on the room and in help, persistence | — |
| `organisation` | create a second organisation and a team | — |
| `home` | personal org, room tiles, emoji, search/sort, 24-per-page, trash/restore | ADR-167/168 |

The suite uses a per-run `remo_test_e2e_<run>` database on the dedicated test server
(created and dropped automatically), sync on `:1235`, a controllable proxy on `:1237` and
Vite on `:5175` — those are the defaults; every port shifts with `E2E_PORT_BASE`
(ADR-130). Traces and screenshots on failure land in the run's
`test-results/<label>_<run>` directory and are git-ignored.

Visual evidence lives in `spec/baselines/` (the count is in the block above). Regenerate it deliberately:

```bash
pnpm baselines        # REMO_UPDATE_BASELINES=1 on e2e/visual.spec.ts
```

Facts recorded on 27.10.2026: all screens fit 1440×900 after the topbar label collapse;
axe reports no serious/critical on the room and three dialogs; 120 connectors run at
60.2 FPS, 0.9 ms average paint, 8.9 ms worst, on headless Chromium (760×620).

## 0.2 Security acceptance (ADR-109)

Run these after a security-sensitive change; they are cheap and target the boundaries that
e2e does not exercise.

| Check | How | Expected |
|---|---|---|
| Read-only varint | `pnpm test apps/sync/readonly.test.mjs` | a non-canonical `sync/update` frame is dropped, the Yjs document stays unchanged |
| Co-owner promotion | sign in as an editor, `POST /api/boards/<id>/grants` with your own id and `role: "coowner"` | `403 FORBIDDEN`; the role does not change |
| Invitation recipient | invite address A, accept with account B | `422 EMAIL_MISMATCH`; B has no membership; the invitation stays pending for A |
| Malformed HTTP | `curl -H 'Cookie: remo_session=%E0%A4%A' http://127.0.0.1:1234/auth/me` | `401`, the service keeps answering |
| Malformed upgrade | `curl --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' 'http://127.0.0.1:1234/%E0%A4%A'` | `400`, the process stays alive |
| Metadata leak | a signed-in stranger `GET /api/boards/<id>/access` | `404` with no title, organisation or visibility |
| Outbound SSRF | add a custom AI key with `https://[::ffff:127.0.0.1]:9443/v1` | `422 BAD_BASE_URL` |

---

# 0.3 Acceptance: remo and the portal (29.10.2026)

This is the current manual run. The old MVP script below remains as history; use this section
when you accept the product after M0–M5.

## Start the stack

```bash
pnpm install
cp .env.example .env          # first run; for AI also set REMO_KEK
pnpm db:up
pnpm db:check                 # DB CHECK OK
pnpm sync                     # terminal 1, :1234
pnpm dev:web                  # terminal 2, :5173
```

Open `http://localhost:5173`. The first account is created from the sign-in dialog; a personal
organisation and a General team come with it.

## Two people for collaboration and roles

**Fast check (two names, one account):** open a second window with
`http://localhost:5173/?room=<board>&user=Bob`. The presence list shows two names. Use this for
cursors, comments, presentation and drag checks.

**Role check (two real accounts):**

1. Register Alice in a normal window and create a room.
2. Register Bob in an incognito window with a different email.
3. As Alice open **Поделиться**, enter Bob's email, choose **Редактор** and add him.
4. If the dialog offers an invitation link, open it as Bob and accept it; then add the role
   again if the dialog asks for it.
5. Bob opens the room. Repeat with **Комментатор** and **Просмотр**, and with a public link in
   a third incognito window, to check the role table.

The role matrix and the reason for a refusal must match
`http://localhost:5173/help/ru/access.roles`.

## What to check

### Room and card

| Check | Expected |
|---|---|
| **Новая комната** → template or empty | Room opens, the template is added as a copy, nothing existing changes |
| Add a sticky | It opens in the editor immediately; an empty one disappears on exit |
| Select a card, set status, assignee and dates | Card face and inspector show them; after reload they stay |
| Move a card between columns | The column changes, the status does not |
| Set a WIP limit and exceed it | Header shows `N / limit`, the move is allowed |
| Drag a sticky into a frame, then drag the frame | The sticky moves with the frame; drag it out and it stays behind |
| Drag one object to another and drop | A connector is created; move either end, the line follows |
| Select a card and drag its anchor to a sticky | A connector is created to the card; move the card between columns, the line follows its cell |

### Tags, links and search

| Check | Expected |
|---|---|
| Add a tag, assign it, press **Выбрать (N)** | Every object with the tag is selected; others stay |
| Add an external link `https://…` and an internal object link | Both open; `javascript:` and `data:` are rejected |
| Open **Комнаты** and type the room name | The room appears in **Комнаты по названию** |
| In the card filter choose an assignee / overdue / no due date | Matching cards are selected; the room is not hidden |
| Type a phrase from a sticky in the same panel | The object is found and opens selected |

### Presentation (two windows)

| Check | Expected |
|---|---|
| Alice starts a presentation and moves to slide 2 | Bob sees slide 2, counter `2 / N`; Bob cannot advance |
| Bob joins late | He lands on the current slide, not slide 1 |
| Bob pans, then presses **Вернуться к ведущему** | He returns to the current slide |
| Open the discussion panel during the presentation | Only threads of the current slide are listed; pins match the list |
| Alice stops | Alice's previous view returns; Bob stays on the last slide |

### Comments (M4)

| Check | Expected |
|---|---|
| As a commenter create a thread on an object and on a point | Pin appears; panel lists it; reload keeps it |
| Reply and resolve, then reply again | Reply reopens the thread; resolved is hidden by default |
| As a viewer | Read and reply are unavailable; the panel is read-only |
| Open the public link in an incognito window | No discussion is visible |
| Two windows, comment in one | The other updates through the socket, without a reload |
| Delete a comment as its author; delete another as a manager | Author may delete own; a manager may delete any; a tombstone remains |
| Export PNG/PDF with **Добавить комментарии** | Numbered pins and a list below the room; resolved threads are absent |
| Backup → import | Threads and their authors return; an empty comment list clears them |

### Author lock (M5)

| Check | Expected |
|---|---|
| Alice locks a sticky, Bob (editor) tries to move/edit/delete | Refused; the notice names Alice |
| Alice unlocks her own lock | Works; copy and duplicate appear unlocked |
| Bob with `board.manage` unlocks Alice's lock | Works |
| Lock a frame and try to move a child | The frame and its content move; the lock protects the frame object, not a permission on children |

### Portal and help

```bash
pnpm guide:dev                # builds and serves :8088/guide/
```

Open `http://localhost:8088/guide/` and check:

- the overview, capability map, roles, limits, formats, errors, API and security pages;
- **Roles**: commenter is a real role, co-owner requires `board.manage`;
- **Formats**: backup v2 lists comments, tags and presentation, and import replaces comments;
- **Security**: read-only socket, invitation email, access 404 and outbound rules are described;
- **Known issues** and **Changelog** do not claim that comments or card connectors are absent;
- search `Ctrl/⌘+K`, theme switch, mobile width 390 px and the RU/EN switch;
- every page's “Куда дальше” leads one step forward.

In the app open `http://localhost:5173/help/ru/comments.thread` and the other help links from
the panels. Local portal `/help/...` links are expected to open the app, not the static server.

## Automated gate

```bash
pnpm verify --e2e
```

Green means: Postgres, file sizes, generated state, types, unit/DB tests, the browser
scenarios, docs, guide, build and design-system checks passed. The counts that describe the
tree — scenarios, help topics, portal pages — are in the generated block in §0.1; the number
of tests is printed by the run itself, so it is never restated here.

Record the result as ✅ / ❌ / ⚠️ with the exact step and what you saw. A failed step is data,
not a reason to retry until green.

# 1. Running it

## 1.1 After a computer reboot

Three pieces: Postgres (Docker), the sync service, the web app. Postgres and the sync service
do **not** start themselves — after a reboot, run these in order.

```bash
cd /path/to/remo

# 1. Database (Docker Desktop must be running)
pnpm db:up          # docker compose up -d
pnpm db:check       # must print DB CHECK OK

# 2. Sync service — leave this terminal open
pnpm sync           # ws://localhost:1234

# 3. Web app — in a second terminal
pnpm dev:web        # http://localhost:5173
```

That is the whole ceremony. Two shortcuts:

| Command | What it does |
|---|---|
| `pnpm stack` | `db:up` + `db:check` + `sync` in one go (step 1 and 2) |
| `pnpm dev` | web app only — the same as `dev:web` |

`pnpm db:check` is the preflight: it prints the Postgres version, creates the schema if it is
missing and does a write/read/delete round trip. If it fails, nothing else will work — fix it
first (`docker compose ps`, then `docker compose logs db`).

## 1.2 A teammate on another machine

Everything goes through **one port**: the web app, the read API (`/api/…`) and the live
websocket (`/sync`) are all served by the web server, which proxies the last two to the sync
service. So the other person only needs this machine's address on the same network:

```bash
pnpm dev:lan        # same as dev:web, but Vite also listens on the LAN
```

Then Vite prints a `Network:` address, e.g. `http://192.168.1.42:5173`. Send that link plus a
room name:

```
http://192.168.1.42:5173/?user=Bob&room=sprint-12
```

Notes:

- A bare `?room=` link is not an invitation for a claimed room: **Share** grants access to
  a named account or produces a public link. Only a legacy unclaimed room still opens by
  room name. The shared URL does not carry your `?user=` name, so the recipient appears as
  themselves.
- `?user=` gives a person a name. Two browser tabs with different `?user=` values behave like
  two people, which is useful for solo checks.
- If the other machine cannot connect, it is almost always the macOS firewall or both machines
  being on different networks. `pnpm dev:lan` prints the address it bound to.
- To reach remo from outside the LAN later, expose port 5173 through a tunnel; nothing else
  needs forwarding, by design.

## 1.3 When something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| `DB CHECK FAILED: ECONNREFUSED` | Postgres is not running | Start Docker Desktop, `pnpm db:up` |
| The app says `sync: disconnected` | Sync service is not running | `pnpm sync` in its own terminal |
| The app shows an empty room and no templates | The room is new and nothing seeded it | Pick a template from the tab bar |
| `EADDRINUSE :1234` | A sync service is already running | `pkill -f apps/sync/server.mjs` |
| Room list says "read API unreachable" | Same as `sync: disconnected` — the API lives in the sync service | Start it |

Useful checks:

```bash
curl -s http://localhost:1234/health          # ok, store, connections, rooms, uptime, Postgres version
curl -s http://localhost:1234/metrics         # Prometheus scrape (also /api/metrics through the web server)
curl -s -b /tmp/iam.jar http://localhost:5173/api/boards  # room list with a session; without one: 401
pnpm db:prune                                 # list rooms left over from testing
pnpm db:backup:list                           # dumps on disk
```

A room can always be rebuilt from Postgres: the room is stored as an append-only update log
plus a compacted snapshot, and the projection is reconciled when a room is opened.

### 1.4 Operating it: metrics and backups

`/health` answers "is it up and how much is it holding" in one call:

```json
{ "ok": true, "store": "postgres", "connections": 2, "rooms": 1, "uptimeSeconds": 3810,
  "storage": { "ok": true, "boards": 12, "version": "PostgreSQL 16.15" } }
```

`/metrics` is a Prometheus scrape. The numbers that matter day to day:

| Metric | Read it as |
|---|---|
| `remo_ws_connections_active` | how many people are connected right now |
| `remo_ws_connections_total` / `remo_ws_disconnections_total` | churn; a big gap means reconnects |
| `remo_rooms_active` | rooms resident in memory |
| `remo_store_writes_total` / `remo_store_write_errors_total` | writes landing; **errors must stay flat** |
| `remo_store_compactions_total` | the update log is being folded into snapshots |
| `remo_store_projection_writes_total` | the queryable mirror is being refreshed |
| `remo_process_uptime_seconds`, `..._resident_memory_bytes`, `..._eventloop_lag_seconds` | restarts, memory growth, and whether the loop is blocked |

Backups:

```bash
pnpm db:backup                       # dump + manifest, prune to the newest 14
pnpm db:backup:list                  # what is on disk
pnpm db:restore <file>               # says what it would replace; changes nothing
pnpm db:restore <file> --yes         # takes a safety dump first, then restores
pnpm db:restore <file> --yes --force # allowed to replace a database that holds boards
```

Each dump is a `pg_dump` custom archive with a JSON manifest next to it (size, sha256, per-table
row counts). `REMO_BACKUP_KEEP` changes the retention, `REMO_BACKUP_DIR` the location. When
`pg_dump` is not installed the compose container runs it instead, so Docker is enough.

A restore refuses to overwrite rooms without `--force`, and always keeps the state it replaced.
To check a dump without touching anything, restore it into a scratch database:

```bash
docker compose exec -T db createdb -U remo remo_restore_check
docker compose exec -T db pg_restore --no-owner -U remo -d remo_restore_check < backups/<file>.dump
docker compose exec -T db psql -U remo -d remo_restore_check -tAc "select count(*) from boards"
docker compose exec -T db dropdb -U remo remo_restore_check
```

---

# 2. Test assignment (acceptance run)

Goal: prove the sentence the MVP is defined by — *a small team opens one room, loads an agile
template and edits it together in real time, with undo and without losing anything.*

Needed: two people, two machines on the same network (or two browsers with different `?user=`),
five to ten minutes.

## 2.1 Before starting

```bash
pnpm db:up && pnpm db:check     # expect DB CHECK OK
pnpm sync                       # terminal 1
pnpm dev:lan                    # terminal 2, prints the Network: address
pnpm test                       # expect all tests passing
```

Write down: the app URL, the room name you will use, the two names, the time.

## 2.2 The script

Do the steps in order. After each one fill in the result — ✅ pass, ❌ fail, or ⚠️ passed with a
note. A failure is as valuable as a pass: write down what you saw, not what you expected.

| # | Who | Do this | Expected | Result |
|---|---|---|---|---|
| 1 | Alice | Open the app URL with `?user=Alice&room=<room>` and create a room from the **Kanban room** template | The room shows a kanban with Backlog / In progress / Done and two swimlanes; counters read `Backlog 3`, `In progress 2`, `Done 1` | |
| 2 | Alice | Click the room name in the header, type a name, press Enter, then click **Share** | The name sticks; the button says "Copied". The copied link contains `?room=` | |
| 3 | Bob | Open the copied link with `?user=Bob` added | The same room, same name, same counters. The header shows two avatars, `in room: 2` | |
| 4 | Bob | Double-click a card in Backlog and type a sentence | Text appears on the card; Alice sees it appear **as Bob types**, not after he finishes | |
| 5 | Alice | Drag that card from Backlog to Done | The card moves, `Backlog 2 / Done 2`, Bob sees the same within a second | |
| 6 | Bob | Immediately press ⌘Z | Only Bob's own step is undone; Alice's card move stays. Press ⌘Z again: Bob's earlier step is undone next | |
| 7 | Alice | Click **Sticky note** on the tool rail twice, click the first note (a blue dot appears on its right edge), drag that dot onto the second note. Then do the same from a card anchor to a note | A line joins the two notes, and a card can be an endpoint too; move the card between columns and the line follows its cell | |
| 8 | Alice | Drag a connected note somewhere else, then click the line itself and press Delete | The line follows the note. Clicking the line selects it (the badge says `Connector`); Delete removes only the line. Deleting a note removes its line too | |
| 9 | Both | Reload the page | Both rooms are exactly as you left them: same cards, same columns, same positions, same connection | |
| 10 | Bob | Press **⌘K** (or click **⌕ Rooms** in the header) and type a word you typed in step 4 | The card is found; clicking the result opens that room with it selected | |
| 11 | Alice | Close the tab | After a few seconds Bob's `in room` drops to 1 | |
| 12 | Bob | On a trackpad: scroll with two fingers, then pinch. Then keep pinching for a few seconds | Two fingers **pan** the room; pinch (or ⌘ + scroll) **zooms**. The page itself never zooms, and panels never change scale | |
| 13 | Bob | Click **RU** in the header, then reload | The interface is Russian and stays Russian after the reload. **EN** switches it back; room content is unchanged | |
| 14 | Alice | Marquee three stickies (drag on empty space around them), then press **⌘G** | The three draw **one** box with the badge `Group`, and the sidebar offers Group / Ungroup | |
| 15 | Bob | Drag one member of that group by a few centimetres | All three move together on both screens; one **⌘Z** puts all three back | |
| 16 | Alice | Press **⌘C**, then **⌘V** | Copies appear offset from the originals, selected as a new group. **⌘Z** removes the whole paste in one step | |
| 17 | Bob | Click one member of the copy, press **⇧⌘G** | The copy comes apart; the badge reads the number of objects. The original group is untouched | |
| 18 | Bob | Copy a sticky in this tab, switch to the other tab (another room) and press **⌘V** | The sticky lands there with its colour and text; nothing of the source room comes with it | |
| 19 | Alice | Double-click a sticky and type a line; select the first word and press **⌘B** | The word is bold in the note and, after closing the editor, **bold on the canvas**; Bob sees it too | |
| 20 | Bob | Make the note longer than the box | The note keeps its size and Auto shrinks the letters so the text still fits; the formatting stays | |
| 21 | Alice | Drag a sticky slowly towards the left edge of another sticky, stopping a few pixels short | The note is pulled onto the line; a blue dashed guide spans the room at that edge; the original place keeps a dashed outline while the note is carried | |
| 22 | Bob | Drop the note, then drag it far away from everything | It lands exactly where it was let go, with no guides — nothing is snapped when there is nothing to align to | |
| 23 | Bob | Click **L** in the note bar, then **−** twice | The note grows to the large preset; the text size becomes explicit and the number drops by two |
| 24 | Alice | With a note selected, click **B** in the bar | The whole note becomes bold for both people; clicking **B** again removes it. One ⌘Z per toggle |
| 25 | Bob | Drag a corner handle of a selected note | The note resizes with the opposite corner pinned, and Auto text re-fits as it changes |
| 26 | Alice | Open a note, type a word, press **Tab** | A new note appears to the right with an arrow pointing at it, and the caret is in it. Type another word, press **Alt+Enter**: a third note appears below, also linked |
| 27 | Bob | Use the bar's **＋** and pick the left arrow; repeat upwards | Notes appear on the left and above, each linked on its facing side. ⌘Z removes the note and its connector in one step |
| 28 | Alice | Right-click a connector and switch its type to the curve, then pick width 4, dashes and an orange colour | Both people see the route change, the line gets thicker, and the dash and colour match the bar |
| 28a | Bob | Open the colour of a note and then the colour of a line | Both popovers are the same list of swatches, in the same order, with a ring around each colour |
| 28b | Alice | Create a link between two offset notes | The line is an elbow by default: it leaves the side, turns and enters the other note. Anchors appear just outside the hovered note, and the note has a visible edge |
| 29 | Bob | With a note selected, hover over it, move the pointer **out** to a side anchor, then drag onto another note | The anchors stay visible the whole way (they sit outside the note), and the line lands on the facing side of the target. Corner handles do not interfere |
| 29a | Alice | Select a connector and open the width control (a stroke sample in the bar) | It offers Thin 1 / Normal 2 / Thick 4, names them, and picking one thickens the line for both people |
| 29b | Bob | Resize a note by dragging a corner handle | The note itself follows the pointer while the opposite corner stays pinned — not just the handles — and the text re-fits |
| 29c | Alice | Underline a word in a note (⌘U) | The line sits under the letters, not through them; the same for strikethrough |
| 29d | Bob | Set a connector to a red dashed line with two arrow heads and width 4, then draw another line | The second line arrives with the same red dash, both arrow heads and the same width — no dialog needed |
| 29e | Alice | Press Tab twice to grow a chain of three notes | Each note sits about a third of a note away from the previous one, and every connector is a clean single line with no doubling back |
| 29f | Bob | Click the grid button in the canvas corner | It cycles lines → dots → off → lines, the whole room follows, and the choice survives a reload |
| 29g | Alice | Open ⚙ Settings, change the chain gap to 1.0 and save, then press Tab from a note | The next note lands about a note away, not at the old distance. Reload: the setting stays |
| 29h | Bob | In Settings, paste a broken JSON into the JSON box | Nothing breaks: it says the JSON is invalid, and the room keeps working |
| 29i | Alice | Add a rectangle and open its bar | Fill colour, outline colour, outline width and the full text controls are there, and they change the shape |
| 29j | Bob | Drag a line from one note to another and hold the pointer over the target | The target shows four anchors with the nearest one filled; the line ends there, and after the drop it still attaches to that side |
| 29k | Alice | Look at the bottom of the room | The hint sits above the zoom/grid panel, and neither covers the other |
| 29l | Bob | Click Fit with nothing selected, then with three notes selected | The camera fits the whole room first, then zooms to the three notes |
| 29m | Bob | Click the grid button twice | It goes off and back on, and comes back to lines or dots — whichever was last visible |
| 29n | Alice | Click − and + next to the percentage | The room zooms out and in around its middle, and the percentage follows |
| 29o | Alice | Select a note, hover one of its four anchors | That dot fills dark and the cursor becomes a crosshair; the other three stay white |
| 29p | Alice | Click an anchor on the right side of a note | A note appears to the right at the tuned gap, joined by a connector, selected and ready to type — one undo step |
| 29q | Bob | Drag from the same anchor to another note instead of clicking | A dashed line follows the pointer, the target shows its anchors, and the drop connects the two objects (no note is added) |
| 29r | Alice | Select three notes and look above them | A bar appears: six alignments and two distributions; with two notes the distributions are disabled |
| 29s | Alice | Click "align left", then "distribute horizontally" | The left edges line up, then the gaps between them become equal; one undo returns the previous arrangement |
| 29t | Bob | Group two notes, select the group and a third note, align right | The group moves as one and keeps its internal spacing; the third note comes to the group's right edge |
| 29u | Bob | Click ▤ Panel in the header | The right panel folds away, the canvas takes the space, and the choice survives a reload |
| 29v | Alice | Pick a dark fill for a note, then double-click it | The editor is the same dark colour and the text is white — never white-on-white |
| 29w | Alice | Choose a text colour from the "Цвет текста" swatch, then change the fill | The text keeps the chosen colour; pressing "A" goes back to the automatic one |
| 29x | Bob | Right-click a shape that sits under a note | "На передний план" puts it above the note, including when you click the overlap |
| 29y | Bob | Press ⌘] and ⌘[ on a selected object | It moves one layer up or down; with Shift it goes to the very top or bottom |
| 29z | Alice | Press ⌘⇧L on a note, then try to drag, resize and delete it | It stays put, the badge shows 🔒, its property bar hides, and the delete key leaves it alone; ⌘⇧L unlocks |
| 29aa | Alice | Drag a line from one note to another, then double-click the line | A small editor opens on the middle of the line; typing puts a chip there that follows both ends |
| 29ab | Bob | Select a curved connector | The blue highlight follows the curve; no rectangle appears around it |
| 29ac | Alice | Right-click an object near the bottom edge of the canvas | The menu opens upwards and every item, including Delete, is visible and clickable |
| 29ad | Alice | Select a line with text, then drag the white dot on the label | The label slides along the line and to its side, and stays there when either object moves |
| 29ae | Bob | With a labelled line selected, change the label size and colour in the bar | The chip grows and recolours; the editor opens at the label with the same size and colour |
| 29af | Bob | Select a curved line and drag one of its two blue dots | The curve becomes shallower or deeper; releasing is one undo step |
| 29ag | Alice | Make an elbow between two notes placed diagonally, drag its corner dot | The route turns on the other corner instead |
| 29ah | Alice | Right-click an object → Info | A card shows type, size, position, who created it and when; a new object names you |
| 29ai | Bob | Group two notes, click one (the group is selected), then double-click it | The second click selects just that note, so it can be restyled or moved a layer |
| 29aj | Alice | With nothing selected, press on a line's label and drag it | The line selects itself and the label follows the pointer — no first click on the line needed |
| 29ak | Bob | Select a curved line and drag one of its blue dots slowly | The line bends with the dot, frame by frame; the dot never leaves the line |
| 29al | Alice | Select an elbow between two notes placed diagonally, drag its blue dot | The straight run slides between the two stubs, and the line is redrawn while dragging |
| 29am | Bob | Select two notes and open the context menu | The menu lists the same actions as the keyboard and the panel, in the same order, with the same disabled states |
| 29an | Bob | Press ⌘C with nothing selected, then ⌘G with one object | Copy falls through to the browser; grouping is claimed and simply does nothing |
| 29ao | Alice | Connect two notes, then drag one of them slowly | The line follows the note while it is still in hand, not only after the drop; its arrow head stays on the edge |
| 29ap | Bob | Select a note with two connectors and drag a corner to resize it | The connectors and the corner handles follow the live box during the gesture |
| 29aq | Alice | Zoom a room with connectors from 100% to 13% | The arrow heads shrink with the lines instead of staying the same size on screen; lines stay visible |
| 29ar | Bob | Open the context menu near the bottom edge, then near the right edge | The menu flips above the click and stays fully on screen, including its last item |
| 30 | Alice | Right-click a styled note, choose **Copy style**, then right-click another note and choose **Paste style** | The second note takes the colour, size, text size and alignment; its text and position stay. One ⌘Z undoes the paste |
| 31 | Bob | Right-click a note with text and choose **Clear content** | Its text is gone; ⌘Z brings it back |
| 32 | Alice | Drag a card from Todo and hold it over Doing | The card follows the pointer with a shadow, its old place keeps a ghost, the cell is tinted, and guides mark the card edges of the target cell. Dropping it updates `Todo`/`Doing` counts for both people | |

One thing the source product does differently, and this clone follows the source:

- **Kanban cards are connectable.** A card is a leaf endpoint; its geometry is resolved through
  the matrix placement (ADR-113), so the line follows the card between columns. Containers (a
  frame, a whole kanban) are still refused, so a stray line across the room is impossible.

And one deliberate difference, by design:

- **One port for everything.** App, read API and websocket all go through the web server.

## 2.3 Also worth trying (not required)

- Break the network mid-typing (turn Wi-Fi off, type a sentence, turn it on): the text must
  survive and reach the other machine. The status indicator goes `disconnected` → `connected`.
- Move a whole band: drag a frame in the **Story map** template — its stickies must come
  along, and one ⌘Z must put them all back.
- Add a second template (e.g. **Roadmap**): it must land **beside** the
  existing content, not on top of it, and nothing already on the room may change.
- Start a second tab with the same `?user=` value: it must count as one person, not two.
- Put the room under load while watching `/metrics`: open and close tabs, and confirm
  `remo_ws_connections_total` climbs while `..._errors_total` stays at zero.
- Take a backup mid-session, keep editing, then restore the dump into a scratch database (§1.4):
  the rooms in the scratch copy must be the ones from the moment of the dump.

## 2.4 If something fails

Collect these, in this order, and attach them to the report:

1. What you did, what you expected, what happened (a screenshot beats a description).
2. The browser console output (`⌥⌘I` → Console), especially anything red.
3. The sync service terminal output — it logs room loads, projections and compactions.
4. `curl -s http://localhost:1234/health` and `curl -s http://localhost:5173/api/boards`.
5. The room's state in the database, if the problem is about losing data:

```bash
node -e "
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://remo:remo@localhost:5432/remo' });
  await c.connect();
  console.log((await c.query(\"select id, title, length(snapshot) bytes, snapshot_through from boards order by updated_at desc limit 5\")).rows);
  console.log((await c.query(\"select type, count(*)::int from widgets where board_id = 'ROOM' group by type\")).rows);
  await c.end();
})();
"
```

## 2.5 Result

The current release gate is `pnpm verify --e2e`: database, sizes, types, all tests, browser
scenarios, docs, guide, build and the design system. `pnpm db:backup` must also write a dump
whose manifest row counts match the database, and `/metrics` must report the connections of the
run. Open items belong in an issue or a pull request, not in a release note.

## IAM P1 (API)

The API checks below run before the organisation screens. The screen flow is in IAM P3.1;
these HTTP checks still prove the server rules. Start the stack (`pnpm stack`), then:

```bash
# 1. Create an account: a personal organisation and a General team come with it.
EMAIL="tester-$(date +%s)@example.com"
curl -s -c /tmp/iam.jar -X POST localhost:5173/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct horse battery\",\"name\":\"Tester\"}" | jq

# 2. Who am I, and which organisations do I have?
curl -s -b /tmp/iam.jar localhost:5173/api/auth/me | jq

# 3. Create a room in your organisation (id is the room name).
ORG=$(curl -s -b /tmp/iam.jar localhost:5173/api/auth/me | jq -r '.orgs[0].id')
curl -s -b /tmp/iam.jar -X POST localhost:5173/api/orgs/$ORG/boards \
  -H 'Content-Type: application/json' -d '{"title":"Secured room"}' | jq

# 4. The same room without the cookie: 401. With another account: 404.
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/api/boards/<id>
```

| # | Step | Expected |
|---|---|---|
| IAM-1 | Register, then `GET /auth/me` with the cookie | 201 then 200; `orgs` has one entry |
| IAM-2 | Register the same email again | 409 `EMAIL_TAKEN` |
| IAM-3 | Log in with a wrong password | 401; the message does not say whether the email exists |
| IAM-4 | `GET /boards/<private-id>` without a cookie | 401 |
| IAM-5 | The same with another signed-in account | 404 (existence not revealed) |
| IAM-6 | Owner opens `/boards/<id>/access` | `role: owner`, `sources: ["owner"]` |
| IAM-7 | An old room (`owner_id` null) | opens without an account; `/access` says `UNCLAIMED` |
| IAM-8 | `POST /boards/<old-room>/claim` signed in | 200, you are the owner; a second claim gets 409 |
| IAM-9 | WebSocket to a claimed room without a cookie | the upgrade is refused (401), the document never arrives |
| IAM-10 | WebSocket to an unclaimed room | connects, as before |

## IAM P2 (access and sync)

Two accounts are enough: one owner, one viewer. Use a private window for the second person
so the cookies do not clash.

| # | Step | Expected |
|---|---|---|
| IAM-11 | Open an old room (`owner_id` null) | An amber banner says the room has no owner; "Sign in and claim it" |
| IAM-12 | Sign in (or create an account) and press "Claim this room" | The banner disappears; you are the owner; the room stays open |
| IAM-13 | Press Share | The dialog lists grants (only you), an email field with a role, and the public-link switch |
| IAM-14 | Add the second account's email as Viewer | It appears in the list; the second person can open the room |
| IAM-15 | As the viewer: look at the header and the toolbar | The badge says "View only"; sticky/shape buttons, templates and undo are disabled |
| IAM-16 | As the viewer: drag a note, then reload | The note returns to its place: the server refused the change |
| IAM-17 | As the owner: remove the viewer's grant | Their socket closes within a couple of seconds; a reload shows "No access" |
| IAM-18 | Sign out and open the claimed room | The gate says "No access to this room" with a Sign in button |
| IAM-19 | As the owner: Share → turn the link on, copy it, open in a private window | The room opens read-only for the visitor, without an account |
| IAM-20 | Turn the link off | The old URL stops working; a reload shows the gate |

## IAM P3 (membership)

Invitations travel as links until the mail service exists: the inviter copies the URL and
sends it. The invited person must sign in with that email.

| # | Step | Expected |
|---|---|---|
| IAM-21 | As an admin, `POST /api/orgs/{org}/invitations` with an email | 201 with an `url` containing `?invite=`; the token itself is never listed |
| IAM-22 | Open that URL signed out | "You are invited" with a sign-in button; after signing in, an Accept button |
| IAM-23 | Accept as the invited account | You join the organisation (and the default team); the same link returns 410 afterwards |
| IAM-24 | Accept with a different account | 422 `EMAIL_MISMATCH`; the invitation stays usable for the right person |
| IAM-25 | Share a room with an email that has no account | The Share dialog offers an invitation link instead of an error |
| IAM-26 | Open that link as a new account | You land on the room with "View only"; other rooms of that organisation are 404 |
| IAM-27 | `POST /api/orgs/{org}/members/{user}/suspend` | Their session stays signed in; that organisation's room and sockets close, and the room is hidden (404); another organisation still works |
| IAM-28 | `DELETE /api/orgs/{org}/members/{user}` for someone who owns a room | 409 `OWNER_TRANSFER_REQUIRED` with the room list |
| IAM-29 | `POST /api/boards/{board}/transfer` with another member | They become owner, the old owner becomes editor |
| IAM-30 | `DELETE /api/orgs/{org}/admin-roles/{user}/org_admin` on the last admin | 409 `LAST_ADMIN` |
| IAM-31 | `GET /api/orgs/{org}/audit` as an admin | Events for registration, invitations, grants, ownership |

## IAM P3.1 (organisation screens)

The account button now opens the organisation panel; signing out lives in its footer.
Members see the directory, guests see only their own seat, administrators also get the
actions and the journal.

| # | Step | Expected |
|---|---|---|
| IAM-32 | As a member (not an admin), click your name in the header | "People" lists the members; no invite form, no action buttons, no "History" tab |
| IAM-33 | As a guest, open the same panel and pick the host organisation | "You are a guest…", no people, no tabs; `GET /api/orgs/{org}/members` answers 404 |
| IAM-34 | As an `org_admin`, press "Rights" on a member and tick "People admin" | The badge appears; the change is in "History" as "Administrator role granted" |
| IAM-35 | Untick the last `org_admin` (or press Suspend on them) | 409 `LAST_ADMIN` and a sentence saying an administrator must remain |
| IAM-36 | Suspend a member, then press "Restore" | The session was not revoked; after restore the same session works again and the badge disappears |
| IAM-37 | Remove a member who owns a room | The row shows "These rooms still belong to this person" with the room titles |
| IAM-38 | As the owner, Share → choose a member under "Hand over ownership" → confirm | They become owner, you stay an editor, the dialog closes, Share now copies the link |
| IAM-39 | Open "History" as `org_admin` or `security_admin` | Actions in words, actor name, room title, local time; a member has no such tab |
| IAM-40 | Share a room with a colleague | The grant shows their name and email, not a uuid |

## Discovery and metrics (before exposing the service)

The room directory and search predate accounts; both are now scoped to rooms the
caller can read, and metrics are closed to the internet.

| # | Step | Expected |
|---|---|---|
| DISC-1 | `GET /api/boards` without a session, on a claimed room | 401 `AUTH_REQUIRED`, no titles or ids |
| DISC-2 | `GET /api/search?q=<text>` without a session | 401; nothing from the room is returned |
| DISC-3 | Sign in and `GET /api/boards?room=<current>` | only rooms you own or were granted; no other tenant's room |
| DISC-4 | Search for text that exists on two rooms, one not shared with you | hits only from the room you may read |
| DISC-5 | Suspend the member, read `/api/boards` with their old cookie | Hidden from that organisation's directory; after restore the granted room returns without a new sign-in |
| DISC-6 | Open a legacy room (no owner) signed out, press Rooms | the room itself is listed because the address names it; nothing else |
| DISC-7 | `GET /api/metrics` in production without the token | 404 |
| DISC-8 | `GET /api/metrics` with `Authorization: Bearer $REMO_METRICS_TOKEN` on loopback | 200, Prometheus text |

## AI agents v1

Agents are off by default at three levels: organisation, room and agent. A task is the
only thing that gives an agent access; without a configured model, tasks that need the
model stay queued and nothing is written.

| # | Step | Expected |
|---|---|---|
| AG-1 | Organisation → Agents as an admin | "Allow agents" is off; a member can create nothing |
| AG-2 | Turn the organisation switch on, create an agent | The agent appears with its owner; the organisation journal records it |
| AG-3 | Press Keys → New key | The secret starts with `remo_agent_`, is shown once, and the list shows an expiry |
| AG-4 | `GET /api/agent/me` with the key | The agent, its organisation and owner; without the key → 401 |
| AG-5 | `PUT /api/boards/{board}/agents` as the owner | The room allows agents; as a viewer the request is 403 |
| AG-6 | Open More ▾ → Ask AI…, describe a process, press "Ask the agent" | The task is queued, then applied; shapes and connectors appear at the current view |
| AG-7 | Click a generated shape → Info | Author names the agent; the Agent row names the agent and `diagram` |
| AG-8 | Organisation → History | `Agent task queued`, `Agent wrote to the board`, `Agent task finished` with the agent's name |
| AG-9 | Turn the room switch off, then ask again | 403 `AGENT_DENIED` / `AGENTS_DISABLED_BOARD`; nothing changes |
| AG-10 | Create a schedule (hourly), stop it from the list | The schedule disappears; the task history keeps what it did |
| AG-11 | A viewer or a guest opens More ▾ | No Ask AI… item; the room switches and the agent form are unreachable |
| AG-12 | Disable the agent or turn the organisation switch off | Queued tasks are cancelled; new tasks are refused |
| AG-13 | Budget below the diagram size (`Max changes` = 1) | The task fails with `BUDGET_ACTIONS`; not a single object is written |
| AG-14 | `GET /api/agent/tasks` with the key | Only that agent's tasks (no room content); the key cannot open a room |

## AI plan

An authoring task does not write the room: the agent returns a **plan**, a person reads the
preview and applies it in one local transaction (ADR-142). Everything below is either
automatic or a five-minute manual run; the plan path has no second writer.

### Automatic

```bash
pnpm test apps/sync/agents.test.mjs          # budget: fractional dollars, zero, limits
pnpm test apps/sync/agent-plan.test.mjs      # room facts, action budget, one warning per finding
pnpm test packages/agent-plan                # plan contract and dry run
pnpm test apps/web/src/agentPlanGeometry.test.ts  # map: boxes, diagonal line, empty plan
pnpm e2e e2e/agents.spec.ts e2e/visual.spec.ts    # plan, file, connector, ⌘Z, PNG evidence
```

A real provider is not needed: the Playwright sync server runs with `REMO_AI_FAKE=plan`, and
`apps/sync/ai-fake.mjs` is refused unless the process is also an e2e run and not production.

### Manual

Start the stack (`pnpm sync`, `pnpm dev:web`), enable agents in the organisation and on the
room, create an agent and configure a provider key.

| # | Step | Expected |
|---|---|---|
| AP-1 | More ▾ → Ask AI…, choose an agent | The skill is Brief to room by default; Diagram from a description stays in the list; "What will go to the model" lists the task, the file and the snapshot |
| AP-2 | Set max cost `0.1` and max changes `40`, describe a story map, attach a `.md` file, press Ask the agent | The task is queued; the cost stays `0.1`, not `0` or `1`; the file chip names it |
| AP-3 | Wait for "plan ready" | The preview opens; nothing is on the room yet |
| AP-4 | Read the preview | Counts by kind, bounds, the plan map (frames as outlines, notes as squares, connectors as lines), warnings with their codes |
| AP-5 | Open the plan again from the task history | Same preview, no second model call, nothing duplicated |
| AP-6 | Press Apply | The objects and connectors appear at once; the dialog says "⌘Z undoes the plan" and offers "Show on room"; Apply is gone |
| AP-7 | Press ⌘Z on the room | The whole plan disappears in one step, connectors included |
| AP-8 | Press Reject on another plan | The task closes; the room is unchanged |
| AP-9 | Attach a `.pdf`, then a 100 001-byte `.txt` | "Attach a .md, .txt or .csv file" / "larger than 100 000 bytes"; the run button stays disabled |
| AP-10 | Run a plan whose box is outside the allowed coordinates (e2e fixture, or edit the brief) | `PLAN_OUT_OF_BOUNDS` with a critical badge, the apply button disabled, "Apply is blocked" |
| AP-11 | Ask for a plan, then move an object and press Apply | `PLAN_STALE`; ask for a fresh plan; nothing half-written |
| AP-12 | Open More ▾ as a viewer, a public-link visitor or a stranger | No Ask AI… item; `GET .../plan` answers 403 for the viewer and 404 for a stranger; approving is 403 |
| AP-13 | Open the same plan in two tabs, apply it in both | The second tab says "Already applied", offers no undo hint and writes nothing; the object count is unchanged |
| AP-14 | Configure no provider key and queue a brief | The task stays queued and shows no `AI_NOT_CONFIGURED` failure; it runs once the key appears |
| AP-15 | Choose Diagram from a description and ask for a process | Shapes and connectors appear immediately, with no preview; ⌘Z does not remove them |
| AP-16 | Select notes, choose Cards from a selection, press Preview job, then Run job | The preview names the card count and writes nothing; Run job creates the cards in chunks; ⌘Z does not remove them |

Where to look afterwards:

- **Organisation → History**: `agent.plan.propose`, `agent.plan.approved`, `agent.plan.applied`,
  `agent.plan.rejected` with the agent's name, the plan id and the counts. Only an
  administrator sees this tab; an editor sees the task list in the agent dialog.
- **AI journal**: one model-call row for the brief task (tokens, cost, key fingerprint); the
  cards skill has none, because it does not call a model. The journal is admin-only.
- **Object info**: a created object names the agent and the `brief-to-board` skill.
- **Events**: applying a plan produces audit rows only; a card package produces one
  `board.item.created` event per card.

### Limitations

- The deterministic provider is a **test seam only**: `REMO_AI_FAKE=plan` works only with
  `REMO_E2E_RUN_ID` and outside production; there is no fake switch for a developer's own
  server.
- The preview has **no drag-and-drop editing**: a plan is accepted or rejected as a whole;
  changing a box means asking for a new plan.
- One template exists (`user-story-map`); a second template, editing and deleting planned
  objects are later work.
- The plan map is also read-only and shows only planned objects: an endpoint that is already
  on the room is checked on apply, not drawn.

## AI provider keys

Keys are write-only; the service decrypts them only while a task runs. `REMO_KEK` must
be set on the server (32 bytes, base64).

| # | Step | Expected |
|---|---|---|
| KEY-1 | Organisation → Agents → My key → add an OpenRouter key | 201; the list shows provider, model and a fingerprint; the secret is absent from the response |
| KEY-2 | Inspect `ai_credentials.ciphertext` and `dek_wrapped` in the database | Neither contains the secret |
| KEY-3 | `POST /api/users/me/ai/credentials/{id}/test` | 200 for a working key; 422 for a rejected one; nothing is stored from the test |
| KEY-4 | As `org_admin`, open the organisation key list | Metadata and fingerprint only; a member's personal key is not listed |
| KEY-5 | Set the policy to "organisation key only", add a personal key, run a task | The personal key is not used; the organisation key is used, or `AI_NOT_CONFIGURED` |
| KEY-6 | Rotate a key and run a task | The new secret is used; the fingerprint changes; the old secret fails |
| KEY-7 | Revoke the key used by a queued task | The task fails with `AI_CREDENTIAL_MISSING` / `AI_NOT_CONFIGURED`; no room change |
| KEY-8 | Create a custom gateway pointing at `http://127.0.0.1` | 422 `BAD_BASE_URL`; private/loopback URLs are refused |

## Evidential journal

| # | Step | Expected |
|---|---|---|
| LOG-1 | Run a diagram task | `GET /api/orgs/{org}/ai/runs` shows one row with provider, model, key fingerprint, tokens and cost |
| LOG-2 | `GET /api/orgs/{org}/ai/runs/verify` | `{ok:true}` with the number of checked calls and the last hash |
| LOG-3 | Change one field in `ai_runs` with SQL, verify again | `ok:false`, the first broken `seq` and reason `HASH` |
| LOG-4 | Restart with `REMO_AI_ANCHOR_DIR` set | A JSONL line with the current head appears; the journal UI shows the anchor |
| LOG-5 | Run a cards task | No new model-call row (the skill is deterministic); the task and audit still record the change |
| LOG-6 | Open the journal as an ordinary member | 403 |

## Cards skill

| # | Step | Expected |
|---|---|---|
| CARD-1 | Select two notes, More ▾ → Ask AI… → skill "Cards from a selection" → run | Two cards appear; the notes remain (`copy`) |
| CARD-2 | Same with "Move" | The cards appear and the notes are gone, in one gesture |
| CARD-3 | Choose "Kanban column" | Cards are placed in the first column and keep the selection order |
| CARD-4 | Ask for cards with nothing selected | The run button is disabled and the dialog explains why |
| CARD-5 | Set "Max changes" below the number of selected notes | `BUDGET_ACTIONS`; no card is created |
| CARD-6 | Select 200 notes | Cards are created in chunks of 50; the task shows progress `done/total` |
| CARD-7 | Select 501 notes | `CHANGE_SET_REQUIRED`; nothing changes |
| CARD-8 | Click a generated card → Info | The Agent row names the agent and `cards`; the journal/audit shows `agent.write` |

## Change sets and MCP

A change set is the bulk path: preview is read-only, execute re-checks permissions, and
a job reports progress and can be resumed. The MCP server is a stdio façade over the same
API; it cannot read room text.

| # | Step | Expected |
|---|---|---|
| CS-1 | As an editor, `POST /api/boards/{board}/agent-change-sets` with `preview:true` and 3 selected notes | 201; `estimate.cards=3`; status `draft`; no card exists |
| CS-2 | `POST /api/change-sets/{id}/execute` | 202 with a task whose `skill_slug` is `change-set`; progress appears |
| CS-3 | Wait for the runner | Change set `applied`; exactly 3 cards; `progress.done=3`; the task history shows the count |
| CS-4 | Repeat the create with the same `Idempotency-Key` | 200 `replayed`; no second job |
| CS-5 | Select 501 objects | `CHANGE_SET_TOO_LARGE`; nothing is written |
| CS-6 | Cancel while running | Task and change set `cancelled`; no further chunks are applied |
| CS-7 | Make a change set fail mid-way (e.g. revoke the agent), then `resume` | Only unprocessed sources are converted; processed ones are not duplicated |
| CS-8 | `GET /api/boards/{board}/agent-change-sets` | Jobs with status, estimate and progress, newest first |
| MCP-1 | `node scripts/mcp-server.mjs` with `initialize` and `tools/list` | Server info `remo`; tools include rooms, skills and change sets |
| MCP-2 | `list_boards` with a valid agent key | Only rooms the owner can open; `agentsEnabled` reflects the switch |
| MCP-3 | `create_cards_change_set` with `preview:true` | A draft change set with an estimate; no card |
| MCP-4 | `execute_change_set`, then `get_change_set` | Applied with count/progress |
| MCP-5 | Use the key to read room text or another agent's change set | No such tool; the API answers 404 |

## Design system and product tokens (stage 0)

The package and the product share one token source. A failure here is usually a stale
generated file or a literal that bypassed the tokens.

| # | Step | Expected |
|---|---|---|
| DS-1 | `pnpm ds:check` | Tokens match `tokens.json`; 154/154 contrast pairs; stylelint clean |
| DS-2 | `pnpm test` | All tests pass; the run prints the current count, including token rules, literal scan, component render and product-style guards |
| DS-3 | `pnpm dev:web` → `/__ds` | All components with states; theme, density and language switches work |
| DS-4 | In the catalogue: open a dialog, press `Esc` | Focus moves into the dialog, Tab is trapped, `Esc` closes and focus returns |
| DS-5 | Switch density in the catalogue | Controls measure 32 and 28 px; labels do not reflow |
| DS-6 | Switch RU/EN | No button or tab label is clipped |
| DS-7 | `spec/ds-baselines/` | 12 PNGs: room/share/agent × light/dark × 32/28 |
| DS-8 | Open the product room | Warm canvas and grid, teal accent, Inter; no blue chrome; kanban cards read as surfaces, not outlines |
| DS-9 | Share dialog with an empty invite field | The Add button is disabled but readable (muted on hover surface) |
| DS-10 | Settings → "Show alignment guides" | The native checkbox is teal, not browser blue |
| DS-11 | Edit `apps/web/src/styles.css` to add `#123456` | `pnpm test` fails with the literal; revert it |
| DS-12 | Set `document.documentElement.dataset.theme = "dark"` in the product console | The canvas repaints with the dark palette without a reload (`readCanvasTokens()` is re-read) |

## Connectors: routing, waypoints, ports (ADR-077)

Run with a room that has at least two connectable objects. The connector bar appears
when one line is selected; points appear as hollow circles and segment midpoints as
filled dots.

| # | Step | Expected |
|---|---|---|
| CN-1 | Select a note; drag from one of the eight anchors to another note | A line appears with an arrow; the end stores the side and corner offset |
| CN-2 | Drag to within 160 px of a note, not exactly onto it | The target note wins; the line snaps to its nearest anchor |
| CN-3 | Click a segment midpoint and drag | One rigid point is added on release; one undo removes both the point and the move |
| CN-4 | Drag that hollow point | It follows the pointer; the route recomputes; one undo restores the old position |
| CN-5 | Double-click the hollow point | The point disappears and the two segments merge |
| CN-6 | Change routing straight → elbow → curved | Rigid points stay; the route changes shape, not the endpoints |
| CN-7 | With the line selected, press `Tab` / `Shift+Tab`, then arrows, `Shift`+arrows, `Delete`, `Esc` | Focus walks the points; 1 / 10 px moves; delete removes the focused point; `Esc` clears the focus ring |
| CN-8 | Drag an endpoint handle onto another object | The end reattaches; dropping on the other endpoint or itself does nothing |
| CN-9 | Delete an endpoint object | The connector disappears with it; undo restores both |
| CN-10 | Add a 33rd waypoint | Refused; the line keeps 32 |
| CN-11 | Open an old room with `bend`/`elbowFlip`/`curve` | It renders as before; the first waypoint/routing edit converts it to the new shape |
| CN-12 | 120 connectors, drag a note | ≥ 50 FPS (the remaining acceptance run) |

### Port click and delete confirmation

| # | Step | Expected |
|---|---|---|
| CN-13 | Click a port with another note within 160 px | The connector is created immediately to that note; no note is added |
| CN-14 | Click a port with nothing within 160 px, then move the pointer, then `Esc` | A preview follows the pointer; `Esc` removes it and neither undo nor the document changes |
| CN-15 | Select objects with attached connectors and press `Delete` | The dialog names the number of objects and connectors; Cancel changes nothing |
| CN-16 | Add a 33rd point | A visible message explains the 32-point limit; no point is added |

### Connector operations through change sets

| # | Step | Expected |
|---|---|---|
| CC-1 | `POST /api/boards/{board}/agent-change-sets` with `create_connector` from/to | 201; estimate 1 change; draft, no connector |
| CC-2 | Execute it | One connector with `routing` and both endpoints; agent action `set_connector` in the journal |
| CC-3 | Create with `from === to` | 422 `connector_self_loop`; nothing written |
| CC-4 | `set_connector_waypoints` with 2 points, then `set_connector_routing: curved` | Rigid points stay; routing changes |
| CC-5 | `set_connector_waypoints` with 33 points | `BAD_WAYPOINTS`; the old line is unchanged |
| CC-6 | MCP `tools/list` and `create_connector_change_set` with a preview | The tool exists; preview returns a draft change set |
| CN-17 | Pull two notes until the connector segment is shorter than 24 px | No midpoint dot appears on that segment; the ends and rigid points stay |

## User help and product metrics (ADR-081/082)

| # | Step | Expected |
|---|---|---|
| DOC-1 | `pnpm docs:check` | All topics have RU + EN, links resolve, no stale translation, generated bundle current |
| DOC-2 | Open `/help/ru/connectors.create` without signing in | The article is public; room shell is not loaded |
| DOC-3 | Switch RU → EN on an article | The same topic opens in English; URL contains the language |
| DOC-4 | Select a connector, click `?` in its bar | The connector help topic opens; the room is unchanged |
| DOC-5 | Change `ru.md` without updating the EN hash | `pnpm docs:check` fails with an outdated translation |
| MET-1 | Run `pnpm test` | Metrics envelope validation, required props and content-key block are covered |
| MET-2 | Start sync with `REMO_METRICS_DATABASE_URL` pointing at `remo_metrics` | `board.created` and `agent.task.finished` appear in `metrics_events`; the room database is untouched |
| MET-3 | Start sync without the metrics URL | The room works and no metrics connection is opened |

## Report format for stage work

Each implementation report starts with a one-line roadmap position (stage, task, what
is closed) and lists only the acceptance items that are still manual.

## Stage 2 — access and the public link (ADR-061/069/073/083)

Seed two accounts and two rooms with `pnpm acceptance:stage2` while the sync service
is running. The command prints both sets of credentials and the room URLs; it uses the
same HTTP routes as the UI and creates a direct viewer grant plus a team editor grant.

| # | Step | Expected |
|---|---|---|
| ACC-1 | User has a direct grant and a team grant | Both rows are visible; one "Your role" line names the strongest resulting role |
| ACC-2 | Editor opens Share on a room with a team grant | No role selector or remove action for the team row; the server still refuses a direct API call with 403 |
| ACC-3 | Owner deletes a room from the room list | The dialog names the object count; with the link on it also says the link will be turned off |
| ACC-4 | Anonymous opens an enabled link | Read-only room; copying the URL again gives the same URL; no member names, avatars or presence |
| ACC-5 | Anonymous opens a password link | Only the password prompt; no title or owner. Wrong password says "wrong password", not "recently changed" |
| ACC-6 | Owner turns the link off | The same URL returns 404 `LINK_INACTIVE` with no title or owner; the app says the link is not active |
| ACC-7 | Owner turns the link on again | The same URL works again; the dialog warned about this before the click |
| ACC-8 | Owner sets an expiry in the past | 422 with an explicit "must be in the future" message |
| ACC-9 | Owner deletes a room and restores it | The room is back for the owner; the link is off |
| ACC-10 | Owner copies a room | A new room opens with copied objects and grants; its link is off |
| ACC-11 | `pnpm docs:check` | `access.share`, `access.roles`, `access.link`, `access.lifecycle` have RU + EN and no stale translation |

## Stage 3 — save status and offline (ADR-084)

| # | Step | Expected |
|---|---|---|
| SYNC-1 | Open a room and wait for initial sync | Indicator is `saved`; the dot is connected |
| SYNC-2 | Add a sticky | Indicator changes to `saving` within 200 ms, then `saved` after the server acknowledges persistence |
| SYNC-3 | DevTools → Network → Offline, add a sticky | Indicator is `offline (1)`; the object appears locally |
| SYNC-4 | Return online and wait | Indicator passes through `saving` to `saved` |
| SYNC-5 | Reload the page | The object added offline is still there |
| SYNC-6 | Make an edit in one tab while another tab is open | The second tab receives the update; its indicator stays `saved` (remote updates do not count as unsaved) |
| SYNC-7 | With two accounts, change the member's role to viewer while their tab is open | The canvas stays; the member sees `View only` and the access-changed message; writes are blocked |
| SYNC-8 | `pnpm docs:check` | `sync.status` has RU + EN and no stale translation |
| SYNC-9 | With `REMO_METRICS_DATABASE_URL` set, save a room with ≥3 objects | `board.saved` and one `activation.first_value` appear; a second save adds no second activation |

## Stage 4 — export and backup (ADR-071/085)

Use the two accounts from `pnpm acceptance:stage2`. The member holds a direct viewer
grant **and** a team editor grant; for EXP-5 remove the team grant first (Share → the
team row → remove) and put it back afterwards, or the member is an editor.

| # | Step | Expected |
|---|---|---|
| EXP-1 | Open **Export** in the topbar | Scope comes first: Selection / Frame / Whole room, each with an object count; format second. No scope is chosen silently |
| EXP-2 | Select two notes, choose Selection → PNG, export | The file contains only those objects; no grid, selection outline or other people's cursors |
| EXP-3 | Select an object inside a frame, choose Frame → PNG | The frame and everything inside it; the object count matches the file |
| EXP-4 | Choose Whole room → PDF | One page, proportions kept; text is not selectable or searchable (stated limitation) |
| EXP-5 | As a viewer (no team editor grant) open Export | PNG and PDF are offered; there is no Room backup format and no restore section. `GET /boards/<id>/backup` returns 403 |
| EXP-6 | Open the room through the public link without signing in | No Export button; `backup` and `export-jobs` both return 403; the room stays read-only |
| EXP-7 | As an editor choose Room backup | A single `.remo-backup.json`; `manifest` has format, version, counts and a `sha256:` checksum; audit has `export.requested` and `export.completed` |
| EXP-8 | Choose the same file under "Restore from a remo backup" | Confirmation names the file and the object count; after confirming, the room is replaced and a notice says so |
| EXP-9 | Edit one number in the backup and import it | "The checksum does not match"; the room is unchanged |
| EXP-10 | Import an unrelated JSON file | "This is not a remo room backup"; the room is unchanged |
| EXP-11 | `pnpm docs:check` | `export.scope`, `export.formats`, `export.backup` have RU + EN and no stale translation |

API smoke (server on `:1234`, owner cookie):

```bash
curl -s -b jar -D - http://localhost:1234/boards/<id>/backup -o backup.json   # 200 + attachment
curl -s -b jar -H 'content-type: application/json' \
  -d '{"scope":"board","format":"png","objectCount":27}' \
  http://localhost:1234/boards/<id>/export-jobs                                # 201 + jobId
```

## Stage 5 — AI entry, task dialog, journal (ADR-066/067)

Accounts from `pnpm acceptance:stage2`. Agents must be allowed in the organisation
(Organisation → Agents) and on the room (Ask AI… → the room switch); create an agent
there if none exists. A model call needs a provider key (`REMO_KEK` and a key in the
organisation or personal settings) — the cards skill and all entry checks work without
one.

| # | Step | Expected |
|---|---|---|
| AI-1 | Open the room through the public link, signed out | No Ask AI… item; `POST /boards/<id>/agent-tasks` returns 403 `ACCOUNT_REQUIRED` |
| AI-2 | Sign in as the member with a viewer grant (no team editor grant) | No Ask AI… item; the API says "you cannot edit this room" |
| AI-3 | As an editor open More ▾ → Ask AI… | Dialog shows agent, skill, task text, "What will go to the model", budget, and the room switch |
| AI-4 | Select two notes before opening Ask AI… | The payload list names exactly those objects with their text, capped at 20 × 200 characters; the note says the rest of the room is not sent |
| AI-5 | `POST /boards/<id>/agent-tasks` without `budget` | 422 `BUDGET_REQUIRED`; nothing appears in the task list |
| AI-6 | Run a diagram task with a budget | Task goes queued → running → applied; objects carry the agent in the info card |
| AI-7 | Select notes, choose the cards skill, Preview job then Run job | A card job appears with `N cards`, then `done/total` progress; the room gains cards |
| AI-8 | Stop a running card job, then press Resume | Status `stopped`, then the job finishes from where it stopped without duplicating cards |
| AI-9 | Organisation → Agents → journal: filter by skill and by "With errors" | Only matching calls remain; the counter reads `n of m` |
| AI-10 | Tamper with one `ai_runs` row in the database, then Verify chain | "Chain broken at #N" naming the record, not a generic failure |
| AI-11 | `pnpm docs:check` | `agents.task`, `agents.budget`, `agents.journal` have RU + EN and no stale translation |

## Stage 6 — facilitation: timer and voting (ADR-074/075/088)

Accounts and room from `pnpm acceptance:stage2`. The owner is a facilitator; the
member is an editor through the team grant. For a viewer check, remove the team grant.

| # | Step | Expected |
|---|---|---|
| FAC-1 | As an editor click ⏱ Timer → 5 min | A timer card appears in the middle of the view; the topbar shows `05:00` counting down |
| FAC-2 | Open the same room in a second tab | The countdown differs by at most a second; the card says who set it |
| FAC-3 | Pause, then resume | Both tabs freeze on the same value with the same name, then continue from it |
| FAC-4 | Press +1 min, then Reset | The end moves a minute later; Reset returns the card to "not started" and keeps the length |
| FAC-5 | Let a 1-minute timer reach zero | The card says "Time is up"; it does not disappear |
| FAC-6 | As a viewer | No timer controls and no ⏱ button; the countdown is still readable |
| FAC-7 | Select objects → Voting → quota 2, 5 min, anonymous → Start | The panel lists exactly the selected objects; "Votes left: 2 of 2" |
| FAC-8 | Vote twice, then try a third time (UI or API) | Counts rise; the third attempt returns 409 `vote_budget_exhausted` |
| FAC-9 | Withdraw one vote | The count drops and the quota returns |
| FAC-10 | Start a second session while one is open | 409 `VOTE_SESSION_OPEN`; the panel shows the open one |
| FAC-11 | End for all, then vote | The button becomes "ended"; a vote returns 409 `VOTE_SESSION_CLOSED`; "Top 3" appears |
| FAC-12 | Publish results | A text object with the top-10 appears on the room; audit has `vote.publish` |
| FAC-13 | Open the room through the public link with an open session and vote | The visitor can vote; a reload keeps the same quota; a different browser gets its own |
| FAC-14 | `pnpm docs:check` | `facilitation.timer`, `facilitation.vote` and `facilitation.follow` have RU + EN and no stale translation |
| FAC-15 | As two people (two tabs with `?user=Alice` and `?user=Bob`), Bob clicks Alice's avatar | Bob's view and zoom jump to Alice's; a pill says "Following Alice"; Alice sees `👁 1` |
| FAC-16 | Bob pans or zooms while following | The pill says "Following paused"; the view stays where Bob left it; Resume returns to Alice's view |
| FAC-17 | Alice opens `👁 1` → Stop everyone | Bob's pill disappears with "Alice stopped your follow"; Alice's counter returns to 0 |
| FAC-18 | Alice opens `👁 1` → Bring everyone to me | Each other participant gets "Follow / Stay"; Follow mirrors Alice. With "Follow automatically" on, the follow happens without a prompt |

Command layer (ADR-092):

```bash
# Idempotency-Key is mandatory; a 200 means the update is in the log.
curl -s -b jar -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"command":"board.item.create","input":{"type":"sticky_note","x":0,"y":0,"content":"Hello"}}' \
  http://localhost:1234/boards/<id>/commands
# Repeating the same key returns the same object with "replayed": true.
# Add "ifVersion":"<version from the first response>" to get 409 STALE after another write.
# board.connector.create/update are the same registry the agent change sets use.
```

API smoke:

```bash
curl -s -b jar -H 'content-type: application/json' \
  -d '{"objectIds":["a","b"],"votesPerSubject":2,"minutes":5}' \
  http://localhost:1234/boards/<id>/vote-sessions
curl -s -b jar -H 'content-type: application/json' \
  -d '{"objectId":"a"}' http://localhost:1234/vote-sessions/<sid>/votes
```

