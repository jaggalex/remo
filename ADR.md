# Architecture Decision Records

> **Public edition.** This is the historical decision record. Some research notes referenced
> in the text (`spec/evidence`, `spec/capture`, `spec/interaction-notes.md`, `spec/roadmap*`,
> `MVP.md`, `SPEC.md`) were internal working material and are kept in a private archive, not
> in this repository. The decisions and their consequences remain; the evidence is not
> republished.

## ADR-001: Canvas Coordinate System

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Miro uses a center-origin coordinate system where (0,0) is the canvas center. Widgets have `origin: "center"` and `relativeTo: "canvas_center"`. This differs from typical top-left origin systems.

### Decision
Adopt Miro's center-origin coordinate system for the clone:
- Canvas center = (0, 0)
- Positive X = right, Positive Y = down
- Widget position = center point of widget
- Viewport transforms via translation + scale matrix

### Consequences
- Simplifies zoom/pan (transform around center)
- Requires conversion for top-left based rendering libraries
- Consistent with Miro's API for potential interoperability

### Amendment (2026-10-23, measured)

Miro mixes two reference systems:

| Widget | `relativeTo` | `x`/`y` meaning |
|---|---|---|
| Frame, kanban, connector, root sticker | `canvas_center` | centre from canvas origin |
| Child of a frame | `parent_top_left` | centre from parent's top-left |

`absolute = parent_center − parent_size/2 + child_local`. `origin` stays `center` in both
cases. The clone stores **only absolute** coordinates and derives local ones at render
time; importers must convert (see `spec/capture/extract.py`).

---

## ADR-002: Widget Type System

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Miro has 9 widget types with distinct properties. Need a type-safe but extensible system.

### Decision
Use discriminated union with shared base interface:
```typescript
type Widget = TextWidget | StickyNoteWidget | FrameWidget | CardWidget | KanbanWidget | ConnectorWidget | ShapeWidget | ImageWidget;
```
Each type has a `type` discriminant field and type-specific properties in `style` and `metadata`.

### Consequences
- Type-safe access to widget properties
- Easy to add new widget types
- Serialization/deserialization requires type guards

---

## ADR-003: State Management — CRDT vs Operational Transform

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Real-time collaboration requires conflict-free concurrent editing.

### Decision
Use **Yjs (CRDT)** for shared state:
- Y.Doc per board
- Y.Map for widgets (key = widget ID)
- Y.Array for ordered lists (kanban columns, selection)
- Awareness protocol for cursors/presence

### Consequences
- Automatic conflict resolution
- Offline-first capable
- Requires WebSocket/WebRTC provider
- Learning curve for CRDT patterns

---

## ADR-004: Rendering Engine — Canvas vs SVG vs DOM

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Infinite canvas with 1000+ widgets needs performant rendering.

### Decision
**Hybrid approach**:
- **HTML Canvas** for widget rendering (high performance, transforms)
- **DOM overlay** for text editing, inputs, context menus
- **SVG** for connectors (path calculation, arrowheads)

### Consequences
- Canvas: fast pan/zoom, but text editing complex
- DOM overlay: native text editing, accessibility
- SVG connectors: crisp at any zoom, easy path math

---

## ADR-005: Template System Architecture

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Templates are parametric widget generators. Need to support official + community templates.

### Decision
Templates as **pure functions** + metadata:
```typescript
interface Template {
  id: string;
  metadata: TemplateMetadata;
  generate: (params: TemplateParams) => Widget[];
}
```
Registry loads at startup. Community templates via dynamic import.

### Consequences
- Templates are testable pure functions
- Versionable, shareable as npm packages
- Params allow customization (board size, color theme, etc.)

---

## ADR-006: Kanban Layout Algorithm

**Status**: Accepted — revised 2026-10-23 after live capture  
**Date**: 2026-10-22

### Context
A Miro kanban is **not** a simple ordered list of columns. The shipped templates show it
as a **matrix**: columns × swimlanes, with per-cell and per-header counts, per-cell `+`
add affordances, and swimlane operations (rename/add/delete/move up/down).

Miro's public API exposes the kanban widget as a bare `{x, y, width, height}` box:
columns, swimlane names and card membership are **not** returned. Waiting on an external
API for essential state is not an option, so the clone owns that state.

### Decision
Model the kanban explicitly and keep it in the widget's own document:

```typescript
interface KanbanState {
  columns:  { id: string; title: string; accent: string; wipLimit?: number }[];
  swimlanes:{ id: string; title: string; collapsed?: boolean }[];
  cards: Record<string, { columnId: string; swimlaneId: string; order: number }>;
}
```

- Card widget carries only presentation + content; placement lives in `KanbanState`.
- `order` is a fractional index (LexoRank-style) so drag-drop is a single-row update and
  concurrent moves rarely conflict.
- Layout is computed, never stored: `x = columnLeft(col)`, `y = laneTop(row) + order * h`.
- Header counts derive from `cards`, never from a stored counter.
- Swimlane operations are first-class commands (`renameSwimlane`, `addSwimlane`,
  `deleteSwimlane`, `moveSwimlane`), mirroring the observed context menu.

### Consequences
- Columns/swimlanes survive reload and collaboration (they are not inferred from colours).
- WIP limits and per-cell counts become cheap to enforce and test.
- Drag-drop is optimistic: update `order`/`columnId`, animate with FLIP, reconcile on sync.
- Two sources of truth are deliberately avoided: the canvas position of a card is always
  derived, so a stray `x`/`y` on a kanban card is ignored.
- **One gesture = one undo unit** (verified in the source product, `spec/interaction-notes.md`
  §10.2): `moveCard` writes `columnId`, `swimlaneId` and `order` in a single transaction, and
  `addColumn` also writes the container resize (`width += columnWidth`). Neither is split
  into several writes, otherwise undo would need several presses.
- Column width is **stored**, not derived from content: the source board widens the whole
  widget by exactly one column when a column is added (1474.6 → 2049.2).
- Swimlanes have no collapsed state (§10.3).

---

## ADR-007: Connector Routing

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Connectors link widgets with orthogonal or curved paths. Must avoid overlapping widgets.

### Decision
**Orthogonal routing with obstacle avoidance**:
- Start/end at widget edge centers (8 compass points)
- A* pathfinding on grid (cell size = 20px)
- Obstacles = widget bounding boxes + padding
- Fallback: direct bezier if no path found

### Consequences
- Clean professional look
- Performance: cache paths, invalidate on widget move
- Configurable routing style (orthogonal, curved, straight)

---

## ADR-008: Data Persistence — Backend

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Need durable storage with real-time sync.

### Decision
**PostgreSQL + Yjs WebSocket server**:
- Primary: PostgreSQL (widgets, boards, users)
- Real-time: y-websocket server (Yjs awareness + updates)
- Sync: Yjs updates → PostgreSQL (batched, eventual consistency)
- Export: JSON dump of Y.Doc state

### Consequences
- Single source of truth in PostgreSQL
- Real-time via proven Yjs infrastructure
- Horizontal scaling via y-websocket rooms

---

## ADR-009: AI Integration Pattern

**Status**: Deferred (2026-10-23) — not in scope for the first release  
**Date**: 2026-10-22

> Product decision: AI features are explicitly postponed. Keep the door open by
> isolating any future generator behind the `Template`/`Command` boundary — no AI code
> in the MVP, no provider chosen yet.

### Context
Miro AI features: "Generate roadmap from stickies", "Split epic", "Cluster by theme".

### Decision
**Client-side prompt templates + serverless function**:
- Pre-built prompts per AI action
- User selection → extract widget data → prompt → LLM → parse → create widgets
- Stream results for progressive UI
- Cache embeddings for clustering

### Consequences
- No vendor lock-in (swap LLM provider)
- Prompts versioned with code
- Cost control via prompt templates

---

## ADR-010: Export Pipeline

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Export formats: PDF, PNG, CSV, Embed code.

### Decision
**Headless Chrome (Puppeteer) for raster/vector + direct serialization for data**:
- PDF/PNG: Puppeteer renders board at target scale
- CSV: Direct widget serialization (cards, stickies)
- Embed: iframe with read-only mode + public token

### Consequences
- High-fidelity exports matching screen
- Server cost for Puppeteer
- Embed requires public board sharing logic

---

## ADR-011: Keyboard Shortcut System

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Miro has extensive shortcuts (⌘+K, ⌘+Z, M, ⌥+1, etc.)

### Decision
**Mousetrap-style declarative registry**:
```typescript
shortcuts.register({
  'meta+k': () => openCommandPalette(),
  'meta+z': () => undo(),
  'm': () => toggleMinimap(),
  'alt+1': () => fitToScreen(),
});
```
Context-aware (disabled in inputs, text editing).

### Consequences
- Centralized, testable shortcut definitions
- Easy to customize per user
- Prevents conflicts with browser shortcuts

---

## ADR-012: Color System — Named Palettes

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Miro uses named colors (`dark_blue`, `light_blue`, `yellow`) mapped to hex.

### Decision
**Named palette with theme support**:
```typescript
const PALETTES = {
  sticky: { dark_blue: '#0047BB', light_blue: '#2D9BF0', yellow: '#FFDD33', ... },
  card: { '#652CB3': 'Purple', '#FFDD33': 'Yellow', ... },
  dark: { ... },  // dark mode mappings
};
```
Widgets reference names; renderer resolves to hex.

### Consequences
- Easy theming (dark mode, high contrast)
- Consistent colors across widgets
- User-customizable palettes

---

## ADR-013: Undo/Redo — Command Pattern + Yjs

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Undo/Redo must work with real-time collaboration.

### Decision
**Yjs UndoManager per user**:
- Each user gets isolated undo stack
- Commands wrapped in Yjs transactions
- Remote changes don't pollute local undo

### Consequences
- Standard UX expectations met
- No conflicts between users' undo stacks
- Integrates with Yjs awareness

---

## ADR-014: Selection Model

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Multi-select, marquee select, shift-click, grouped selection.

### Decision
**Selection as Y.Set<widgetId> + primary selection**:
- `selection: Y.Set<string>` — all selected IDs
- `primarySelection: string | null` — last clicked (for alignment, properties panel)
- Marquee: rectangle intersection test on viewport-transformed bounds

### Consequences
- Real-time shared selection
- Properties panel binds to primarySelection
- Marquee works at any zoom level

---

## ADR-015: Viewport & Zoom

**Status**: Accepted  
**Date**: 2026-10-22

### Context
Smooth zoom/pan with minimap, fit-to-screen, preset zooms.

### Decision
**Transform matrix + CSS transform for canvas**:
```typescript
viewport = { x: 0, y: 0, zoom: 1 };
canvas.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
```
Minimap: separate canvas, same scene, fixed scale, viewport indicator rect.

### Consequences
- GPU-accelerated pan/zoom
- Sub-pixel rendering
- Minimap stays crisp at any zoom

---
---

## ADR-016: Real-time Collaboration (multi-user from day one)

**Status**: Accepted (2026-10-23)
**Date**: 2026-10-23

### Context
The product is built for a small circle of collaborators, not a single user. Retrofitting
multiplayer later would touch every state path, so it is designed in from the first commit.

### Decision
- **Yjs** document per board as the single realtime source of truth.
- `y-websocket` server in the same monorepo (`apps/sync`), deployed next to the API.
- Widgets live in `Y.Map<widgetId, Widget>`; kanban placement in nested `Y.Map`s.
- Presence and cursors via the Yjs **awareness** protocol (ephemeral, never persisted).
- Undo scoped per user with `Y.UndoManager` and `trackedOrigins`.
- Postgres is a durable projection written by a debounced persistence worker; the room
  can always be rebuilt from the log.

### Consequences
- Offline editing and reconnect work without a custom merge algorithm.
- Server needs sticky sessions per room; scaling follows room count.
- Every mutation must be expressed as a Yjs transaction — no ad-hoc React state that
  bypasses the doc.

### Implementation note (2026-10-23)

The document layer shipped **before** the transport, on purpose: `packages/doc` wraps a
`Y.Doc` in-process, so the app already reads and writes the shared document with no local
mirror of widget state. Adding the WebSocket transport later was a transport change, not a
rewrite.

Undo is configured with `trackedOrigins: new Set(["local-ui"])` and `captureTimeout: 0`, and
every command issues exactly one transaction. That is what reproduces the source product's
"one gesture = one step" behaviour (verified: cross-cell card move and add-column each undo
in a single press), while template import uses a separate `import` origin so it stays out of
the history and a remote client's edits are never rolled back by a local undo.

### Transport (2026-10-23)

`apps/sync` is a small `ws` server: `setupWSConnection` per room, awareness relayed by the
same library, and rooms mirrored to disk behind `bindState`/`writeState`. Those two hooks are
the seam where the Postgres projection will land, so the stand-in is not a detour.

Three things the implementation had to get right, all found by testing:

1. **Version pairing.** `@y/websocket-server` currently depends on a Yjs 14 prerelease and
   cannot decode Yjs 13 updates (`store.getClock is not a function`). The server therefore
   uses `y-websocket@1.5.4` utilities, matching the client exactly. It also resolves Yjs
   through `createRequire`, because the utilities are CommonJS and an ESM import of the same
   package loads a second copy of the library (dual package hazard).
2. **Seeding a room must be conditional.** A client loading a template on mount would erase
   the room's content for everyone. Seeding now waits for the first `sync` and happens only
   if the document is empty; loading a template afterwards is an explicit user action.
3. **Presence keepalive lives on the server.** Awareness entries age out after 30 s of
   silence. The protocol library renews a client's own state every ~15 s, but a hidden tab
   has its timers throttled to a minute or worse, so an idle tab vanished from everyone's
   roster — including for people who joined later, which is why reloading "lost" peers. The
   sync service now renews the clock on behalf of clients that have been quiet for 20 s and
   re-broadcasts. Clocks only increase and the owner receives the same broadcast, so its
   subsequent updates stay consistent. Verified with a frozen client
   (`apps/sync/keepalive-test.mjs`).

### Durable store (2026-10-23)

Rooms now live in Postgres when `DATABASE_URL` is set (disk fallback otherwise), behind the
same two hooks, so the sync service is unchanged:

- `board_updates` is an append-only log of Yjs updates and `boards.snapshot` is a compacted
  checkpoint with `snapshot_through`; a room is rebuilt by applying the snapshot and then the
  newer log entries. The projection is therefore disposable — which is what "durable
  projection" has to mean to be worth anything.
- `widgets`, `kanban_columns`, `kanban_swimlanes` and `kanban_cards` are the queryable
  projection, refreshed on a 1.5 s debounce and written **as a diff** against the previous
  in-memory projection, so ordinary editing touches a handful of rows rather than rewriting
  the board.
- Compaction folds the log into the snapshot after 200 updates and on shutdown; `writeState`
  flushes the log, refreshes the projection and compacts, so a restart never loses anything.
- `scripts/db-check.mjs` is the preflight: version, schema creation, write/read round trip.
  Verified end to end: edit in the browser → rows in `widgets`/`kanban_cards` → restart the
  service → the client reloads the same board from Postgres instead of re-seeding a template.

### Seed once, not on every reload (2026-10-28)

The conditional seed above was still conditional on `widgets.length === 0` at the moment
sync flipped. A reload can expose one frame where the local document is empty before the
server state lands; the template then seeds over the arriving board. M1's card fields made
the race visible: a named board lost its card status, assignee and dates on reload.

- A **named board** opened **without `?template=`** is never seeded. It is a board someone
  already created; if it is empty, it stays empty and the template buttons add content.
- An explicit `?template=<key>` always seeds once; `?template=empty` suppresses the default.
- Only a legacy room with no server title gets the default template.
- The round-trip is covered by `e2e/cards.spec.ts`: status, assignee and a date range survive
  a reload of a named board.


### Rendering and caching (2026-10-23)

The board is painted on two canvases, because the two kinds of change have wildly different
frequencies:

- **Board layer** — frames, stickies, cards, kanban matrices, selection. Repainted only when
  the document, the camera or the selection changes.
- **Overlay layer** — remote cursors, marquee, kanban cell hover, drag ghost. Repainted on
  its own, so cursor traffic never touches the board.

Three details make it hold:

1. **Coalescing.** State changes only mark a layer dirty; one `requestAnimationFrame` paints
   whatever is dirty. A burst of events costs one paint per frame — measured: 60 pointer
   moves produced 30 overlay paints and **0** board paints.
2. **Stable scheduler.** The painters are looked up through a ref, so `invalidate` keeps its
   identity. Putting the painter functions in the dependency array instead made every cursor
   update re-run the board effect — the same measurement showed 20 board repaints before the
   fix and 0 after.
3. **A timer backs up the animation frame.** A window that is occluded produces no frames at
   all, and a canvas app that only paints on `requestAnimationFrame` would stay blank; the
   fallback guarantees the first paint happens regardless.
4. **Culling.** Objects outside the visible world rectangle (plus a margin) are skipped, so
   board size stops mattering to paint cost.

Every scheduling bug here was silent — the canvas simply stayed empty with no exception — so
the dev probe reports counters (`__remo.perf()`: paints per layer, invalidations, last
paint duration, last error) instead of leaving it to guesswork.

### Inline text editing (2026-10-23)

Text is not a field on the widget record. Each widget's text lives in its own `Y.Text`
inside a `texts` map:

- **Streaming.** The editor writes on every keystroke — the source product does the same
  (measured: the title is readable mid-typing, `spec/interaction-notes.md` §1) — so remote
  participants watch the sentence appear instead of receiving it on blur.
- **Character-wise merge.** Edits are applied as a prefix/suffix diff, so two people typing
  in one note do not overwrite each other the way a whole-string write would.
- **One editing session is one undo step.** `captureTimeout` is 400 ms, which merges
  keystrokes, and every command calls `stopCapturing()` first so a drag or a menu action
  stays a single step. Timing is never what separates two gestures.
- **Materialized for painting and storage.** Snapshots fold the shared text back onto
  `title`/`content` for the renderer, and the Postgres projection reads the `Y.Text`
  directly, so the database cannot go stale between a keystroke and the next snapshot.
- The editor is a DOM `textarea` positioned over the object in screen space (a canvas cannot
  receive real text input); the canvas keeps painting the text underneath it.

### Interaction notes (2026-10-23, from review)

- **A drag is one transaction.** Writing a position on every pointer move made undo replay
  the path like a reverse movie and broadcast every frame to peers. The move is now local
  paint state and lands as a single `moveWidgets` transaction on drop — one undo step, one
  message.
- **Header menus beat hidden toolbar buttons.** Column and swimlane actions are behind a
  right-click on the header (rename / add / move / delete), matching the source product, with
  the same actions mirrored in the sidebar for discoverability.
- **An empty room explains itself.** With no sync service reachable the app falls back to
  local-only instead of showing a blank canvas, and an empty board says so and offers the
  templates.

---

## ADR-017: No Miro SDK compatibility layer

**Status**: Accepted (2026-10-23)
**Date**: 2026-10-23

### Context
A Miro-shaped API (`miro.board.createStickyNote`, …) was considered for portability.
Miro's own API cannot read kanban columns, swimlanes or card placement, and its widget
model mixes two coordinate systems. Copying it would import those limitations into our
core.

### Decision
Define our own domain API, optimized for what the UI needs:

```typescript
createWidget(kind, props)   // discriminated union by kind
patchWidget(id, patch)      // partial update, one Yjs transaction
moveSelection(dx, dy)
groupSelection() / ungroup()
```

Miro's API stays a **research oracle only**: it tells us what a template contains and
what a widget looks like, never how our data model should be shaped.

### Consequences
- No legacy baggage; kanban state, groups and templates are first class.
- If import from Miro is ever needed, it is a one-way adapter (`miroDump → our doc`),
  which the capture files already prove is straightforward.

---

## ADR-018: Application stack

**Status**: Accepted (2026-10-23)
**Date**: 2026-10-23

### Context
Confirmed by the product owner: React + TypeScript + Vite, Canvas renderer per ADR-004.

### Decision
| Layer | Choice |
|---|---|
| Build | Vite + TypeScript (strict) |
| UI | React 18, Zustand for editor-local state, TanStack Query for server data |
| Canvas | Custom renderer over Canvas 2D with a scene graph; DOM overlay for text editing |
| Realtime | Yjs (ADR-016) |
| Storage | PostgreSQL + Drizzle migrations |
| Monorepo | pnpm workspaces: `apps/web`, `apps/sync`, `apps/api`, `packages/canvas`, `packages/model`, `packages/templates` |
| Tests | Vitest (model/layout), Playwright (canvas + collaboration) |

### Consequences
- `packages/model` has zero React dependency, so layout and document logic are unit-testable.
- Template generators are plain functions producing a widget tree — the captured
  `spec/templates.json` can be loaded in tests to assert pixel parity.
- Canvas keeps 1000+ widgets interactive; the DOM overlay keeps text input accessible.

---

## ADR-019: Applying a template adds to the board

**Status**: Accepted (2026-10-23)
**Date**: 2026-10-23

### Context

The clone originally replaced the whole board when a template was loaded. The source product
does not: applying a template **adds** it and leaves the existing board alone (measured —
`spec/client-path.md` §1.1: a board went from 20 to 94 widgets with both sets intact). The
product owner's authoring path is exactly this: create a board, use a template, add another
one, and then add plain stickies, shapes and connections on top.

Two consequences fall out of that:

1. Widget ids from two templates can collide — both captures ship the ids they were created
   with — so an insert has to remap every id and every parent link.
2. Placement is a clone decision, not a compatibility requirement: the source anchors the new
   template and lets it overlap (`spec/client-path.md` §1.2).

### Decision

- `insertTemplate(board, template, kanbanStates)` adds content, remapping ids and kanban
  placements, in one transaction (one undo step). It places the template to the right of the
  existing content, aligned to its top, because a readable board beats overlap.
- Loading a template remains available as an explicit **Replace board** action, behind a
  confirmation, for the empty-room seed and for deliberate replacement.
- Applying the same template twice is safe by construction.

### Consequences

- A board can hold several templates, which is what the authoring path needs.
- The kanban matrix of the *second* template points at the new kanban widget, so counts and
  drag-and-drop keep working per board.
- Undo after an insert removes exactly that template's widgets.

---

## ADR-020: Authoring widgets — stickies, shapes and connectors

**Status**: Accepted (2026-10-23)
**Date**: 2026-10-23

### Context

The owner's authoring path (`spec/client-path.md` §2) is not only templates: a board is built
by adding stickies, recolouring them, connecting them, and composing shapes into diagrams
joined with arrows. `MVP.md` §3 had connectors and shapes out of scope; that was wrong for
this product.

### Decision

- **Sticky colour** is a *name* (`yellow`, `green`, …), because that is what the source stores
  in `style.fillColor` for stickies while card themes are hex (`SPEC.md` §3.3). The palette
  lives in `packages/model/src/palette.ts` and only applies to stickies.
- **Connectors store endpoints, never geometry.** `start.item` / `end.item` reference two
  widgets; the line, its clipping to both boxes and its arrow head are derived at paint time
  (`packages/canvas/src/connectors.ts`). This is the kanban rule again (ADR-006): the visible
  layout is not stored state, so moving an object cannot leave a stale line behind.
- **Deleting an object deletes the connectors attached to it** — a line to nothing is
  meaningless. Template insertion remaps endpoints like any other reference, and drops a
  connector whose endpoint did not come along.
- **Shapes** are a `shape` widget with a `shapeKind` (rectangle, round rectangle, ellipse,
  diamond, triangle) and sensible default sizes per kind.
- **Connecting two shapes gives an arrow** (`arrow: "end"`); between plain notes it stays a
  plain line, matching the diagramming path.

### Interaction

Both ways the source offers are supported: two selected objects expose a **Connect** button,
and a single selection shows an **anchor** on its right edge that can be dragged onto another
object. The canvas decides what a click means by *paint* order, not insertion order — an
object dropped on top of a kanban is picked before the kanban, which is what makes authoring
over a template possible.

### Amendment (2026-10-23, after the owner's first run)

- **Kanban cards are not connectable** (second run, 2026-10-24 — reverses the first-run
  decision above). A card stores no coordinates of its own (ADR-006), so its box has to be
  resolved from the matrix; that made an anchor possible, and it was briefly offered. In use it
  was noise: the source product has no anchor on a card, and a card-to-card link means nothing
  when a card's position is a column, not a place. Cards were removed from `canConnect`, and a
  connector is never created to or from one. The matrix-resolution code stays: connectors still
  need a card's box if one was linked before this decision.
- **A connector can be selected and deleted.** It stores the bounding box of its two ends, so a
  hit test against that box either swallows a large empty rectangle (diagonal line) or has zero
  height (horizontal line). Connectors are therefore picked by distance to their line
  (`pickConnector`, 8 px at any zoom) and can be selected with a click and removed with Delete,
  or with the right-click menu. This was a real bug: a line could be created but not deleted.
- **Everything under the cursor follows paint order.** Both picking *and* double-click now ask
  which widget is painted on top before falling through to the kanban matrix. Before this, a
  note dropped over a kanban could not be selected and a double-click on it created a card in
  the cell beneath it.
- **Typing never shrinks a note.** Until there is a resize affordance, a text edit only grows a
  note: typing one word into a template sticky must not collapse it to the minimum height.
- **Only leaves can be endpoints** (`canConnect`: notes, text, shapes, cards, stickers, images).
  A first run produced a line attached to the *whole kanban widget* after a drag was released
  over an empty cell; because that box spans the board, it drew as a stray line. Containers are
  now refused, and a drop inside a kanban attaches to the card under the cursor instead.
- **Trackpad gestures follow the platform**: two-finger scroll pans, pinch (reported as
  `ctrlKey` + wheel) or ⌘/Ctrl + scroll zooms around the pointer. Zooming only ever scales the
  board; every panel is DOM and stays fixed.
- **Wheel handling is a native, non-passive listener.** React registers `wheel` as passive, so
  `preventDefault()` inside `onWheel` is ignored: the browser is free to zoom the *page*, after
  which the canvas no longer matches pointer coordinates and the board appears to stop
  responding. A `passive: false` listener on the canvas claims the gesture, and Safari's
  `gesturestart`/`gesturechange` are cancelled as well. This was the "sometimes the whole sheet
  zooms" instability.

### Consequences

- Connectors are cheap: joining two objects writes one small widget, and dragging either end
  writes nothing extra.
- The projection records `startItem`, `endItem`, `arrow` and `shapeKind` in `widgets.props`,
  so the read path knows what is linked to what.
- Routing is straight-line only. Orthogonal routing, labels on connectors and arrow style
  choices stay out of the MVP.

## ADR-021: Interface language is a client-side dictionary

**Status:** accepted (2026-10-24)

**Context.** The workspace is used by a small circle whose working language is Russian, while
the domain vocabulary (templates, swimlanes, story maps) is English. A full i18n framework
would add a dependency, a build step and pluralisation rules for a single extra language; a
language server or per-board language would make two people see the interface differently on
the same board.

**Decision.** The interface is translated by one flat dictionary in `apps/web/src/i18n.tsx`
(English and Russian), reached through a `useI18n()` hook. The choice is per browser, stored in
`localStorage` under `remo.lang`, defaults to the browser's preferred language, and is switched
with an EN/RU control in the header. `<html lang>` follows the choice.

**Consequences.**

- Adding a string means adding one key to both languages; a missing translation is a type error.
- Counted phrases use a small plural helper (Russian needs one/few/many); there is no ICU
  dependency.
- Board content is never translated: widget text, board names and template titles stay as
  written. The interface language is not shared through the room.
- A third language is a new record in the same table, not a new mechanism.
- `?lang=en|ru` in the address is a one-off override for links and screenshots. Choosing a
  language in the header removes it, so the stored choice is what the next reload reads.

## ADR-022: Groups are membership, not containers

**Status:** accepted (2026-10-24)

**Context.** People need to move a caption with its note, or a pair of stickies, as one thing.
The obvious model is a group object with a box that owns its members. The source product has
such an object, and the capture confirms it: one `group` widget in `product-roadmap-basic`, with
`x`, `y`, `width` and `height` all `null` and a list of `itemsIds`. A container would have to
answer geometry questions — what is the group's box, what happens when a member is deleted, what
happens when a frame and its child are both grouped — and every answer would add a state the
document can disagree about.

**Decision.** A group is a property of its members: `Widget.groupId`, one level, no group object
(`packages/model/src/groups.ts`, `groupWidgets`/`ungroupWidgets` in `@remo/doc`).

- Grouping a selection assigns one new id to every root of the selection. Selecting a descendant
  whose ancestor is also selected is ignored: a frame and its sticky are already one item, and
  giving the sticky its own membership would make a click on it select a different group from
  the frame around it.
- Grouping a selection that is already exactly one group is a no-op rather than a new id, so
  ⌘G cannot silently dissolve and recreate a group.
- Grouping merges: members of an older group get the new id.
- Cards and connectors are never grouped. A card's place is a column in its kanban, and a
  connector follows two endpoints; neither has a meaningful group.
- Ungrouping any member dissolves the whole group — half a group is never a state a person asked
  for — and so does deleting any member.
- Clicking, Shift-clicking, marqueeing or dragging any member selects the whole group, and the
  whole group draws one union box labelled "Group" instead of an outline per member.

**Consequences.**

- Nothing has to be migrated: existing boards simply have no `groupId`.
- A group has no box on the canvas, so clicking the empty space between two members selects
  nothing. That is the behaviour of every membership-based grouping, and it is honest: the box
  is a selection affordance, not an object.
- Nested groups do not exist. Grouping a group with something else merges both into one group.
- One level means the selection model stays a flat list of ids, and undo stays one step per
  gesture.

## ADR-023: Clipboard fragments are our own JSON

**Status:** accepted (2026-10-24)

**Context.** Copy and paste has to work inside one board, between two boards in different rooms,
and between two machines. It also has to survive the case that matters most in practice: a
selection that is not self-contained — a frame whose stickies are inside it, a kanban whose cards
live in its own matrix, a connector whose endpoints are two of the copied objects. The system
clipboard is the only transport that crosses browsers and machines without a server.

**Decision.** A copy is serialized as a `BoardFragment` (`copyFragment`/`pasteFragment` in
`@remo/doc`) and written to `text/plain` as JSON tagged `{kind: "remo/fragment", version: 1}`
(`apps/web/src/clipboard.ts`).

- A copy includes everything the selection owns, transitively: a frame takes its contents, a
  kanban takes its columns, swimlanes and card placements. A connector is included only when
  both of its endpoints are included — a line to an object that was not copied has nothing to
  join.
- Paste remaps every id, then every parent link, connector endpoint and group id, and writes a
  fresh kanban matrix whose card ids are the remapped ones. All of it is one transaction, so a
  paste is one undo step.
- A card copied on its own is appended to the end of the same cell in the target kanban. If that
  kanban or that cell is gone, the card is dropped rather than left floating outside a matrix.
- A right-click paste lands where the click was, applying the fragment's own top-left corner;
  ⌘V cascades by a small offset so the copy never lands exactly on the original.
- Text that is not a fragment is pasted as a sticky note, which is what the source product does
  with foreign text. A page served over plain HTTP on a LAN has no `navigator.clipboard.readText`,
  so the tab keeps its last fragment in memory and pastes that.

**Consequences.**

- The payload is readable and diffable, and a wrong or foreign clipboard simply falls through to
  the plain-text path instead of failing.
- Nothing about the format depends on the receiving board: ids are remapped, never reused.
- A copy from another product is not understood as a fragment, which is the intended behaviour —
  there is no compatibility layer (ADR-017).
- The fragment carries text deltas, so formatting (ADR-024) survives a copy.

## ADR-024: Rich text is per-character marks on a shared `Y.XmlText`

**Status:** accepted (2026-10-24)

**Context.** Notes need bold, italic, underline and strikethrough, and they are edited by several
people at once. The document already stores each note's text in a shared `Y.Text`, and height
growth, paint order and the editor all read from there. A second parallel representation (HTML in
a widget field, say) would have to be merged by hand and would fight the CRDT.

**Decision.** A note's text may be a shared `Y.XmlText` carrying the four marks; the plain case
stays a `Y.Text` (`packages/model/src/types.ts`, `setWidgetDelta` in `@remo/doc`).

- Migration is lazy: a note keeps its `Y.Text` for as long as it has no marks, and the value is
  replaced by an `Y.XmlText` inside the same transaction as the first mark. Boards that exist
  today are untouched.
- `Y.XmlText.toString()` serializes tags (`<bold>Hello</bold>`), so display, height and the
  clipboard read the delta (`plainOf`/`deltaOf`/`runsOf`), never `toString()`.
- The editor sends the whole delta on every input event; the document reconciles it against what
  it holds as a common-prefix / common-suffix diff over characters *and* their marks, then
  deletes and reinserts only the changed middle. Insertions pass explicit marks (`bold: null`
  when unset) so a plain run never inherits the formatting to its left.
- A delta with no marks and no shared rich text takes the plain path: the cheap `Y.Text` merge and
  the existing layout, byte for byte.
- The widget materializes the runs for the painter (`Widget.runs`), which is `undefined` when
  nothing is formatted, so an ordinary note paints exactly as before.
- The editor is a `contentEditable` element with a formatting toolbar (and ⌘B/⌘I/⌘U). Only the
  four marks cross the DOM boundary: what the painter draws is derived from the delta, and
  foreign HTML cannot leak into a note.

**Consequences.**

- One edit is still one undo step, and two people typing in the same note still merge
  character-wise.
- Height is measured from the runs, so a note with a bold line is as tall on screen as in the
  painter.
- The rich value wins over a concurrent plain edit to the same note (the upgrade replaces the
  map entry); a plain-typed note is never upgraded twice because the check reads the live value.
- Cards keep the plain path: a card's title is a kanban cell's content, and the source product
  offers no formatting affordance there.

## ADR-025: Operational reliability — metrics and backups

**Status:** accepted (2026-10-24)

**Context.** The service is a long-running process holding every board in memory, and the
database is the only durable copy. "It felt fine yesterday" is not an operational story: when a
room stops syncing, the first questions are how many connections are open, how many rooms are
resident, whether writes are failing, and how far back the data goes.

**Decision.** Two small, dependency-free pieces.

- `apps/sync/metrics.mjs` is a counter/gauge registry with a Prometheus text renderer, scraped at
  `GET /metrics` (also reachable as `/api/metrics` through the dev proxy). It reports HTTP
  requests per route, WebSocket connections accepted/closed/open, rooms in memory, boards in the
  store, store writes, failed writes, compactions and projection refreshes, plus process uptime,
  memory and event-loop lag.
- `GET /health` answers the operator's first questions in one call: ok, store kind, connections,
  rooms, uptime, and the store's own detail (database version, board count). The status code
  follows the store, so a shallow probe can use it either way.
- `scripts/db-backup.mjs` (`pnpm db:backup`, `pnpm db:backup:list`, `pnpm db:restore`) dumps the
  database with `pg_dump --format=custom`, writes a JSON manifest beside each dump (size, sha256,
  per-table row counts), and prunes to the newest `REMO_BACKUP_KEEP` (14) dumps. It uses
  `pg_dump` from `PATH` when present and otherwise asks the compose container to run it, so a
  machine with only Docker still gets a real dump.
- A restore is destructive and is treated that way: it prints what it would replace and changes
  nothing without `--yes`; it takes a safety backup of the current state first; and it refuses to
  overwrite a database that holds boards unless `--force` says the loss is intended.

**Consequences.**

- No new dependency and no sidecar: the metrics endpoint is the same process that must stay up.
- Route labels are normalized (`/boards/:id`) so a registry cannot grow a series per board.
- A restore from a custom-format dump requires `pg_restore`, which the same fallback path
  provides; the archive is streamed into the container over stdin.
- Dumps live in `backups/` (git-ignored). They are the copy of last resort, not the only copy:
  the update log and snapshot still make a room rebuildable from the database itself.

## ADR-026: Alignment is computed from the drag footprint, not from the widget

**Status:** accepted (2026-10-24)

**Context.** Dragging an object near another one leaves it a few pixels off, which is
the difference between a tidy board and a messy one. The source product solves this
while you drag: dashed lines appear, and the object is pulled onto the line it is
near. Cards are a special case — their place is decided by a kanban cell, not by the
pixel under the cursor.

**Decision.** `snapMove` in `packages/canvas/src/guides.ts` takes the box of the drag
and the boxes it can line up with, and returns a correction plus the guides that
correction produced.

- The drag footprint is the union box of everything lifted, captured once at the start
  of the gesture. A group of notes therefore snaps as one object, and recomputing the
  box from the moved widgets cannot feed the snap back into itself.
- Each axis is decided independently: an object can line up horizontally with one
  neighbour and vertically with another, which is the dashed cross the source product
  shows.
- Left edge, centre and right edge (top, middle, bottom) are all candidates. The
  smallest correction within the tolerance wins; every candidate that agrees with it
  becomes a line, so the lines always describe where the object actually went.
- The tolerance is six screen pixels divided by the zoom, so snapping feels the same
  at 20 % and at 200 %.
- Guides are drawn across the whole viewport, not just between the two boxes: an
  alignment is a line across the board, and a segment hidden under the dragged object
  would explain nothing.
- Kanban columns are snap targets too, but edges only (`centers: false`): lining a
  note up with a column's edge is the grid people work in, while a column's centre is
  where its cards sit and is noise as a target.
- The place an object came from keeps a dashed outline (`drawDragOrigin`), so a drag
  cannot be mistaken for a copy, and the carried object gets a shadow so it reads as
  lifted. A carried card is hidden from its matrix and shows only that ghost.
- A card is not snapped: its cell decides the result. While it is over a cell, the
  guides show the card edges of that cell (`cellGuides`) — the lines it will really
  land on, not a promise the drop does not keep.
- Connectors resolve their endpoints through the drag offset, so a line stays attached
  to a note while the note is carried.

**Consequences.**

- One gesture is still one transaction: the snap changes the offset that is committed,
  never the number of undo steps.
- A drag with no nearby neighbours produces no lines, because there is nothing to
  align to.
- `guides.ts` is pure geometry, so the cases that are hard to reproduce by hand
  (ties, both axes, deduplication) are covered by unit tests.

## ADR-027: A note keeps its size, and Auto fits the text to it

**Status:** accepted (2026-10-24)

**Context.** The first version of sticky notes grew taller as text was typed. That
fixed clipping, but it makes a board of notes ragged: three stickies in a column end
up three different heights, and the story-map and kanban templates - which place
notes on a grid - stop being a grid. The source product does the opposite: a note is a
fixed physical object, and the text fits inside it.

**Decision.** A note's text size is a property, and Auto is the default.

- Auto (`style.fontSize` absent) picks the largest whole-pixel size that fits the
  text inside the note's box, searched between 8 px and a cap that depends on the
  note's preset (S 13, M 16, L 20). The search is a binary search because "does it
  fit" is monotonic in size.
- An explicit size (the `+`/`−` controls, 6-96 px) is honoured as chosen; the note
  clips the overflow at its border, exactly like a physical note.
- Typing no longer resizes the note. Resizing is a deliberate gesture: four corner
  handles on a singly selected note, the opposite corner staying put, committed as one
  transaction.
- The note carries `stickySize` (S/M/L presets: 120², the captured 161.2×184.7, 224²)
  and `textAlign`/`textVAlign` (default centre/centre, as the source product shows).
- The floating note bar exposes these properties: colour, size, text size, B/I/U/S,
  a 3×3 alignment grid and the buttons that grow a chain of connected notes. It stays
  visible while the note is open for editing; there, the marks apply to the selection
  and everywhere else to the whole note.

**Consequences.**

- Notes stop growing, so the earlier "notes grow with their text" decision is
  superseded. Existing boards are unaffected visually until text is edited; a note
  whose text no longer fits now shrinks its letters instead of its neighbours moving.
- Auto is recomputed from the widget and its text, never stored, so resizing a note or
  zooming does not write anything.
- The painter and the editor share `noteFontSizeFor`, so the caret is the same size as
  the letters around it.
- Bold/italic/underline/strike on the whole note are one undo step and apply to every
  character, which is what the toolbar button means when there is no caret.

## ADR-028: A chain of connected notes in four directions

**Status:** accepted (2026-10-24)

**Context.** Thinking in notes is a flow: one idea leads to the next, and drawing the
connector by hand every time breaks it. The source product lets Tab grow a chain and
draws the link itself; the captured board shows the result - two notes with an arrow
between them.

**Decision.** `createConnectedNote` creates a note beside the source and a connector
between them, in one transaction.

- Directions are `left`, `right`, `up`, `down`; the new note is placed one gap (28
  units) away, outside the source's box, so the pair never overlaps.
- The new note inherits colour, size preset, text size and alignment. A chain grown
  with Tab therefore reads as one thought instead of a rainbow.
- The connector's arrow points at the new note and its line is derived from the two
  boxes, so the existing edge-clipping already makes it leave the facing side - right
  to left for a horizontal pair, bottom to top for a vertical one.
- Keys, while editing: `Tab` right, `Shift+Tab` left, `Alt+Enter` below,
  `Alt+Shift+Enter` above. `Enter` alone stays a newline, which is what makes a note
  multi-line. With a note selected but not open, `Tab`/`Shift+Tab` grow the chain too.
- The same four directions are buttons in the note bar, so the feature is discoverable
  without knowing a shortcut.
- After creating, the new note is selected and opened for typing, and the camera
  centres on it if it would land outside the viewport - a chain walks off-screen after
  a few steps otherwise.

**Consequences.**

- One gesture, one undo step: the note and its connector arrive and disappear together.
- A connector created this way is an ordinary connector: it can be picked by its line,
  deleted, and it disappears with either endpoint.
- Growing a chain from something that holds no text (a kanban, a card, a connector) is
  refused rather than creating a meaningless link.

## ADR-029: A connector is a side, a shape and a stroke — not just two ids

**Status:** accepted (2026-10-24)

**Context.** The first version of connectors stored two widget ids and drew a straight
line clipped to both boxes. The source product's own model is richer, and reading it
from a live board shows exactly how rich (`window.miro.board.get()` on the captured
board):

```
connector: { shape: "curved" | "elbowed" | "straight",
             start: { item, snapTo: "right"|"left"|"top"|"bottom", position: {x,y} },
             end:   { item, snapTo: "left", position: {...} },
             style: { startStrokeCap, endStrokeCap, strokeStyle, strokeWidth,
                      strokeColor, color, textOrientation },
             captions: [] }
```

Its line-type menu offers STRAIGHT / SQUARE / BEZIER plus NORMAL / DASHED / DOTTED and
a "Line jumps" toggle; its colour dialog carries 21 colours in light/base/dark
triples. The screenshots the owner supplied show all of it: a straight arrow between
two notes, an elbow between the same two, anchor dots on a note's edges, and the
colour palette.

**Decision.** The model follows the source product where it matters for drawing and
stops short of what we do not implement.

- `ConnectorEnd` carries `side` (`left`/`right`/`top`/`bottom`) and an optional
  `offset` along it. Absent side means "whichever side faces the other end", which is
  what a line drawn without an explicit anchor means, and it keeps old boards working.
- `connectorShape` is `straight` | `elbowed` | `curved`, the same three names.
- `style.strokeStyle` is `normal` | `dashed` | `dotted`; `style.strokeWidth` and
  `style.strokeColor` are honoured. The colour palette in the connector bar is the
  source product's own list, copied value for value.
- Routing lives in `packages/canvas/src/connectors.ts` and is derived on every paint:
  a straight line joins the two anchors; an elbow leaves each object along its side's
  normal for a stub, then turns on the axis both sides share (or at one corner when
  the sides are on different axes); a curve is a cubic bezier whose control points sit
  on those same normals, so it leaves and enters perpendicular.
- Picking measures the distance to the whole path, so an elbow is grabbed by its leg
  and a curve by its arc, not by the straight chord between its ends.
- A selected note shows four anchors — one per side — while the pointer is over it, so
  a line can leave from the side that faces its target. The far end anchors on the
  side facing the source, which is what makes the line arrive perpendicular.
- The connector bar exposes the type, the dash, the colour, both arrow ends, swap ends
  and delete. "Swap ends" moves the arrow with the direction.
- Copy style / Paste style travel between objects: for a note that is colour, size
  preset, text size, alignment and emphasis; for a connector it is shape, dashes,
  colour and arrow. Text, geometry and links are not part of a style. Pasting a sticky
  size preset resizes the note, because the preset *is* geometry.
- "Clear content" empties a note or card's text in one step.

**Consequences.**

- Existing connectors keep working: without a side they behave exactly as before.
- The auto-created chain from ADR-028 now records the facing sides, so a chain of
  notes is anchored right-to-left and bottom-to-top rather than clipped by geometry.
- Line jumps, captions on a line, "insert shape" on a line, lock and translate stay
  out; they are separate features, not properties of the anchor model.
- Connector geometry is still never stored: `start`/`end` plus the two boxes are the
  only inputs, so dragging a note keeps the line attached with no extra writes.

## ADR-030: One colour palette, and the UI rules that keep it that way

**Status:** accepted (2026-10-24)

**Context.** The first pass had two colour pickers: one for note fills with named
pastel colours, one for connector strokes with 21 hex values. Two lists, two popovers,
two ideas of "green". That is the kind of duplication that turns into debt: someone
adds a colour to one list, the other one drifts, and the same board ends up with two
greens that were meant to be the same. The owner named it directly: one decision for
everything, differences are an antipattern.

**Decision.** One palette and one picker serve every object that has a colour.

- `BOARD_COLORS` in `packages/model` is the only list. It is the source product's
  connector palette, read from its colour dialog: light / base / dark triples, which
  is why the same value works as a note fill and as a line stroke.
- `apps/web/src/ColorPicker.tsx` is the only picker: a round trigger, a 6-column grid,
  and a thin ring on each swatch so pale colours stay visible on white.
- Notes and connectors store the chosen hex directly. The old named colours
  (`yellow`, `light_blue`, …) stay in `STICKY_COLORS` purely as a translation table for
  captured boards, and `stickyFill` resolves both forms, so nothing recolours itself.
- The inspector's duplicate swatch row is gone: the floating bar is where colour is
  chosen, and there is exactly one of it.

**Other UI decisions taken in the same pass, recorded so they are not lost:**

- **Connectors elbow by default.** A route that turns reads as a diagram; a chord
  between two boxes reads as a line that happens to touch them. `straight` and
  `curved` remain one click away.
- **Line width is a property.** 1 / 2 / 4, in the same popover as the type, with the
  dash styles.
- **Anchors sit outside the note.** Nine world units out from each side, drawn on the
  hovered note. On the edge they fight the border and the resize handles; outside they
  read as "pull a line from here" and leave the note's own edge visible.
- **A note has a visible edge.** A hairline in the fill's own colour, darkened by 16 %,
  and a 3-unit corner radius. A pale note on the pale board is otherwise a rectangle
  you have to guess at.
- **Properties live on the object, not in the sidebar.** Colour, size, text size,
  alignment, emphasis and connections are in a bar above the selection; the sidebar is
  for document facts. A property that exists in two places will disagree with itself.
- **Every one of these is a single component.** A bar, a picker or a popover is written
  once and reused; a second copy is a bug even when it looks right today.

**Second pass, from the owner's review of the first one.**

- **Width is its own control.** Inside the type popover it was invisible; it now has a
  button in the bar (a sample of the stroke) and a popover that names the three widths
  (thin / normal / thick, 1 / 2 / 4). A control nobody finds is not a feature.
- **Anchors survive the approach.** They sit outside the note, so the pointer leaves
  the note's box on the way to one — and the hover, which was computed from the box,
  hid them exactly when they were reached. The anchor ring now wins over whatever is
  under the pointer.
- **Selection chrome is not doubled.** A single selected note shows four handles just
  outside its corners and no outline; an outline plus handles plus anchors on the same
  rectangle reads as noise. Multi-selection keeps outlines, because then the box is
  the only thing that explains what is selected.
- **A resize paints the note, not just the dots.** The live box was only invalidating
  the overlay layer, so the board kept the old picture; it is now a board dependency
  like a drag offset. The cell tint and the anchors are hidden while resizing, so the
  note being resized is not sitting under a leftover highlight.
- **Underline and strikethrough use the baseline.** They were placed by guessing from
  the top of the line box, which put the underline through the letters. The painter
  now takes the ascent from the font metrics and draws both lines relative to the
  baseline, for top-aligned notes and vertically centred text alike.

**Consequences.**

- A new colour, a new width, a new line type is one edit in one list.
- Captured boards keep their colours; new choices are hexes, which is what the source
  product stores as well.
- The note edge, the shared picker and the chrome rules are visual decisions with no
  test that can see them, so they live here, next to the reasoning.

## ADR-031: Remember the line style, give chained notes room, and let the grid be optional

**Status:** accepted (2026-10-24)

**Context.** Three things from the owner's review of the second pass. A new connector
was always drawn with the default arrow, so drawing five links in a row meant picking
the arrow five times. A note created with Tab landed almost against its parent, which
also left no room for the connector's stubs — the route doubled back on itself and
read as a doubled line. And the source product shows a faint grid that can be turned
off, which the clone only had as dots, always on.

**Decision.**

- **The last connector style is remembered.** `lastConnector` in the app holds shape,
  arrow, colour, dash and width; `createConnector` and `createConnectedNote` take it as
  their defaults, and every control in the connector bar writes back to it. A link
  drawn now looks like the one drawn before it, without a dialog. This is a per-person,
  per-tab preference: it is a habit, not a document property, so it is not synced.
- **The chain gap is proportional.** `noteGap` returns
  `max(56, max(width, height) × 0.36)` — about a third of the note, the spacing the
  source product uses. A fixed gap looks right for one note size and cramped for
  another, and 28 units on a 160-unit note left no room for anything.
- **Elbow stubs shrink with the gap.** The stub used to be a constant 24 units; in a
  narrow gap two stubs crossed and the elbow doubled back. `stubFor(distance)` keeps it
  between 6 and 24 units, at most 28 % of the distance, so the turn always fits inside
  the gap. A long gap keeps full-length stubs.
- **The background grid is a view preference with three states.** Lines (default,
  matching the source product), dots, or off; a button in the canvas HUD cycles them
  and the choice is stored in `localStorage` under `remo.grid`. The grid is drawn
  with a world-fixed step of 40 units that doubles or halves so it stays between 12 and
  90 screen pixels at any zoom — it never becomes a moiré pattern when zoomed out.
- **A note being typed in is not also outlined.** While the inline editor is open its
  own frame is the selection affordance; drawing the selection outline under it put two
  blue rectangles around the same note, which is the "double line" that pulled the eye.

**Consequences.**

- Nothing about the grid reaches the document or another person: it is one person's
  reading aid.
- The remembered style is not reset by undoing a connector: undo is about content, and
  a habit survives it.
- The gap change only affects notes created from now on; existing boards are untouched.

## ADR-032: The numbers that decide how the board feels are settings

**Status:** accepted (2026-10-24)

**Context.** The owner kept asking for "more gap", then "a bit more", and was right
each time: the distance a chained note lands at is a judgement call, not a fact. The
same is true of the grid step, the snap radius, the elbow's stub, the default line
style and the font. Each was a constant buried in a painter or a doc function, so
tuning meant editing code, rebuilding and reloading — and the person who cares about
the feel could not tune anything.

**Decision.** One `BoardSettings` object, with defaults, bounds and a dialog.

- The shape of it is documented field by field in `apps/web/src/settings.ts`: grid
  size and style, snap distance and guides, chain gap ratio and minimum, text caps per
  note size, connector shape/width/colour/dash and its stub, shape outline defaults,
  font family.
- `normalizeSettings` validates and clamps everything: unknown keys are dropped, a
  number out of range is pulled into range, an unknown enum falls back, a colour that
  is not a colour is ignored, and numbers written as strings are accepted. The JSON
  tab is therefore safe to paste into.
- The dialog shows every field with a sentence about what it changes, plus the whole
  object as JSON with Apply and Reset. A teammate's tuned numbers can be copied
  between browsers.
- Settings are stored in `localStorage` (`remo.settings`): they are a person's
  reading habits, not a document property, so they are never written to the board.
- They reach the code by parameters, not globals: `noteGap(w, h, options)`,
  `connectorPath(…, stubOptions)`, a `PaintTheme` in `drawWidget`, and the snapping
  threshold passed to `snapMove`. Nothing in the canvas or doc packages reads a global
  setting, so the packages stay usable on their own.

**Consequences.**

- A stub asked to be longer than half the gap is clamped to half: two stubs that cross
  make a line double back, and no setting should be able to produce that.
- Two people on the same board may have different grids and gaps; content is still
  shared, so nothing they see contradicts anything anybody else sees.
- The defaults became the tuned ones the owner settled on after using the board: gap
  1.2 of a note with a 72 minimum, curved one-pixel lines, one-pixel shape outlines.
  A fresh browser therefore starts where he left off, and a person who wants something
  else changes it in the dialog rather than editing code.

## ADR-033: Shapes get the same chrome as notes, from the same code

**Status:** accepted (2026-10-24)

**Context.** A shape could not be recoloured and its text had no size, alignment or
emphasis — not because shapes are different, but because the note bar was built for
notes and nobody went back. Two implementations of "the properties of an object" is
exactly the drift the owner called out for colour palettes.

**Decision.** One bar, one set of commands, one text painter.

- `StickyBar` became the object bar: `kind: "note" | "shape"` decides which controls
  appear. Both get the fill colour and the text controls (size, alignment, emphasis);
  shapes additionally get outline colour and outline width; only notes get the S/M/L
  size presets, because only a sticky has them.
- The doc commands are shared where they can be: `setFillColor` paints notes and
  shapes, `setNoteFontSize`/`setNoteTextAlign`/`setNoteTextVAlign`/`toggleNoteMark`
  already applied to anything that holds text, and `setShapeStyle` adds the outline
  fields.
- Text is drawn by one function, `drawTextInBox`, used by sticky notes and shapes: the
  same Auto fitting, the same three alignments, the same runs and the same underline
  placement. A shape's text used to be a separate four-line painter with hard-coded
  metrics.
- A new shape takes its fill, outline and outline width from settings.

**Consequences.**

- Adding a text property means adding it once.
- A shape behaves like a note for text and like a shape for its outline, which is what
  it is.
- Cards keep their own painter: a card's face is a kanban cell, not an object people
  decorate.

## ADR-034: The object being connected shows its anchors

**Status:** accepted (2026-10-24)

**Context.** Dragging a line to a target left the target unmarked: the line's end side
was guessed from geometry, so the result could arrive on a side the person did not aim
at, and nothing on screen said where it would land.

**Decision.** While a connector is being dragged, the object under the pointer shows
its four anchors; the nearest one is filled in and the draft line ends exactly there.

- The chosen side is stored on the connector, so what the line did during the drag is
  what it does afterwards.
- If the drop never came near an anchor, the facing side is used — the old behaviour is
  the fallback, not the rule.
- The anchor's own (edge) position is used for the choice, not the drawn dot outside
  the object, so "filled in" and "attached" mean the same point.

**Consequences.**

- The person can aim at the side they mean, including the far side, and the elbow
  routes around to it.
- Selection anchors (hover, from ADR-030) and target anchors (while dragging) are the
  same dots, so the affordance is learned once.

## ADR-035: An anchor is a button, and a drag from it is a line

**Status:** accepted (2026-10-25)

**Context.** The four anchors could only be dragged from: to get a note beside a note
you had to find the bar's arrow, or the Tab key, or the context menu. The owner asked,
plainly, why a click on the dot does not do the thing the dot is for. He was right —
the dots are the most direct way to say "a note goes on this side", and they were
inert to a click.

**Decision.** A press on an anchor is both gestures, told apart by travel.

- Under four screen pixels of movement it is a click: it runs the same command as the
  bar's arrow for that side, `createConnectedNote`, which adds the note one tuned gap
  away, joins it with a connector, selects it and opens the editor — one undo step.
- Past that it is a connector drag, as before.
- A hovered anchor is filled dark (`#1a1a1a`) with a slightly larger dot; the other
  three stay white rings. Blue was the selection colour and read as "selected" rather
  than "this one, here".

**Consequences.**

- The threshold means the first few pixels of a real drag do not cancel the click.
- The same four dots now carry three meanings — hover, click to grow, drag to connect —
  which is one affordance with three outcomes, not three controls.
- A click can never produce a zero-length connector: if the person did not travel, the
  action is the note, not a line to nowhere.

## ADR-036: Arrange works on units, not on objects

**Status:** accepted (2026-10-25)

**Context.** A multi-selection could only be moved and snapped. The owner asked for
Miro's Arrange menu: align to six edges, distribute with equal gaps. The obvious
implementation — move every selected widget — breaks groups (a group aligned to the
left becomes a column) and fights frames (a frame would move away from its contents).

**Decision.** Two document commands, `alignWidgets` and `distributeWidgets`, that work
on *units*.

- A unit is a root widget plus its group: a selection of two grouped notes and a third
  note has two units, and a group moves as one box with its inner layout intact.
- Children are never units of their own; they follow their container because the
  command moves the container.
- Cards and connectors are not units: a card's position is its cell, and a line's is
  derived from its endpoints.
- The reference for alignment is the selection's own union box, so the outermost object
  never moves and the rest comes to it.
- Distribution keeps the outer units still and equalises the *gaps*, computed from the
  union's ends minus the occupied widths — equal centres would change the gaps whenever
  sizes differ, which is not what "equal gaps" promises.
- The entry point is a bar above the multi-selection, with six alignment icons and two
  distribution icons. Six words would be wider than the selection.

**Consequences.**

- Distributing three objects that are exactly on top of each other produces equal
  negative gaps: the command is honest about impossible input rather than silently
  doing something else.
- One gesture, one undo step, like every other command.

## ADR-037: The HUD is a control, not a caption

**Status:** accepted (2026-10-25)

**Context.** The owner reported that "Fit" and "Grid" in the bottom-left panel did not
respond to clicks. They were not broken handlers: the canvas overlay (`z-index: 1`) is
painted over the whole canvas area and the HUD had no stacking context of its own, so
every press went to the canvas. Separately, "Fit" fitted the whole board even when
something was selected, and "Grid" cycled three states under a label that named one,
which made a single click mean three different things.

**Decision.**

- The HUD sits above the canvas (`z-index: 7`, as the hint and the badge already do).
  Anything floating over the canvas has to out-rank it or it is decoration.
- "Fit" fits the selection when there is one and the whole board when there is not:
  the button answers "show me what I am working on", and the selection is what the
  person is working on. A kanban's cards are measured in their cells, not at the origin
  they do not occupy.
- The grid button is an on/off switch with the state in its label ("Сетка" / "Без
  сетки"); lines vs dots moved to settings. Turning it back on restores the last
  visible style, so the switch does not quietly change the look.
- Zoom in and out buttons join the percentage, which is now the readout they act on.

**Consequences.**

- The HUD is the only place a view-level control lives; the settings dialog owns the
  look of the grid, as it owns every other number (ADR-032).
- Bar placement is a shared helper: above the object, below it when there is no room,
  and clamped into the viewport in both cases. A tall selection used to push its bar off
  the bottom of the screen.

## ADR-038: Text is edited in the object's own colours

**Status:** accepted (2026-10-25)

**Context.** Double-clicking a note opened a white editor over it. On a pale note that
looked like a hole in the board, and on a deep note it was worse: the painter had been
setting the text colour to the note's *edge* colour, so a dark note could be painted
with dark text and nobody could read it. The owner hit exactly that and asked for the
editor to keep the fill, and for a sensible text colour when there is no explicit one.

**Decision.** One ink rule, used by the painter and the editor.

- `inkFor(fill, explicit)`: an explicit `style.textColor` wins; otherwise the ink is
  the readable one for the fill (dark on pale, white on deep). `readableInk` now also
  understands three-digit hex, which hand-written settings can produce.
- Sticky notes and shapes both paint their text with it. Before this, notes inherited
  whatever `fillStyle` was left over from drawing their edge.
- The inline editor takes `fill`, `ink` and `radius` from the object it covers, so
  typing looks like the result: same background, same colour, same corners. A text
  block is edited on a transparent background (it has no fill), a card on white (it
  is a kanban cell, not an object people colour).
- The note bar gained a text-colour picker with an "A" swatch that goes back to
  automatic. Choosing a colour is a decision and is never overwritten; the automatic
  answer is recomputed from the fill every time the fill changes.

**Consequences.**

- A note can no longer be painted in a colour that hides its own text.
- Changing a fill from yellow to black flips the text to white by itself, in the
  editor as well as on the board.
- The text colour is stored per object, so two notes on the same fill can still differ
  when someone chose to.

## ADR-039: The stacking order belongs to the document

**Status:** accepted (2026-10-25)

**Context.** What covered what was decided by the widget's type: frames at the bottom,
lines, shapes, notes, text on top. That is a good default and a bad rule — the owner
asked for bring-to-front, and no amount of clicking can put a shape above a note when
the painter sorts by type.

**Decision.** Painting order is a stored property with a type-based default.

- `layerKey(widget) = widget.z ?? rankOf(widget) * 1000`. Without a `z` the type still
  decides, so every existing board looks exactly as it did.
- `reorderWidgets(board, ids, "front" | "forward" | "backward" | "back")` works on the
  current paint order: `front`/`back` move the selection as a block, `forward`/
  `backward` pass exactly one neighbour. Only the objects whose key would not keep the
  new order are rewritten, so the command stays cheap on a large board.
- Both painting and hit-testing use the same key, so what looks on top is what gets
  clicked.
- Cards are not part of the stack: their position in the matrix is not a layer.
- Entry points: the context menu, ⌘] / ⌘[ (with Shift for the ends) and four buttons
  in the selection panel.

**Consequences.**

- A board's appearance is no longer implied by its types; it is written down.
- The base layers are thousands apart, which leaves room to slot an object between two
  others without renumbering the board.

## ADR-040: Lock is a property of the object

**Status:** accepted (2026-10-25)

**Context.** There was no way to pin something down. A template's frame, a legend, a
finished area — all of it could be dragged away by accident, and a group is not a lock:
it still moves as a whole.

**Decision.** `widget.locked` plus one toggle, checked by every gesture that changes
geometry or content.

- Locked objects do not move, resize, take part in align/distribute, accept an anchor
  drag, open the editor, or get deleted by the delete key.
- They can still be selected — that is how you unlock them — and the badge says 🔒, with
  the property bar hidden because there is nothing to change.
- `deleteWidgets(..., { force: true })` exists for the internal cases (replacing a
  board); the UI never passes it.
- One toggle in the context menu, one in the selection panel, and ⌘⇧L, which is the
  shortcut the source product uses.

**Consequences.**

- A locked object is not a dead object: it still carries its connectors and moves
  nothing around it.
- Deleting a selection that contains a locked object deletes the rest and keeps the
  locked one, which is the least surprising half-success.

## ADR-041: A connector has text, stored like any other text

**Status:** accepted (2026-10-25)

**Context.** Lines carried no words. In the source product a line can be labelled, and
that is how a diagram says *why* one thing points at another.

**Decision.** The label is the connector's text.

- `holdsText` includes connectors, so the label lives in the same `Y.XmlText` map as a
  note's text: same editing, same marks, same undo merging.
- The painter draws it as a chip at the middle of the line's own path
  (`pathMidpoint`, measured along the flattened path), so the label follows when
  either end moves and never drifts off a curve or an elbow.
- Double-clicking a line, or the "Aa" button in its bar, opens the same inline editor
  every other text uses, positioned on the midpoint. The editor has a minimum screen
  size so it stays usable at a zoom where the painted chip is a few pixels tall.
- The text is part of a copied fragment, because it is the connector's text.

**Consequences.**

- A labelled line is one object, not a line plus a floating note that has to be
  positioned again whenever the line moves.
- The label is world-scaled like the rest of the board; at 20% zoom it is as legible
  as the note text at 20% zoom — that is, not at all, and zooming in is the answer.

## ADR-042: A selected line is lit along itself

**Status:** accepted (2026-10-25)

**Context.** Selecting a curved connector drew a blue rectangle around it. That
rectangle is the widget's box — the chord between the endpoints — and a curve bows
outside it, so the outline showed a *second, straight line* that was not the object.
The owner read it as a rendering bug, and it was one.

**Decision.** Connectors are selected along their path.

- A wider translucent stroke in the selection blue, drawn under the line, over its
  whole length. No box, ever.
- The generic box outline skips connectors explicitly, because the halo is the
  selection.

**Consequences.**

- What is highlighted is exactly what was clicked, which matters most for the shapes
  that leave the box: curves and elbows.
- The halo also makes a one-pixel line findable when it is selected, which the box
  never did.

## ADR-043: A label knows where it sits on its line

**Status:** accepted (2026-10-25)

**Context.** A connector's text was always in the middle, at one fixed size and one
fixed colour. Three complaints at once: a label often wants to sit nearer one end, the
text has to be its own size, and it should follow the object's colour rules like every
other text on the board (ADR-038).

**Decision.** The label is placed by a fraction and an offset, and styled like text.

- `labelAt: { t, offset }`: `t` from 0 at the start to 1 at the end, `offset` a
  perpendicular nudge in canvas units. Absent means the middle.
- The pair is stored instead of a point, so moving either end carries the label with
  it and keeps it on the same side of the line — the whole reason for storing a
  fraction.
- Dragging the white handle on the label writes both: `t` projects the pointer onto
  the path, `offset` is its signed distance from it (`closestOnPath`).
- `style.fontSize` and `style.textColor` apply to the chip exactly as they do to a
  note; the connector bar grew a size step and a colour picker that appear once the
  line has text. The painter pads the chip proportionally to the font size, so a big
  label does not look like a small one with more space around it.

**Consequences.**

- A label can point at the part of the line it belongs to, and keeps pointing there.
- Two lines between the same two objects can carry their labels at different places
  instead of stacking in the middle.

## ADR-044: Reshaping a line is dragging two dots

**Status:** accepted (2026-10-25)

**Context.** The owner asked for the source product's ability to change a line's
curvature and to move the straight part of an elbow. The full answer is a free-form
path editor; the useful answer is much smaller.

**Decision.** Two handles per line, and one stored number each.

- **Curved:** two blue dots at a third and two thirds of the path. Dragging one writes
  `curve.from` / `curve.to` — the length of that side's bezier control, measured along
  the side's normal. The default stays "42% of the distance", so an untouched curve is
  exactly what it was.
- **Elbow with both ends on the same axis:** two dots at the ends of the middle run.
  Dragging either writes `bend` (0…1), the position of that run between the two stubs.
  The route stays orthogonal; only the corner moves.
- **Elbow with ends on different axes:** one dot at the corner. Dragging it toward the
  other diagonal writes `elbowFlip`, which is the only freedom that shape has.
- **Straight:** no handles. Its only meaningful change is where it ends.
- The document is written once, on release; during the drag the canvas paints a draft.
  Forty transactions for one gesture would fill everyone's undo stack.
- The handles are drawn on the overlay, and a press on one wins over everything else,
  because it sits on the line the press would otherwise select.

**Consequences.**

- Reshaping cannot disconnect a line or change its endpoints: the dot only moves the
  numbers in between.
- What you see while dragging is what the document stores — the draft is the same
  geometry the painter will use after the commit.

## ADR-045: Floating panels measure before they place themselves

**Status:** accepted (2026-10-25)

**Context.** The context menu opened at the click and ran off the bottom of the window,
cutting off its last items. On a contextual menu the last items are Delete and the
layer commands — the destructive or structural ones, exactly the ones you must not
lose. The owner hit this on a screenshot.

**Decision.** Measure, then clamp, then show.

- The menu renders hidden, is measured in a layout effect (before paint, so no flash),
  and is placed inside the viewport with an 8 px margin.
- If it does not fit downwards it flips above the click, so its first items stay next
  to the pointer and its last items stay on screen.
- A menu taller than the viewport scrolls instead of overflowing.
- The Info card uses the same rule (ADR-046).

**Consequences.**

- No panel can be unreachable because of where it was opened; the clamp is shared
  logic, not a per-menu special case.
- Flipping is a decision, not a guess: it happens only when the down direction does not
  fit.

## ADR-046: Info is stamped at creation and shown on demand

**Status:** accepted (2026-10-25)

**Context.** The owner asked for an "Info" panel with author and time. The board has no
accounts: a person is a name in their own browser (ADR-021), and the same browser can
be used by someone else tomorrow.

**Decision.** Record who and when at creation, and show it in a small card.

- `createdBy` / `createdAt` are written by `createWidget` from `board.author`, a
  per-browser value the app sets from the local identity. Nothing about identity is
  synced; the stamp is.
- Existing objects without a stamp are shown as "Unknown" rather than guessed.
- The card opens from the context menu's Info item for a single object, listing type,
  size, position, author and creation time, in the same clamped placement as the menu.
- "Changed" is deliberately absent: a last-edited field would be written on every
  keystroke and every drag, which is a lot of churn for a line of text nobody opens
  often; the projection already keeps `updated_at` on the server for anything that
  needs it.

**Consequences.**

- A stamped object keeps the name of its maker even if that person renames themselves
  later, which is what "created by" should mean.
- Objects from imported templates honestly say Unknown.

## ADR-047: Double-click enters a group

**Status:** accepted (2026-10-25)

**Context.** Clicking a member selected the whole group (ADR-022), which is right for
moving it. But it also meant a member could never be restyled, re-layered or edited on
its own — the group's own furniture was frozen.

**Decision.** A double-click on a member selects that member alone.

- One click still selects the group; that is how it is moved.
- Double-clicking a member narrows the selection to it, and opens its editor if it has
  text. The sticky bar reappears, and the layer commands now act on that member.
- Escape clears the selection, which is also how you leave the group.

**Consequences.**

- Groups keep behaving as one object for movement, and stop being opaque for
  everything else.
- Deleting a member still deletes the group, as decided in ADR-022; entering is for
  editing, not for taking the group apart.

## ADR-048: The line follows the dot, and the dot is where the line is

**Status:** accepted (2026-10-25)

**Context.** Reshaping was unusable in two different ways, and both were bugs rather
than missing features.

1. The board painter drew each widget from the document array while the handle was
   positioned from the draft. The dot moved with the pointer and the line stayed
   behind — it looked like a detached control, and the gesture read as broken.
2. The elbow's drag axis was read only from paths with six vertices. The path is
   simplified, so a normal Z-shaped elbow has four, the axis came back empty, and
   every move was ignored: dragging an elbow's dot did nothing at all.

The label had a third problem: it could only be dragged after its line was selected,
even though the chip is a visible, separate thing on the board.

**Decision.**

- The painter applies the reshape draft to the widget it draws, not only to the
  overlay: a preview that does not preview is worse than no preview.
- The elbow's slide axis is derived from the *turns* of the simplified path plus the
  real stub length (`stubLength`, the same function the geometry uses), so it works for
  the shapes people actually make.
- The label chip is its own grab target on any connector, selected or not: a press on
  the chip selects the line and starts dragging the label in one gesture.
- The hint line now mentions both affordances, because a blue dot does not explain
  itself.

**Consequences.**

- What is under the pointer is what moves; the dot, the line and the label are always
  the same geometry.
- The class of bug "the preview lives in another place than the result" is called out
  in the painter, so the next preview has a pattern to follow.

**Why two dots and not three.** The source product shows four dots on a line: two
white ones on the ends and two blue ones for the curve. The white ones move an endpoint
to another object, which our model does not support yet, so drawing them would be an
affordance that does nothing. The two blue ones are the ones that change the shape.

## ADR-049: A kind's capabilities are one table

**Status:** accepted (2026-10-25)

**Context.** After four rounds of features the same question was answered in five
places: `canConnect` in the model, `holdsText` in the document, `isEditable` in the
app, `PAINT_RANK` in the model, and a scattering of `type === "…"` checks in arrange,
layering, grouping and the resize handles. By the time of the review the registry
counted 18 checks for "connector" and 18 for "card" across the workspace, and three
lists that were *almost* the same list of text-bearing kinds. Adding the label on a
connector meant editing four of them; a fifth would have been missed.

The review's verdict was that the domain model is sound and the extension surface is
not. This is the first of the three registries that fix that.

**Decision.** `packages/model/src/kinds.ts` holds a `WIDGET_KINDS` table, one row per
kind, and every module asks it instead of re-deciding.

- Capabilities, and only the ones at least two modules already needed: `rank` (paint
  layer), `text` (holds text), `connectable` (can be a line's endpoint), `editable`
  (opens the inline editor), `layered` (takes part in `z`), `movable` (has a free
  position, so arrange may move it), `groupable`, `resizable`.
- It is a `Record<WidgetType, KindSpec>`, not a lookup with a default: adding a member
  to `WidgetType` fails the build until it is given an answer. That is the reminder the
  five scattered lists never gave.
- `kindOf(type)` stays tolerant for data off the wire: an unknown type falls back to a
  conservative spec — visible, movable, selectable, but no text, no anchors, no editor.
  Refusing to draw an unknown object would hide someone's data.
- `canConnect` and `PAINT_RANK` remain as the public names they were; they are now
  views on the table, so no caller had to change.

**What deliberately did not move.**

- *Where* text lands (a card's title versus a note's content) is a materialisation
  detail of the document, not a capability.
- "A chain starts from a note" (Tab) is a product policy, not a kind property: a shape
  could arguably grow a chain, and deciding that deserves its own ADR with a behaviour
  change, not a silent refactor.
- New-object defaults (a shape's fill and outline) come from settings, which the model
  must not import; they belong with the command layer (ADR-050, planned).
- Painting-only distinctions (a note is drawn with its own chrome instead of a
  selection box) stay in the painter: they are about looks, not abilities.

**Consequences.**

- A new kind of object is: one row here, one case in the painter, and — if it holds
  text — nothing else, because the editor, the style commands and the arrange
  algorithms now ask the table.
- The table is pinned by tests that record today's answers for all eleven kinds, so the
  migration itself is provably behaviour-preserving (223 tests, of which 9 are new).
- The next two registries are queued: commands (`ADR-050`) and one interaction preview
  (`ADR-051`). Until they exist, a new *command* still costs a bespoke function.

## ADR-050: One command list for the menu, the keys and the panel

**Status:** accepted (2026-10-25)

**Context.** Fifteen actions on a selection were written three times: as context-menu
items, as branches in the keydown handler, and as buttons in the right panel. Each copy
carried its own answer to "is it available" — the panel even computed groupability with
a private predicate, while the menu computed it again and ⌘G assumed a third. Adding
⌘⇧L for lock meant editing two of the three places, and nothing would have caught the
third drifting.

**Decision.** `apps/web/src/commands.ts` is the list.

- A command is a descriptor: `id`, `label` (an i18n key, or a function when the label
  depends on state — Lock/Unlock), `shortcut`, `surfaces`, `danger`, `enabled(ctx)`,
  `run(ctx)`.
- The registry owns the document changes (layers, lock, grouping, delete, clear,
  copy/paste of a look). The app injects only what a command cannot do by itself: the
  system clipboard, the selection setter, opening the editor and the Info card.
- The context menu is generated from `commandsFor("menu", ctx)`; the panel reads the
  same `enabled`/`run`; the keyboard asks `commandForShortcut(event, ctx)`. One rule,
  three surfaces.
- A shortcut may set `always`. This is the difference between keys that must fall
  through to the browser when they would do nothing (⌘C with an empty selection must
  stay the browser's copy) and keys that must be claimed regardless (⌘G must never open
  the browser's "find next"). That decision is now written per command instead of being
  an accident of branch order.
- The card, column and swimlane menus stay bespoke: they are contextual (a rename
  field, a column index), not actions on a selection.

**Consequences.**

- A new action is one descriptor and one i18n key; the menu, the keys and the panel pick
  it up with no further wiring. A command palette is now a rendering of the same list.
- Disabled states cannot drift apart, because there is one `enabled` per command.
- Still outside the registry, deliberately: paste (needs a world point and an async
  clipboard read), nudge, connect and edit-text. They need an *intent* argument, which
  the descriptor does not have yet; they join when it does, not before.
- Found while unifying, not fixed here: right-clicking one of several selected objects
  acts on that object, while the keyboard and the panel act on the whole selection
  (`resolveContextTarget`). That is a decision about context menus, and it will get its
  own ADR instead of being changed inside a refactor.

## ADR-051: One preview, read by everything that draws or measures

**Status:** accepted (2026-10-25)

**Context.** Every gesture that changed an object had its own live state: a drag offset
(`dragDelta` + `dragIds`), a resize box (`resizeBox`), a connector patch
(`connectorDraft`). They were painted differently, measured differently, and only some
of them reached hit-testing and connector endpoints. Two bugs came straight out of that:
the painter drew the document while the handle came from the draft, so a reshaped line
did not move; and a connector's size in the badge came from a stored box that the
preview never updated. By the review the file had 55 reads and writes of these refs.

**Decision.** One map: `Preview = Map<widgetId, Partial<Widget>>`.

- Gestures write patches: a drag writes positions, a resize writes a box, a reshape
  writes `bend`, `curve` or `labelAt`. There is no "translation mechanism" and no
  "resize mechanism" — only patches.
- Everything downstream reads it through one lookup: the painter draws the patched
  widget, `widgetById` returns the patched widget (so hit-testing, connector endpoints,
  anchors, reshape handles and the group box are all live), and `paintBoard` no longer
  has a branch per gesture.
- The document is written once, on release, from the same map; then the map is cleared.
  Cancelling a gesture is clearing it — there is nothing else to unwind.
- Card dragging stays separate: a card's position is its cell, not a coordinate, so it
  is drawn on the overlay as a floating card and committed through the matrix. The
  marquee and the connector draft are also separate: they are gesture *visuals*, not
  patches on a widget.

**Why a map of patches rather than one delta.** A translation could be a pair of
numbers, but a resize and a reshape cannot. One general form removes the choice — and
with it the chance that the next gesture invents a fourth mechanism.

**Consequences.**

- The class of bug "the preview is drawn here and measured there" is closed by
  construction: there is only one place.
- A future group resize or rotation writes patches into the same map and every
  consumer follows without changes.
- The map is allocated per pointer move. For one object that is trivial and for the
  sizes this board has it is invisible; if it ever shows up in a profile, the map can
  be mutated in place instead — a local change, because only the setter touches it.

**Cleanups that came with it.**

- `widgetById` used two linear scans on the whole board and was called ~20 times per
  paint; it now reads a memoised `Map`.
- Three toolbars had their own copy of the popover lifecycle (open state, click
  outside, Escape, reset on target change). One `usePopover` hook now owns it — and the
  copy that had lost its Escape handler is gone.
- The card placeholder ("Type something") lived inside the canvas package; it is UI
  copy, so it now comes from the paint theme and from the kanban painter's options,
  translated by the app.

## ADR-052: Line geometry scales with the board; chrome does not

**Status:** accepted (2026-10-25)

**Context.** Arrow heads were drawn at `14 / zoom` world units, which is 14 *screen*
pixels at every scale. On a board fitted to 13% the heads were bigger than the text and
nearly the size of the notes they pointed at — the owner saw exactly that. The same
mistake was in the line width and in the dash pattern, so a "thin" line stayed visually
thick while the board shrank around it.

**Decision.** A line's thickness, dashes and heads belong to the object, not the screen.

- Width, dashes and the arrow head are in canvas units: zooming out makes the whole line
  smaller, which is what "the board got smaller" should look like.
- A one-device-pixel floor is kept (`max(width, 1 / zoom)`), because a 2-unit line at
  13% would otherwise be a quarter of a pixel and disappear. The floor is a rendering
  guarantee, not a stored value.
- Shape outlines follow the same rule, so "an object's stroke is its own property" is
  true for every stroke on the board.
- Chrome that exists for the screen — selection halos, resize handles, anchor dots,
  hairlines used as edges — stays screen-scaled on purpose. It is UI, and UI that shrinks
  with the content becomes unusable.

**Consequences.**

- A board at 13% now looks like a photograph of a board, not like one with oversized
  arrow stickers on it.
- Very thin lines stay visible at any zoom; very thick ones still look thick when zoomed
  in, because the floor only applies from below.

## ADR-053: The document module is split by feature, and stays the public door

**Status:** accepted (2026-10-25)

**Context.** `packages/doc/src/board.ts` had reached 2492 lines: the document class, the
text storage, every style command, the clipboard, connectors, groups, layers, arranging,
widget authoring, kanban operations and template loading. It changed for a dozen
unrelated reasons, which is the definition of divergent change — and it was the file a
newcomer had to read in full to find anything.

**Decision.** Feature modules, with `board.ts` kept as the public door.

- `text.ts` owns text: `Y.Text` versus `Y.XmlText`, `plainOf`/`deltaOf`/`runsOf`, the
  materialisation that the painter reads, and the commands that change text, size,
  alignment, emphasis and content.
- `styles.ts` owns looks: fill, outline, text colour, size preset, and the Copy/Paste
  style snapshot.
- `origins.ts` holds the transaction origins, so a feature module can name them without
  importing the class.
- Modules take a `BoardDocument` **as a type** and receive an instance; nothing imports
  the class at runtime, so the dependency stays one-way and there is no initialisation
  cycle to reason about (the smoke test is that the sync server, which imports the
  document, still boots).
- `board.ts` re-exports everything (`export * from "./text"`), so every caller — the app,
  the tests, the sync service — keeps importing from `@remo/doc` and nothing else
  changed. That re-export is deliberate: it is the package's door, not a leftover.

**Consequences.**

- `board.ts` went from 2492 to 1831 lines in this first slice, with no behavioural change
  and the same 233 tests passing.
- The next slices have their dependencies mapped: clipboard needs `descendants` and the
  kanban-state readers first; then connectors, groups, layers, arranging and notes.
- The rule for the following slices: a module owns one *reason to change*, may import
  another feature module, and must never reach into the class's private maps except
  through what the class already exposes (`widgets`, `texts`, `transact`).

**What this does not fix.** The file is still the place where the class lives, and the
class exposes its Yjs maps directly. That is acceptable for now — the maps are the
document — but if a second consumer appears (a public API, a plugin), the class should
grow intent methods instead of map access. That is a later decision, not a silent one.

### ADR-053, result of the first pass

The document package now reads as features rather than one file:

| Module | Lines | Owns |
|---|---|---|
| `board.ts` | 608 | the document class, template insertion, kanban/card/column/swimlane commands, helpers |
| `text.ts` | 492 | `Y.Text`/`Y.XmlText`, `plainOf`/`deltaOf`/`runsOf`, materialisation, text commands |
| `clipboard.ts` | 263 | fragments, copy, paste with id remapping |
| `styles.ts` | 210 | fill, outline, ink, size preset, Copy/Paste style |
| `notes.ts` | 200 | authoring notes and shapes, sizing, the Tab chain |
| `widgets.ts` | 181 | create/patch/move/resize/delete, container rules |
| `connectors.ts` | 161 | creation, look, endpoint questions |
| `kanbanState.ts` | 150 | reading and writing the matrix out of Yjs |
| `arrange.ts` | ~150 | align and distribute over units |
| `layers.ts` | ~110 | lock and stacking order |
| `groups.ts` | ~75 | membership groups |
| `tree.ts` | 25 | descendants |
| `origins.ts` | 10 | transaction origins |

2492 lines became 608 in the door file, with the same public API (`export *`) and the
same 233 tests. The class still exposes its Yjs maps; that is the next decision, not an
accident — a public API or a plugin consumer would justify intent methods, and until then
the maps *are* the document.

## ADR-054: The canvas keeps gestures; geometry moves out

**Status:** accepted (2026-10-25)

**Context.** `BoardCanvas.tsx` reached 2799 lines and its bottom third was pure geometry:
anchors and which side a line attaches to, the axis an elbow slides on, where a floating
bar can sit without leaving the viewport, resize handles and the box a corner drag
produces. None of it needed React, none of it was tested, and all of it changed whenever a
gesture did — the recent "handle lags the line" and "bar off-screen" bugs both lived
there.

**Decision.** `apps/web/src/canvasGeometry.ts` owns the geometry; the component owns the
gestures.

- Pure functions, explicit arguments, no hooks, no DOM: `anchorsOf`, `nearestAnchor`,
  `directionOfSide`, `bendAxis`, `barTop`, `cornerPoints`, `cornerAt`, `resizedBox`,
  `hoveredCell`, `placementOfCard`, `connectTargetAt`, and the two gaps (`ANCHOR_GAP`,
  `HANDLE_GAP`).
- The component imports them and keeps what genuinely needs its state: the pointer state
  machine, the preview map, painting and the floating bars.
- Fourteen unit tests cover the moved functions: anchor choice, the edge-versus-dot
  distinction, bar placement in all four room situations, handle hit-testing, the
  opposite-corner rule, the minimum size, and the elbow's slide axis.

**Consequences.**

- `BoardCanvas.tsx` went from 2799 to 2552 lines; its remaining bulk is the gesture state
  machine and the two painters, which is the next slice.
- A geometry bug can now be reproduced in a unit test instead of a manual drag.
- The rule for the rest of the split: anything that can be answered from arguments alone
  leaves the component; anything that needs the gesture state stays until that state is
  itself extracted.

## ADR-055: Floating bars are placed by a function, not by the component

**Status:** accepted (2026-10-25)

**Context.** `BoardCanvas.tsx` computed where each floating bar goes — the note bar, the
arrange bar, the connector bar — inside three `useMemo` blocks of screen-space arithmetic:
clamping to the viewport, centring on the object, measuring a connector by its path. Two
hundred lines that could not be tested except by opening a bar and looking at it, in the
file that was already the hardest to read.

**Decision.** `apps/web/src/floatingTargets.ts` holds the three placements.

- Each is a function of a `Frame` (camera + viewport) and the object(s): no component
  state, no DOM, no hooks.
- The component keeps only the wiring: pick the selected widget, call, pass the result to
  the bar.
- The connector bar measures the line's **path**, not the stored rectangle, for the reason
  ADR-042 gives: a curve leaves the chord behind.
- Thirteen tests pin the behaviour: centring and clamping, the top-edge flip, a narrow
  viewport, locked objects, which kinds get a bar at all, group-as-one-unit in arrange,
  and the controls the connector bar reports.

**Consequences.**

- `BoardCanvas.tsx` went from 2552 to 2421 lines; the remaining bulk is the painter and
  the pointer state machine, which is the next slice.
- A bar that ends up off-screen is now a failing unit test rather than a screenshot
  someone has to notice.

## ADR-056: The two canvas layers are painted by functions

**Status:** accepted (2026-10-25)

**Context.** `BoardCanvas.tsx` carried both painters inline: the board layer (grid, culling,
widgets, kanban matrices, group box) and the overlay (cell tint, anchors, the connector
draft, the carried card, resize handles, reshape handles, guides, marquee, remote cursors).
They were `useCallback`s reading a dozen pieces of component state through the closure, so
neither could be called from anywhere else, and the component could only be read top to
bottom.

**Decision.** Painting lives in `apps/web/src/painters.ts` (and `remoteCursor.ts`).

- Each layer is a function over an explicit input object: `BoardPaintInput`,
  `OverlayPaintInput`. The component assembles the input and updates its paint statistics;
  it does not know what a grid line or an anchor ring looks like.
- `prepareLayer` owns the one thing both layers must agree on: sizing the backing store to
  the viewport and setting the device-pixel transform.
- The paint theme — fonts, text caps, the card placeholder — is built once in the
  component from settings and the translation, and passed in. The painters no longer reach
  for `t()`.
- `drawRemoteCursor` moved to its own module: it is the only painter that belongs to
  somebody else's pointer.

**Consequences.**

- `BoardCanvas.tsx` went from 2421 to 2092 lines; what is left is the gesture state
  machine, the bar wiring and the JSX — the parts that genuinely need the component.
- A painter can now be exercised with a stub context (the next test slice) and reused by
  an export or a renderer later.
- The remaining split is the pointer state machine, which is the part that needs gesture
  tests before it moves (ADR-054's rule).

## ADR-057: A gesture's arithmetic is tested before the gesture moves

**Status:** accepted (2026-10-25)

**Context.** The plan said "Playwright first, then extract the pointer machine". Playwright is
the right long-term answer, but it needs the whole stack (Vite, the sync service, Postgres)
and it is slow; meanwhile the arithmetic that actually broke — a bend's coordinate, a curve
handle's projection, a flip's comparison, a drag's snap — was buried in `pointerMove` where
no test could reach it. Two of the last three interaction bugs were exactly this code.

**Decision.** Extract the arithmetic now, as functions, and test it directly.

- `apps/web/src/gestureSteps.ts`: `moveStep` (raw travel plus snap), `bendStep` (position of
  an elbow's middle run, clamped to its ends), `flipStep` (which of two corners is nearer),
  `curveStep` (a control length projected onto its side's normal, clamped to `MAX_CURVE`).
- The component keeps the state machine: which handle is held, what the preview map says,
  when the document is written.
- Thirteen tests pin the parts that used to be a manual drag: the snap engaging and not
  engaging, the clamp at both ends of a run, no division by a zero span, the flip at and
  around the diagonal, a control length that ignores movement along the line, and one end
  of a curve moving without the other.

**Consequences.**

- The pointer machine can now be extracted into a hook with its arithmetic already covered;
  the risk left in that move is plumbing, not geometry.
- Playwright is still worth adding for the end-to-end gestures (create, connect, drag,
  reshape), but it is a CI decision that needs the stack, not a prerequisite for reading the
  component. That remains on the list.

## ADR-058: A right-click inside the selection acts on the selection

**Status:** accepted (2026-10-25)

**Context.** Found while unifying the menus (ADR-050): right-clicking one of five selected
objects opened the menu for that object alone, while the keyboard and the right panel acted
on all five. Grouping was the visible symptom — "Group" was disabled in a context menu even
though ⌘G would have grouped everything.

**Decision.** The context menu follows the selection when the click lands inside it.

- A right-click on an object that is part of the current selection (directly, or through a
  group whose member is selected) keeps the whole selection.
- A right-click outside it replaces the selection with what was clicked, expanded to its
  group — the same rule a plain click uses.
- A connector follows the same rule: inside the selection, the selection stays.
- The rule lives in `canvasTargets.ts` as a pure function, so it is tested rather than
  discovered: six tests cover inside/outside, group membership, empty canvas and a
  connector in a multi-selection.

**Consequences.**

- What the menu says and what the menu does now match: "Group", "Delete" and the layer
  commands act on the same set the keys would.
- The rule is one function instead of three branches inside the canvas component.

## ADR-059: The pointer machine is a hook, and it owns its state

**Status:** accepted (2026-10-25)

**Context.** After the geometry, the bars, the painters and the gesture arithmetic had
moved out, what remained in `BoardCanvas.tsx` was the state machine: nine pieces of state,
six refs and seven hundred lines of press/move/release for widgets, cards, the marquee, a
new connector, a reshaped line and a resize. None of it could be read without the component,
and the component could not be read without it.

**Decision.** `apps/web/src/useGestures.ts` is that machine.

- It owns the interaction state — the preview map, the live refs, the hover, the marquee,
  the connector draft — and returns the values the painter and the chrome need, plus the
  four handlers.
- The component passes twenty dependencies: the camera, the viewport, the document's
  widgets and layouts, the selection and the callbacks that write to the document. The
  machine never touches the document itself; it commits through those callbacks.
- `widgetById` moved **into** the hook. The resolver applies the preview the machine
  produces, so splitting them would have created a cycle; the component receives it back as
  `resolve` and uses it for the bars and the painters.
- `isEditable` moved to `editable.ts`: it is a rule about a widget (kind + lock), needed by
  the machine and by the app, and it had no business being exported from a canvas component.
- `worldToScreenPoint` is passed in: the machine needs the same client-coordinate mapping
  the component uses for its 14-pixel anchor and handle targets.

**Consequences.**

- `BoardCanvas.tsx` went from 2030 to 1169 lines. What is left is the canvas elements, the
  paint wiring, the floating bars, the camera effects and the JSX — the parts that are
  actually about being a React component.
- `useGestures.ts` is 1052 lines with one reason to change: how a gesture is interpreted.
  It is the largest file in the app and the honest size of the problem.
- Verified in the browser after the move: selection, drag (a note moved 191×149 units),
  double-click to edit, right-click menu, a corner resize (161×185 → 353×338) and a marquee
  that clears the selection.

## ADR-060: The app keeps composition; the board commands move to a hook

**Status:** accepted (2026-10-25)

**Context.** `App.tsx` was 1507 lines: state, sync, templates, forty-four callbacks and the
JSX. Two thirds of the callbacks were the same shape — a thin wrapper over a document
command, needing the same board, selection and settings. Reading the app meant scrolling
past thirty functions to find the one effect that mattered.

**Decision.** `apps/web/src/useBoardCommands.ts` holds every callback that writes to the
board: text, moves, resize, arrange, connectors, clipboard, groups, authoring, the note and
line bars, and the command context.

- It takes eleven dependencies: the board, the widgets, the selection, the camera, the
  settings, three refs it must write through (the clipboard fragment, the last line style,
  the copied style), two setters, the Info opener and the menu anchor.
- Pasting is the one command that must reach the **system** clipboard, so the hook reads it;
  the app still owns the in-memory fallback ref it passes in.
- What stayed: the author stamp (it needs the local identity), the keyboard listener (it
  needs the boards panel and the editor), `openInfo` (it owns the card state), the join
  predicate used by the panel, and the JSX.

**Consequences.**

- `App.tsx` went from 1507 to 1193 lines and now reads as: state → commands → keyboard →
  menu → render.
- Verified in the browser after the move: create a note, ⌘D duplicates it, Delete removes
  it, the context menu is still generated from the command list, and Info opens with four
  rows.
- This closes the file-splitting pass. The remaining work in the app is composition, which
  is what a top-level component should be.

## ADR-061: IAM v1 is a capability model over organisations, teams and boards

**Status:** accepted (2026-10-25)

**Context.** The product had no authentication at all: a display name in `localStorage`, the
room name in the URL as the only access control, and a sync server that accepted any
connection to any room. The owner asked for an Enterprise-style role model based on
`spec/Enterprise_IAM_Miro.md`, and chose four scoping decisions: organisations **and** teams
from the start, password login, public links kept, no separate commenter capability.

That research document is a map of the domain, not a backlog: its P0 is a full IAM product
(SAML, SCIM, policy engine, access requests, licensing) that presumes email delivery, a
test IdP tenant, pub/sub and per-tenant key management — none of which exist here.

**Decision.** Build `spec/IAM-v1.md` as the normative target, and treat the rest as deferred.

- Separations kept from the research: authentication ≠ provisioning ≠ membership ≠ admin
  roles ≠ content access ≠ entitlement. No global `user.role`.
- Resources: **organisation → team → board**. A user may belong to several organisations;
  v1 shows one active at a time.
- **The board is the unit of authorisation.** Yjs updates are not per-object, so per-widget
  rights are impossible by construction; every capability is evaluated for a board.
- Access is one deterministic function, `effective(board, viewer)`, not a policy language:
  ordered rules, max role over sources, deny-overrides for suspension, an explicit `sources`
  list for "why", and fail-closed on error.
- Deferred with reasons: SAML/JIT and SCIM (need an IdP tenant and support), email and
  magic-link (no mail infrastructure), Spaces, groups, access requests, licensing,
  `content_admin` (private-board access is a privacy decision, not a feature to slip in),
  10-second revocation (needs pub/sub), policy-as-code.

**Consequences.**

- 60–70% of the research document's value lands without any enterprise integration.
- `commenter` exists as a role but equals `viewer` until comments exist; the document says so
  instead of pretending the capability is enforced.
- The claim flow (ADR-064) is what keeps existing rooms from breaking on the day auth ships.

## ADR-062: Sessions in a cookie, enforcement in the resource service

**Status:** accepted (2026-10-25). Session listing and individual revocation are added by
ADR-153.

**Context.** Rights must be enforced where the data is: HTTP handlers and the Yjs socket.
There is no email, no SSO, and the dev app talks to the sync service through a proxy, so the
browser and the API share an origin.

**Decision.**

- **Password authentication:** `scrypt` (stdlib, no native dependency), per-user salt,
  constant-time comparison, 10-character minimum. Registration also creates the user's
  personal organisation and a `General` team, so every board has an owner and a team from
  the first second.
- **Sessions:** opaque 32-byte token, only its SHA-256 stored; cookie `remo_session`,
  `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day sliding expiry. CSRF is
  `SameSite=Lax` plus an `Origin` check on mutations plus a double-submit `X-CSRF-Token`.
- **The socket authenticates the same way.** The client connects to `/sync?room=<boardId>`
  on the same origin; the server resolves the cookie, computes `effective()` and closes with
  `4403`/`4404` when there is no `board.read`. A public link is presented as `&link=<token>`.
- **Read-only is enforced, not implied.** For a role below `editor` (and any link), the
  server drops `sync` messages of the *update* subtype while still serving `syncStep1/2`
  (the client must receive the document) and `awareness` (cursors). A viewer that writes is
  therefore refused at the protocol level; attempts are counted.
- **Revocation:** a mutation that can change access bumps `boards.acl_version` and the server
  immediately recomputes open connections for that board, closing or downgrading them; a
  30-second sweep is the backstop for anything missed (session expiry, org suspension).
  SLO v1 is 30 seconds, and 10 seconds is explicitly deferred to the pub/sub stage.
- **No email** means no verification, no reset link and no magic link in v1. That is stated
  as a limitation, compensated by the rate limit (10 attempts per 15 minutes per ip+email,
  in memory) and a change-password endpoint that requires the current password.

**Consequences.**

- A stolen cookie is a session; there is no token in URLs and no localStorage credentials.
- A read-only viewer sees everything and writes nothing, which is what "viewer" must mean.
- Because the socket re-evaluates on every access-affecting mutation, a shared board does not
  keep working for someone who was just removed — the case the research document calls out
  as the hard part.

## ADR-063: Five board roles, guests as a relation, links as a separate subject

**Status:** accepted (2026-10-25)

**Context.** The research document's board matrix has viewer, commenter, editor, co-owner
and owner, plus guests and public visitors. Our product has no comments and no accounts yet,
so two of those need a decision rather than a copy.

**Decision.**

- Roles: `viewer`, `commenter`, `editor`, `coowner`, and `owner` as `boards.owner_id` — not a
  fifth value in the role column, so "exactly one owner" is structural.
- Capabilities per role are fixed in `spec/IAM-v1.md` §3. `owner`/`coowner` add management
  capabilities; they are not "editor with a flag".
- **`commenter` equals `viewer` in v1.** Comments are not an object type here; giving the role
  write access would be a lie. The role stays in the model so the day comments exist, the
  behaviour is already named.
- **Guest is a relation, not a role:** `org_memberships.relation = guest` plus personal board
  grants, no team membership, no board creation, no sharing. A guest of organisation A can be
  a member of organisation B.
- **A public link is its own grant subject** (`board_links`), always read-only, off by
  default, rotatable, and impossible to revoke for one person — which the sharing UI says out
  loud instead of promising a revocation it cannot deliver.
- `board.share` for an editor requires the organisation policy `can_share`; co-owner always
  has it.

**Amendment after P2.** The organisation policy `public_links` is not consulted yet: v1 has
no settings screen to set it, so a default of `false` would make the feature impossible
rather than safe. A link is off until a board manager turns it on, and that explicit act is
the decision. The column stays for the admin stage, where an organisation can ban links.

**Consequences.**

- The role set matches the research document, so migrating later to comments or Spaces does
  not rename anything.
- Guests cannot accidentally inherit team access, which was the research document's explicit
  warning about modelling them as reduced members.

### Amendment 28.10.2026 — the commenter role is real

ADR-063 made `commenter` equal `viewer` because comments did not exist. M4 adds them as
server records (ADR-104/105), so the role now carries `board.comment`: it reads the board
and writes threads, but still cannot edit objects. A viewer reads comments and cannot
write; a link visitor sees no discussion. The role name and rank stay unchanged.


## ADR-064: Existing rooms are claimed, not migrated in bulk

**Status:** accepted (2026-10-25)

**Context.** Today a room is an unauthenticated Yjs document keyed by a name in the URL. On the
day authentication ships, those rooms have no owner, no organisation and no grants; bulk
migration would either invent an owner or expose every board.

**Decision.** A claim flow, one board at a time.

- A legacy room gets a `board_claims` row with a hashed token; the token is the secret that
  was the room name plus a one-time claim value. Until it is claimed, the room runs in
  `unclaimed` mode: access by knowing the room, read-write, with a banner saying it is not
  protected.
- `POST /boards/{id}/claim` with the token, by an authenticated user, makes them the **owner**
  and moves the board into their personal organisation and `General` team.
- The claim is terminal: one use, hashed token, `410` afterwards.
- Everyone else is invited as a guest afterwards — knowing the old room name does not grant
  access once claimed.
- Deprovisioning is honest: a room whose owner never claims stays in `unclaimed` mode and is
  listed in the admin view as unprotected, rather than silently deleted.

**Consequences.**

- No board changes hands without a person performing the act.
- The first deploy is safe: nothing is deleted, nothing is silently protected, and the banner
  tells the owner what to do.
- A lost claim token means the board cannot be claimed by anyone but remains readable — the
  same failure mode as a lost room link today, and it is visible in the admin list.

### ADR-064, amendment after P1

The decision said "claim by a one-time claim token". In v1 there is nobody to hand the
token to: a legacy room has no creator record, and a board created through the API already
has an owner.

So v1 claims by **knowing the room, while signed in**. That grants nothing new — knowing the
room name is exactly what access means today — it only stops being true for everybody else.
The first claim wins (`update … where owner_id is null`), repeats get `409`, and the schema
keeps `claim_token_hash` plus the check in `claimBoard` for the day rooms can be created
without an account.

## ADR-065: The organisation screen is one dialog with two questions

**Status:** accepted (2026-10-25)

**Context.** P3 left the membership model working through HTTP and the invitation link, but
nothing in the interface answered the two questions an organisation actually has: *who is
here, with what rights* and *what has been done*. The account button had a worse problem: it
signed the person out on a single click, which is a destructive action disguised as
navigation.

**Decision.**

- The account button opens one dialog, not a menu of screens: **People** and **History**
  (the audit). Signing out moves to the dialog footer, where it is explicit and reversible
  by signing in again.
- The People tab is a directory with roles, not a form. Administrator roles are three
  independent checkboxes (`org_admin`, `user_admin`, `security_admin`), because the model
  has three independent roles and a single-select "role" control would invent a hierarchy
  that the server does not have.
- **Members** see the people directory. **Guests** see only their own seat and a sentence
  explaining what a guest is; their email is never listed for an ordinary member. A guest
  is an external collaborator of one board, not a colleague (IAM-09).
- The screen hides what the server would refuse, and never re-implements the decision: each
  action goes to the API, and the refusal code becomes the sentence (`LAST_ADMIN`,
  `OWNER_TRANSFER_REQUIRED`, `FORBIDDEN`). After a mutation the screen reloads, so it shows
  the server's truth rather than a local guess.
- Suspension is reversible (`restore`), and restoring does **not** restore sessions: the
  person signs in again. A one-way suspend would be a trap in an interface.
- Offboarding a board owner is refused with the board list and an instruction. Ownership
  handover lives in **Share**, where the board and its audience already are; the people
  screen cannot become a second place to manage board access. Keeping transfer owner-only
  preserves IAM-07 and the separation "admin roles ≠ content access".
- The server resolves display names for grants and audit events (`subject_name`, `actor_name`,
  `board_title`). The client does not fetch the directory to decorate ids: a co-owner who is
  not an organisation administrator must still see who they are sharing with.

**Consequences.**

- One dialog, one set of actions, no second member picker and no duplicate "organisation
  settings" area.
- An organisation administrator cannot hand over a board they do not own. If a departing
  owner is unreachable, offboarding stays blocked — deliberately: the alternative is an
  administrator moving content between people, which the access model does not grant. The
  screen says so instead of failing silently.
- Guests remain invisible to members, so a shared board does not leak the external
  collaborator's address through the people directory.
- Audit rows join users and boards at read time: renaming a person or a board updates the
  journal's presentation, while `subject` keeps the snapshot of what happened.

## ADR-066: An AI agent is a principal with no rights of its own

**Status:** accepted (2026-10-26)

**Context.** The next feature is an AI participant that draws diagrams on a board. The
easy version — a server-side button with a model call — hides the hard questions: whose
rights does the model use, what stops a prompt from reading another board, how is cost
bounded, and how does a person see that a machine made a change. The IAM model already
has one deterministic access function and a rule that a board is the unit of
authorisation; agents must extend that, not bypass it.

**Decision.**

- An **agent** is a principal owned by exactly one person. It has no seat, no password,
  no grants and no team membership. Its rights are derived from the owner's current
  access, never stored.
- **A task is the unit of authority.** No task, no board access. A task fixes one board,
  a mode (`read | propose | write`), capabilities, a budget and an expiry.
- `agentEffective()` is a second deterministic function next to `effective()`: it takes
  the owner's decision and can only narrow it. `board.share`, `board.manage`,
  `board.transfer` and `board.delete` are forbidden to agents unconditionally. Any error
  denies.
- **Three switches, all off by default:** the organisation policy, the board flag and
  the agent's own state. An org admin can stop every agent; a board owner can stop them
  on one board; an owner can stop one agent. Disabling cancels queued tasks; a running
  task re-checks before touching the document.
- **Skills declare capabilities.** A task resolves a published skill; the server
  verifies that the skill's `required_capabilities` fit the task and the owner's role.
  The model chooses from a filtered catalogue but cannot grant itself anything: a prompt
  is not a permission. Only built-in handlers run in v1.
- **The built-in diagram skill** turns a description into a small graph, lays it out
  deterministically (language models are bad at coordinates), and writes shapes and
  connectors in one Yjs transaction. Collaborators see a complete diagram rather than
  half of one; the result is a normal set of objects a person can select and delete, but
  it is not in the client's undo stack, because its transaction is remote.
- **Budgets are hard.** Tokens are capped before the call and checked after; money,
  actions and seconds are checked before anything is written. Exceeding a budget fails
  the task without a partial diagram.
- **Writes are direct in v1, under budget.** The owner explicitly allows agents on the
  board; the person asking chooses the limits. Approval queues are deferred to the
  skills that need them (`propose`, `destructive`), not imposed on a low-risk diagram.
- **Provenance is part of the object**: `createdBy`, `agent {id, taskId, skill}`, plus
  `agent_actions` and audit events. A reader can always answer "who made this, for whom,
  with which skill".
- **Schedules are intervals** (60 seconds to 30 days), not cron, and run without a
  person online. A process that dies mid-task marks the task failed on restart instead
  of leaving it running forever.
- **Agent tokens are keys, not sessions.** They are hashed, scoped to the agent, expire,
  and are revocable. In v1 a bearer key only reads identity and task history; it cannot
  open a board. Short-lived task tickets arrive with the external runtime.
- **An agent is not a seat, does not mention people, and works on one board per task.**
  These are product decisions, not omissions to fix silently.

**Consequences.**

- An agent can never exceed the person it belongs to: demote the owner and the next task
  is read-only; suspend the owner and tasks fail.
- A leaked agent key exposes a name and a history, not content. Content still requires a
  task created by a human.
- Prompt injection is bounded by capability scope and by the absence of tools that can
  reach other boards or the network, not by asking the model to behave.
- Custom skills need a runtime and a review process; publishing a draft today is not
  enough to execute it. This is deliberate: publishing code is a security decision.
- Direct writes mean a bad diagram is possible; the budget and the one-transaction apply
  bound the damage, and removing a wrong diagram is an ordinary selection delete. A task
  cannot be undone as one step from the client: Yjs undo is local, and the agent's edit
  arrives as a remote update. Destructive skills will need approvals before they exist.
- One sync process runs one task at a time; a slow model delays the queue, not the
  canvas. Horizontal scaling would need a queue and shared room ownership, which v1 does
  not pretend to have.

## ADR-067: Provider keys live in the database behind a KEK; the agent journal is chained

**Status:** accepted (2026-10-26)

**Context.** v1 read one provider key from the environment. That cannot serve a product
where a person or an organisation brings its own key and pays for its own model, and it
makes every agent share one identity at the provider. At the same time, a database that
holds provider keys is a new class of secret: a dump or a backup must not be enough to
spend somebody's credits. The requirement also asks for an evidential record of every
agent session and its parameters.

**Decision.**

- **Keys belong to a scope**: `user` or `org`. A task resolves one in order — task,
  agent, owner default, organisation default, installation environment. An explicit
  choice that policy forbids fails; a forbidden default is skipped. `ai_key_mode` is
  `either`, `org` or `personal`, and an organisation can restrict providers and models.
- **Envelope encryption.** Every credential gets a random 32-byte DEK; the secret is
  AES-256-GCM with AAD binding scope, owner, provider and credential id. The DEK is
  wrapped by a KEK that is **not in the database** (environment in v1, KMS/HSM next).
  A dump or backup therefore contains ciphertext and wrapped keys, not usable secrets.
- **Write-only API.** The secret goes up once; the API returns metadata and a
  fingerprint, never the secret. An organisation admin can manage the organisation key
  but cannot read any personal key. The runner decrypts a key only for the duration of a
  call and never logs it.
- **Provider endpoints are untrusted input.** HTTPS only, no credentials in the URL,
  preset providers for OpenRouter/Cerebras/OpenAI, literal private and loopback hosts
  refused, custom hosts resolved and checked against private ranges before storing, and
  redirects refused at call time.
- **The evidential journal is append-only and hash-chained.** Each model call writes one
  `ai_runs` row with agent, owner, task, board, skill/version, capabilities, ACL version,
  provider, model, key fingerprint, temperature, max tokens, toolset, prompt hash, input
  object ids, tokens, cost, latency, status and error. The hash covers the previous hash;
  `seq` is per organisation and serialised with an advisory lock. Prompt and board
  content are not stored.
- **The chain is anchored outside the database** — a file outside the database directory
  or an append-only endpoint — daily and on start. Verification recomputes the chain and
  reports the first bad row. Without an anchor, a database administrator can rewrite the
  whole chain; with one, that rewrite is visible somewhere else.

**Consequences.**

- Losing the KEK makes stored keys unreadable; that is a deliberate trade for the fact
  that a database dump is useless without it. The KEK must be backed up separately and
  rotated by re-wrapping DEKs (a migration, not a restart).
- A compromised application process can use a key while it is active; encryption cannot
  prevent that. KMS, short-lived decryption, egress allowlists, limits, anomaly
  detection and fast revocation are the remaining controls.
- An anchor on the same host protects against database-only tampering, not against the
  application user. A remote append-only destination is the honest version of
  "evidence"; the file is a minimum, not a guarantee.
- Organisation admins can see that a key exists and when it was last used, not what it
  is. Support cannot retrieve it. A user who loses a key rotates it.
- The journal is more useful than prompt storage for the questions we ask after an
  incident ("which model, whose key, which task, what did it change"), and it does not
  turn the database into a copy of every board that ever used an agent.

## ADR-068: Bulk work is a change set; MCP is a façade over it

**Status:** accepted (2026-10-26)

**Context.** Cards are the first operation that touches many objects. A loop of
single-object tool calls is slow, unobservable and impossible to resume; a single
all-or-nothing request of arbitrary size is a load and correctness risk. External agents
also need a standard way in. `spec/AI-agents.md` argues for MCP + typed SDK + change
sets + jobs over one domain layer, not for one protocol replacing the others.

**Decision.**

- A **change set** is a first-class, organisation-scoped package of deterministic
  operations on one board: operations, estimate, status, progress, result, error, ACL
  version and an optional idempotency key.
- Flow: **validate → estimate (dry run) → preview (draft) → execute → progress →
  applied | failed | cancelled**. Execution runs in chunks of 50; a failure after a
  partial batch reports how many cards exist and can be resumed from the recorded
  processed sources.
- The **task queue executes a change set**. The existing agent task supplies the actor,
  budget, permissions, audit and the runner; a change set cannot bypass them.
- v1 has one operation, `create_cards`; the contract is generic so `layout`, frames or
  imports can join it without a second permission path.
- **MCP is a façade**, not a second domain layer. The v0 server is stdio-only and
  exposes boards, skills and change sets. It has no board-text reader, no SQL, no
  arbitrary HTTP and no database credentials. A remote OAuth server comes later with
  audience-bound tokens and per-tool scopes.
- Tool calls use an agent token; task creation uses the same `agentEffective()` and the
  same three switches (organisation, board, agent). A leaked MCP token can create
  change sets for its owner's readable boards only, and every one is audited.

**Consequences.**

- Large work is observable: progress, chunks, partial results and resume are part of the
  record, not a long-running HTTP request.
- A preview is an honest approval step: it writes nothing and stores the estimate; the
  execute call re-checks permissions and the budget.
- The first operation is cards; until other operations exist, "change set" is not a
  general scripting language. That is deliberate: every new operation needs its own
  validation and tests.
- MCP clients can queue and follow work but cannot browse board content. The safe way to
  give an agent context remains a task with a capability, not a standing read token.
- The stdio server is a local process and inherits the user's environment; for a hosted
  MCP endpoint the remaining work is OAuth, transport and rate limiting, not the
  domain model.

## ADR-069: The public link is one board property, not a capability

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F11-public-link` tested Miro's public link on a Business
trial. `Copy board link` mints a new `share_link_id` on every copy, but **every older id
keeps working** with the current role, dies at "No access" and **comes back to life**
when access is re-enabled — without a new copy. The id looks like a capability token and
is not one: access is decided by `board.public` + `board.sharingPolicy` at request time.
The same test showed an anonymous `Editor` writing to the board with no account, an
anonymous `Viewer` seeing owner names and presence, and an export button that ends at a
sign-up wall.

**Decision.**

- A board has **one public link subject**: `{role, enabled, password_hash,
  password_version, expires_at}`. The URL carries no secret id; it is the same URL
  whether it was copied today or last month.
- `enabled = false` revokes every copy in one step, and the UI says so in one sentence
  instead of pretending each copy is a token. Re-enabling makes the same URL live again
  **and the UI says that before the owner turns it on** — no silent resurrection.
- Public roles are `viewer` and `commenter`. An **`editor` link requires an account**:
  the link prompts sign-in and grants by link afterwards, because an anonymous write has
  no audit subject (ADR-064).
- Password unlock is bound to `password_version` in an httpOnly cookie, so changing the
  password invalidates every earlier unlock; the wrong-password message never claims the
  password "was recently changed" unless the version moved.
- Expiry is validated **server-side against `now`**, rejects past times with an explicit
  message, shows the exact moment and a countdown, and has an honest "link expired"
  state.
- A link that is off discloses **nothing**: no board title, no owner name.
- A link visitor sees **no member names, avatars or presence**; if they comment, they get
  an opaque visitor name.
- Export and AI are **not** available to a link visitor (see ADR-071, ADR-066).

**Consequences.**

- Link revocation is one decision, not a hunt for copies; "rotate the link" is not a
  feature we need.
- The Share dialog must show the link as one row with its role, password state and
  expiry — and state that the same URL comes back when re-enabled.
- Anonymous editing is not part of v1, so the sync layer never has to decide who wrote
  what for a nameless subject.

## ADR-070: Frames are layout containers, not owners

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F09-frame-delete` deleted a frame from Miro's frames panel
with 120 stickies on it: the frame disappeared, **all 120 objects survived**, and no
confirmation was shown. Frames are also the unit of presentation and export, and Miro
offers `Hide` as a frame command separate from delete.

**Decision.**

- A frame is a **container**: `delete(frame)` never deletes its objects, and undo restores
  it in one step.
- Deleting objects is a separate, named command `delete_with_content(frame)` that shows
  the object count, requires the frame's delete right, and puts the objects in the trash
  as their own entries so they can be restored individually.
- `hidden` is a frame property, not a delete: hidden frames stay listed as hidden and
  are skipped by presentation.
- Frame numbering is a stable presentation order stored on the frame, not derived from
  canvas position.

**Consequences.**

- Two commands, two permissions, two audit lines; the destructive one can never be
  reached by the same gesture as the layout one.
- Export by frame (ADR-071) uses the same container boundary, so "what a frame contains"
  has exactly one definition.

## ADR-071: Export is two grants and a job

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F17-export-formats` found seven destinations in Miro's
`Board → Export`: PDF, image, template, CSV, **`Download board backup`**, `Embed`,
Google Drive. A picture, a spreadsheet, a live embed and a full backup sit in one menu,
so the real grant ("this person may take the whole board away") is invisible at the
moment of the decision. An anonymous viewer's export button is a sign-up wall. The
backup is a ZIP with a **plain** `board.json`/`resources.json` and **encrypted**
`canvas.json`/`tables.json`; the CSV is a single column of text. There is no usable
import path from Miro except its REST API.

**Decision.**

- Two permissions: **`board.export`** — a visible-scope artefact (selection, frame or
  board as seen) in PDF/PNG; **`board.backup`** — the whole board in a
  machine-readable form. A viewer may hold the first; the second is editor/owner-level
  and always audited.
- The dialog asks **scope first, format second**, and shows the object count. There is no
  implicit "whole board".
- Export is a **job**: queued, with progress, a result link and
  `export.requested/completed` in the audit, so a large board never blocks the canvas and
  a leaked file has a trail.
- **Embed is its own subject** with its own token and revocation, never a variant of
  export.
- A link visitor gets **no export at all**.
- Our backup format is the opposite of Miro's: a documented, versioned, **plain-JSON**
  bundle (board + widgets + edges + assets + manifest + checksum), designed as the
  format we would want to import from. CSV remains a bridge for cards only.

**Consequences.**

- "May read" and "may take it away" are different rows in the permission model.
- A board backup is a first-class, self-describing artefact; if a customer leaves, their
  data leaves in a usable form.
- CSV is never a board format.

## ADR-072: Connectors are edges with endpoint references

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F07-connector-insert` tested Miro's "drop a shape on a
connection": shape `3` laid on the line `1—2` looked like `1—3—2`, but moving `3` away
left the edge **identical** — nothing was attached, the shape was only occluding the
line. Miro has **no gesture** for inserting a step into an existing flow, so a diagram
can silently misrepresent the structure. Miro also splits `Line`, `Arrow`, `Elbow arrow`
and `Block arrow` into separate object types.

**Decision.**

- A connector is an **edge with endpoint references** (`from: {node, port}`,
  `to: {node, port}`), not a path of coordinates: moving a shape moves the edge.
- `insert_node(connector, node)` is **one command**: it rewrites one edge into two, in a
  single undo step and one history row. Two independently created objects behind one
  gesture is not acceptable.
- The drag is a **preview** of that command (the edge shows the prospective split); the
  drop commits it. Dropping a node **off** an edge is the inverse command, not a delete.
- Routing (`straight`, `elbow`, `block`) is a **property** of one edge type, not three
  object types.

**Consequences.**

- Every structural edit of a diagram is a named command with its own undo and audit,
  which is what makes change sets (ADR-068) able to describe diagram edits later.
- The renderer cannot "just draw what it sees": geometry never changes the graph.

## ADR-073: Trash blocks access; restore does not revive links; a copy does not inherit one

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F17-restore-copy` deleted a board whose public link was
`Editor`: the confirmation said only "move to trash for 90 days", while the API kept
reporting `public: true` and the link **stopped working** (a non-trashed board in the same
fresh profile opened normally). So `trashed` is an access decision that outranks the ACL,
and the stored link setting survives for a later restore — the resurrection trap from
ADR-069.

**Decision.**

- Every read path checks `trashed` **before** the ACL: page, socket, public link, embed,
  export, agent task. A trashed board is closed everywhere at once.
- The delete dialog **names the sharing state**: "This board has a public link (Editor).
  Deleting it closes the link."
- **Restore does not turn the link back on.** The owner either re-enables it explicitly or
  gets it off with a notice. No URL shared months ago becomes live again without a
  decision.
- **A copy never inherits a public link.** Duplicate copies content and people grants; the
  new board starts with its link off, because a copy is a new subject.
- Retention is visible on the board card ("in trash until <date>") and the purge job is
  audited.

**Consequences.**

- Trash is safe to use as "remove from the room" without being a silent data-loss or a
  silent re-publication.
- Restore has one extra step, which is the point.

## ADR-074: Votes are journaled rows with a server-side quota

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F13-vote-budget` ran a real session on a Business trial with
two participants: a member starts a session (a link visitor is refused with "Only team
members with editing rights on the board can start a voting session"), visitors join and
vote, the budget is **per participant** and the control is withdrawn at zero, votes are
anonymous by default, the facilitator gets `End for all` and `+1 min`, results are a
`Top 3` summary, and the board keeps a session history. The budget was only ever visible
as UI state; whether the server refuses an over-budget vote was not proven.

**Decision.**

- A vote is a **row**: `votes(session_id, subject_id, object_id, weight)`, with a unique
  constraint and the budget check **inside the same transaction** as the insert.
  `session.votes_per_subject` is the quota; an over-budget vote is `409` with
  `reason: vote_budget_exhausted`. The UI still withdraws the control, but the server is
  the authority.
- **Anonymity is a session property** (`anonymous_votes`), fixed at creation and
  audited; the tally is an aggregate view, never a join that leaks voters.
- **Scope is a snapshot** of object ids taken at start; objects added later do not join.
- **Facilitation is a capability** (`board.facilitate`, granted to editors/co-owners,
  revocable), not membership — but a session always has a named owner, which is what
  Miro's membership rule protects.
- A **link visitor may vote** under a signed per-browser visitor token; the quota is per
  token, the audit says `visitor`, and no person's name is ever invented.
- `extend_session` and `end_session_for_all` are commands with audit entries, because
  they change what other people may do.
- Results: a top-N summary plus a full table, kept with the session, and an explicit
  "publish results to the board" switch.

**Consequences.**

- A workshop cannot be spoiled by a client that keeps a counter in memory.
- Vote anonymity is a property of the record, not a rendering choice.

## ADR-075: The session timer is a board object with a server `ends_at`

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F12-timer-state`: Miro's running timer is **shared and
attributed** — participants see `04:40 · Set by Alexander Kostylev` and the header shows a
remaining-minutes badge — while the timer *widget* on the canvas is visible to everyone
but `Unavailable` to non-facilitators, and the toolbar timer is a personal control
surface. My own non-following fresh visitor did not receive the running countdown, and I
could not isolate whether that was a late-join or a follow-view effect.

**Decision.**

- The session timer is a **board object** (`timer` widget) with `ends_at` (server UTC),
  `paused_at`/`remaining_ms` while paused, and `set_by` for attribution.
- Every client renders the remaining time from `ends_at`; a late joiner joins the same
  countdown and a reconnect does not drift. There is no per-client interval as the source
  of truth.
- Starting, pausing and extending require `board.facilitate`; everyone who can read the
  board sees the countdown and who set it.
- **A personal stopwatch is a separate, toolbar-only mechanism**, labelled as personal and
  never placed on the canvas — two mechanisms, two names, no ambiguity about what the room
  sees.
- Pause is a visible, audited state change ("paused by X"); the end state is explicit on
  the widget ("время вышло").

**Consequences.**

- "How long left?" has one answer for everyone, including people who joined late.
- The timer appears in export/history as an object with a time, not as a transient UI.

## ADR-076: Follow is attention, not board state; bring-everyone is a request

**Status:** accepted (2026-10-26)

**Context.** `spec/evidence/F12-follow-bring`: clicking a participant's avatar makes the
follower's viewport **and zoom** mirror that person (100 % → 39 % in the test), behind a
pink frame with a "Following Alexander Kostylev" pill; the same control unfollows; the room sees a
public follower counter (`👁 1`); the followed person gets `Stop 1 follower` and
`Bring everyone to me`, plus a `Show cursors` toggle.

**Decision.**

- **Follow is per-user attention state** in the socket (`attention: {from, to}`), never
  board state; it disappears on disconnect and is never exported.
- The **follower count is public** (as Miro does) and is an org policy: hiding counts is
  allowed, hiding the *fact* of following from the followed person is not.
- **Both sides can stop**, and the stop is reported to the follower ("Alex stopped
  following you" / "you are no longer following").
- **`Bring everyone to me` is a request**, not a hard viewport jump: each participant gets
  "Alex invites everyone to their view — Follow / Stay". A session setting
  (`allow_bring_everyone`) can make it automatic for workshops that agreed to it.
- **Pan/zoom while following pauses the follow** with a one-line notice ("following
  paused — click to resume") instead of silently snapping back.
- **Cursors are a separate toggle**, on by default for members and **off for link
  visitors** (ADR-069).

**Consequences.**

- No feature can silently move another person's viewport without their consent.
- Following is ephemeral by construction, so it cannot leak into an export, a backup or a
  change set.

## ADR-077: A connector stores waypoints, and only rigid ones are user state

**Status:** accepted (2026-10-26). Supersedes the storage half of ADR-044
(`bend`, `elbowFlip`, `curve`).

**Context.** A live look at Miro's connectors (nine states recorded by the owner:
hover→nearest target, click→bind, one middle dot per segment, move→bend, automatic
points materialise, proportional recompute, drag middle dot→rigid anchor, elbow→curve
keeps corners as rigid anchors, curves bend around them) shows that a line is a
**path with two kinds of points**: automatic ones the router recomputes and rigid ones
the user placed. Our model had `bend` (0…1) plus `elbowFlip` for a single corner and
`curve {from,to}` for bulge — three fields that each describe one special case and
cannot represent a second bend, an S-curve or an obstacle detour without a fourth
field.

**Decision.**

- A connector has `routing: straight | elbow | curved` and an ordered list
  `waypoints: [{id, x, y, rigid}]`.
- Endpoints stay `start`/`end` (`item`, `side`, `offset`) — they are not waypoints.
- `rigid: true` survives moving either end; `rigid: false` is recomputed and is not
  serialised as user intent.
- Dragging a segment midpoint issues **one** `add_waypoint` on release; dragging an
  existing rigid point is one coalesced `move_waypoint` per gesture. One gesture, one
  undo entry.
- Double-click **deletes** a point: the two adjacent segments merge into one and their
  two midpoints collapse into a single midpoint. There is no "reset to automatic" in v1:
  a point is either rigid or absent (observed in Miro and confirmed by the owner).
- Changing routing keeps rigid points; in `curved` they become supports the arc bends
  around (radius ≥ 16 px) rather than points the arc passes through.
- A connector **is deleted with its endpoint object**: an edge without both ends has no
  meaning, and a "detached" state would be a second, weaker object. The delete dialog
  counts the connectors, and undo restores the object together with them.
- Limit 32 waypoints per connector; self-loops are rejected in v1.

**Consequences.**

- One storage shape covers straight, elbow, curved, multi-bend and future routing
  modes; `bend`/`elbowFlip`/`curve` are read for one release as a fallback (a single
  automatic point) and then removed.
- Undo and change sets get a precise unit: a waypoint command, not a "line rebuild".
- Export/backup contains rigid points only; automatic points are geometry.
- The design system must render two point kinds (hollow endpoints/rigid, filled
  segment midpoints) and keep their sizes constant in screen pixels at any zoom.

## ADR-078: The design system ships as `@remo/ui`; canvas objects stay painted

**Status:** accepted (2026-10-26). Implements `spec/design-system.md` §4, §9, §10;
applies ADR-077 to the connector visuals.

**Context.** The first design-system delivery was a single IIFE bundle (`window.Remo`)
with a flat `tokens.css`, literals in semantic tokens, its own i18n, Google Fonts and an
`invalid` connector state that ADR-077 forbids. The product needs an importable
workspace package, one token source, one translation mechanism and a local-first font,
and the canvas must keep its Canvas 2D performance target (120 connectors, ≥ 50 FPS).

**Decision.**

- `packages/ui` is the workspace package `@remo/ui`: TSX sources, no build step (like
  `@remo/model`), `index.ts` plus `styles.css`.
- `src/tokens/tokens.json` is the only token source. `primitive.css`, `semantic.css`,
  `component.css`, `themes/light.css`, `themes/dark.css` are generated and checked for
  staleness. Literals exist only in primitives; a semantic token is always an alias; a
  component token never holds a colour.
- Component strings are keys (`UiKey`); the words live in `apps/web/src/i18n.tsx` under
  `ds.*` and reach components through `<UiStringsProvider value={useI18n().ui}>`. A key
  without a translation fails `tsc`. Role names reuse the product's `role.*`.
- Inter is self-hosted (latin + cyrillic variable woff2, SIL OFL), no runtime request to a
  font CDN.
- Canvas objects (sticker, connector, ports, frame, selection, cursor) are a **visual
  contract** for the painters in `packages/canvas`, which read colours through
  `readCanvasTokens()`. Only overlays live in the DOM: ports, handles, name plates, lock
  badges, pins, floating bars. The DOM versions of canvas objects are catalogue examples.
- The connector is `routing × head` (ADR-077 routing; ТЗ §5.1's line/arrow/elbow/block are
  combinations); no detached state.
- The catalogue is a dev-only route `/__ds` in `apps/web` (no Storybook); baselines are
  `spec/ds-baselines/*.png` (3 screens × 2 themes × 2 densities).
- Checks: `pnpm ds:check` (tokens fresh and linted, contrast, stylelint for colour
  literals) and vitest (token rules, literal scan, component render). Dependency added:
  `stylelint` (dev only) — required by §10.2.

**Consequences.**

- The product can adopt components screen by screen; it does not load `@remo/ui/styles.css`
  yet, so nothing changes visually until the §9 migration (old `--ink`… variables become
  aliases for one release).
- Painters must stop hard-coding colours and take them from `readCanvasTokens()`; that
  change belongs to the connector work in stage 1 of the roadmap.
- Screenshot comparison in CI waits for v0.2; the baselines are already in the repository.

## ADR-079: Product migration to tokens and the Canvas 2D palette happen together

**Status:** accepted (2026-10-26). Implements `spec/design-system.md` §9 and stage 0.6
of `spec/roadmap.md`; extends ADR-078.

**Context.** Stage 0.6 required the product to import `@remo/ui/styles.css` and replace
its 18 legacy variables with aliases. The product is not only DOM chrome: the board is
painted by `packages/canvas`, whose colours were hard-coded (`#4262ff`, `#4b5563`,
`#ffffff`…). Migrating only the DOM would have produced a two-palette product — teal
panels above a blue canvas — until stage 1.5. The palette switch is cheap to do at the
same time because the painters already take a `PaintTheme`.

**Decision.**

- `apps/web` imports `@remo/ui/styles.css` before its own stylesheet. The package is
  layered (`@layer remo.components`); the product stays unlayered and wins, so adoption
  does not need specificity fights.
- Legacy names become aliases for one release: `--ink`, `--muted`, `--faint`, `--line`,
  `--line-strong`, `--accent-strong`, `--surface`, `--canvas`, `--radius`. Names that
  collide with tokens (`--accent`, `--danger`, `--accent-soft`, `--shadow-*`,
  `--inspector-width`) are removed, not self-aliased; the package value applies.
- `apps/web/src/styles.css` contains no colour literals. A test fails on `#hex`/`rgb(`
  and on a `var()` that no token declares. Native controls set `accent-color`.
- Canvas painters take a `CanvasPalette` resolved once by `readCanvasTokens()` and
  re-read on `data-theme` change; `@remo/canvas` keeps `DEFAULT_PALETTE` only for tests
  and exports. Kanban, board background, grid, selection, guides, anchors, handles,
  drag ghost and remote cursors all use it.
- Presence uses the six design-system colours (`presence-1…6`); the old seven-colour
  Miro-derived list is gone.
- Inter is the default for notes and chrome; a stored old default font stack is
  migrated to Inter once. Users who chose another family keep it.

**Consequences.**

- The product's chrome and canvas change palette in one release; there is no period
  with two accents. The screenshots of the product are not part of the design-system
  baselines, so they are checked manually.
- `styles.css` is the visual source of the product, while components are adopted screen
  by screen; a product screen may still use old markup with new tokens.
- The alias block is temporary. Removing it is a follow-up once screens no longer use
  the legacy names; it does not change behaviour.
- `readCanvasTokens()` reads computed styles, so it is called on mount and theme change,
  never per frame.

## ADR-080: A port click makes a connector, not a note

**Status:** accepted (2026-10-27). Supersedes the click half of ADR-035; the drag half
stays.

**Context.** ADR-035 made a click on an anchor grow a connected note, because the dots
were the most direct way to say "a note goes on this side". The connector work
(ADR-077, `spec/product-refinement.md` §2.5) gives the same dots a more precise
meaning: a port is an address for a **line**, and the owner's acceptance asks for a
click to connect to the nearest candidate within 160 px, or to enter a preview when
there is none. Keeping click-to-note would make one gesture mean two different objects
and would make the acceptance untestable.

**Decision.**

- A click on a port (under four screen pixels of travel) creates a **connector**:
  - if a connectable object is within 160 screen px, it is the target, with its nearest
    anchor;
  - otherwise the line enters preview mode and follows the pointer; the next click on
    a target creates it, `Esc` cancels, nothing is written and undo does not change;
  - clicking empty space while in preview cancels.
- A drag past the threshold remains a connector drag, as before.
- Growing a chain of notes stays on `Tab` and on the floating bar's arrows; those
  commands already exist and are the explicit way to ask for a note.
- A self-loop and a second connector between the same pair are still rejected.
- The port is highlighted on hover; the candidate object's anchors are highlighted
  while a preview is active.

**Consequences.**

- A click can no longer create a note by accident; the gesture that creates a note is
  `Tab`/the bar, which is visible and undoable on its own.
- The first click without a candidate changes the mode rather than the document; the
  next click or `Esc` decides. The mode is visible as a line to the pointer, so it is
  never a silent state.
- The acceptance for connectors (§2.7.1–2.7.2) becomes testable: candidate click and
  preview are separate outcomes of the same affordance.
- ADR-035 remains the record of why anchors became clickable; only its click action is
  replaced.

## ADR-081: User help is content in the repository, one topic in two languages

**Status:** accepted (2026-10-27). Implements the help part of `spec/research/help-docs.md`.

**Context.** `spec/` holds internal requirements, ADRs and evidence; it is not user
documentation. The product speaks Russian first and English second, is local-first, and
has no router or documentation service. Adding Docusaurus or Intercom would introduce a
second deploy, a vendor and a network dependency for a product that must work offline.
The research in `spec/research/help-docs.md` recommends starting with repository content,
stable topic ids and full pages, and delaying the help panel.

**Decision.**

- Content lives in `content/help/<topicId>/`: `topic.json`, `ru.md`, `en.md`.
  Russian is the source language; English is a required translation. A missing or stale
  translation is visible in the product and in CI, not silently replaced.
- `topic.json` carries `id`, `type` (`tutorial | how-to | reference | explanation`),
  `title`, `summary`, `related`, `verifiedAgainst`, `audience` and `sourceRevision`.
  Metadata is JSON, so the build needs no YAML dependency.
- Public routes are `/help` and `/help/<lang>/<topicId>`; language is explicit in the
  path, defaults from the app/browser, and switching language keeps the topic. The
  static build is public and contains no board content, names, emails or screenshots with
  real data.
- Markdown is rendered **at build time** with `markdown-it` and `html: false`; raw HTML
  and scripts are not allowed. The dependency is build-time only.
- `scripts/docs-build.mjs` generates typed topic ids, rendered content and a per-language
  search index; `scripts/docs-check.mjs` validates ids, metadata, translation pairs,
  internal links, `HelpLink` references, stale translations and public/private rules.
- The app gets `HelpLink(topicId)` now; the help panel is a later step. UI chrome strings
  stay in `apps/web/src/i18n.tsx`; article text never does.
- Documentation is part of the definition of done for every stage that changes a
  user-visible scenario: the stage adds/updates its topics and passes `pnpm docs:check`.

**Consequences.**

- A feature PR without its help topic is incomplete, the same way a feature without a
  test is. The roadmap and `AGENTS.md` state this rule.
- Content and UI can evolve independently; a topic id never appears as a URL in code.
- The help center works offline because content is bundled/static; no external service.
- Adding a second locale later means adding a file, not a new system.
- The panel, analytics of search terms and private help are explicitly out of v1.

## ADR-082: Product metrics are typed events, collected later

**Status:** accepted (2026-10-27).

**Context.** The product needs product metrics (activation, time to value, regular use,
retention, scenario success, AI quality/cost), but remo is local-first and has no billing.
Sending raw UI events, board content or personal data to a third party would contradict
the product's privacy position. Metrics also must not be mixed with the evidential audit
log: they have a different lifetime, destination and access.

**Decision.**

- One package `packages/metrics` defines the event envelope and the typed event union:
  `event_id`, `name`, `occurred_at`, `org_id`, `actor_id`, `actor_type`
  (`user | agent | visitor`), optional `board_id`, `session_id`, `app_version`,
  `schema_version`, and typed `props`. No board content, names, emails, IP or
  User-Agent; identifiers are UUIDs.
- Emitters exist in web and sync, but share one schema. The default sink is **no-op**.
  When `REMO_METRICS_DATABASE_URL` is set, events go to a **separate PostgreSQL
  database** (`remo_metrics` by default), never to the product database and never to
  the audit tables. `REMO_METRICS=off` disables the sink even when the URL is present.
  A remote collector is a later, separately reviewed step.
- Product metrics never write to the audit log and audit events never feed metrics.
- Definitions:
  - activation: a board with at least three objects and a confirmed `board.saved`,
    reported as `activation.first_value { kind: "solo" }`; team activation (a second
    editor) is a separate event;
  - time to value: from first authenticated session to `activation.first_value`;
  - regular value: an organisation with at least three value days in 28 days, where a
    value day has a save plus an object/connector edit or an applied change set;
  - scenario success: `scenario.started` / `scenario.completed` with
    `scenarioId`, `outcome`, `durationMs`, `failureReason`;
  - AI: `agent.task.finished` with applied/failed/cancelled, cost, actions and
    duration; quality is the applied share plus later user feedback, not an LLM judge.
- Conversion, GRR and NRR are **not computable before billing**. Their event names are
  reserved (`billing.*`) and must not be reported as numbers until a billing source
  exists.
- Help search events carry `lang`, `queryLength` and `resultCount`, not the query text.
- Collection and any destination require an explicit environment flag and a privacy
  review; no metric is sent by default.

**Consequences.**

- Instrumentation can land with each stage without collecting anything yet; enabling a
  collector later is a configuration and contract change, not a rewrite.
- MAU/DAU and cohorts are org/actor based and exclude agents and public-link visitors.
- The product can state honestly which KPIs are measured and which are blocked.

## ADR-083: Board lifecycle: trash, restore and copy share one access rule

**Status:** accepted (2026-10-27)

**Context.** ADR-073 decided the semantics of trash, restore and copy from the F17
evidence, but the product had no board-level command for any of them. B4 in
`spec/product-refinement.md` asks for those paths to exist, and B6 asks the delete
dialog to name the object count and the sharing state. A per-object delete is a
different action: it never moves the board and never touches the link.

**Decision.**

- `DELETE /boards/{id}` moves a claimed board to the trash (`archived_at`), disables
  its public link and bumps `acl_version` in one transaction. `board.delete` is the
  owner-only capability; a co-owner may manage access but not destroy the board.
- The trash is not a second directory: `GET /boards` returns archived boards only to
  the owner and co-owners, marked `archivedAt`; the directory shows them in a separate
  trash section. A trashed board is read-only through `effective()` and every socket
  and link path closes.
- Restore is owner-only. It clears `archived_at`, keeps the link off, and bumps
  `acl_version`. Re-enabling the link is a separate, explicit action.
- Copy (`POST /boards/{id}/duplicate`) requires `board.share` (owner or co-owner),
  copies the Yjs document, the projection and member/team/organisation grants, and
  never copies the link. The copy is a new board owned by the person who copied it; its
  document title is rewritten to the new name so the first open does not resurrect the
  old one.
- The board delete dialog is separate from the object delete dialog. It always names
  the object count and, when the link is on, the consequence for the link. The object
  dialog stays about objects and connectors only.
- Retention is 90 days, shown in the trash row. A purge job and its audit entry are a
  later stage; until then nothing is purged automatically.

**Consequences.**

- "Delete" has one meaning per subject: objects are deleted in place with undo; a board
  moves to the trash and can be restored.
- Restore has one extra step by design; an old URL never becomes live without an
  explicit link decision.
- Copy is not an access-escalation path: a viewer cannot duplicate a board they can
  only read.

## ADR-084: Save state is an acknowledgement, not a local write

**Status:** accepted (2026-10-27)

**Context.** The topbar showed only the WebSocket state: `connecting / connected /
disconnected`. That is not the question a person asks after typing: "is my change
saved?" A connected socket can still have unpersisted updates, and a disconnected tab
can have edits that will sync later. Stage 3 requires one honest status and a bounded
offline queue.

**Decision.**

- One indicator in the topbar: `saved`, `pending` or `offline (N)`. `saved` is set only
  after the server confirms persistence; a local Yjs write never sets it.
- Acknowledgement is a small custom frame on the existing WebSocket, type 10:
  `[10, seq:uint32]`. `seq` is cumulative per tab. The server replies with the highest
  sequence it has **persisted**; one ack covers every earlier edit.
- The ack is sent by the store only after `board_updates` (Postgres) or the room file
  (disk) is written. During a write, new ack requests wait for the next successful
  flush; an ack before the bytes are durable would be a lie.
- On connect the server replies to the client's sync step 1 with its own sync step 1 as
  well. The client then sends its state as sync step 2. Without that step, edits made
  offline would never reach the server: y-websocket's server otherwise only answers
  with its own state.
- Offline edits are the Yjs document itself; no second queue exists. A tab counts local
  updates while disconnected and stops accepting input at `OFFLINE_EDIT_LIMIT = 1000`.
  The indicator shows `offline · input paused` and a notice above the board; a
  reconnected ack clears the block.
- If the server closes the socket with `4403` (access changed) or `4401` (session
  ended), the app refreshes access. The canvas stays, writes are blocked, and the
  person sees "Access changed" / "Session ended".
- After an ack the server emits `board.saved { objectCount }`. With `objectCount >= 3`
  it also emits `activation.first_value { kind: "solo" }`; a partial unique index in
  the metrics database keeps activation once per organisation.

**Consequences.**

- "Saved" has one meaning: the server has the edit. The UI can no longer claim a local
  write is durable.
- Offline work survives a reconnect, but not closing the tab before reconnect; the
  help topic says so.
- The limit is a safety rail, not an offline-first storage promise. IndexedDB is a
  later, separate decision.

## ADR-085: Backup is one plain JSON file; import replaces the board

**Status:** accepted (2026-10-27)

**Context.** ADR-071 fixed the two grants and the scope-first dialog but left the
artefact open. Miro's backup is a ZIP whose `board.json` is plain while `canvas.json` is
encrypted, and there is no import path except its REST API. A bundle split across
several files is harder to verify, harder to hand to someone, and easy to break by
copying only half of it. Import also has to decide what it does to a live board.

**Decision.**

- A backup is **one plain-JSON file**. `manifest` carries format, version, board id and
  title, export time, counts and a `sha256:` checksum over the rest of the document.
  The content is `widgets`, `texts`, `textDeltas`, `kanbans`, `meta` and `assets`.
  `assets` is present and empty in v1: images are not stored in the document yet, and a
  future asset store must extend this field rather than invent a second bundle.
- The checksum is computed over a **canonical** form (object keys sorted) and verified
  **before** the shared document is touched. A wrong format, version, checksum or shape
  is a distinct error with its own message.
- **Import replaces the whole board.** It is one non-undoable transaction, then the
  undo stack is cleared, the selection is dropped and the camera is re-framed. Import
  accepts only the remo format; a foreign JSON file is refused instead of guessed at.
  Import needs both `board.backup` and `board.edit`.
- PNG/PDF are **rendered in the browser** with the same painters as the product, so the
  picture cannot drift from what the person sees. Screen chrome (grid, selection,
  cursors) is never part of it. A scope larger than 16 megapixels is rendered at a lower
  scale instead of failing.
- PDF is **one page wrapping a JPEG**. A dependency-free PNG embedding would need a
  Flate decoder; JPEG is an image XObject as-is. Consequence: text in an exported PDF is
  not selectable or searchable, and the help topic says so.
- Export jobs are **in-memory** records with an audit row at request and completion.
  They are pruned after an hour and die with the process; a retry reuses the job id so
  one click cannot produce two `export.requested` rows.
- A link visitor gets no export: the restriction applies when the link is the **only**
  source of access. A signed-in viewer who also holds a grant keeps `board.export`,
  otherwise opening a link-shared board would silently remove export from every viewer.

**Consequences.**

- A backup can be read, diffed and archived without remo, and a corrupted file fails
  loudly instead of half-loading.
- Restore is destructive by design; the dialog says so and the current board should be
  backed up first.
- Exported PDFs are pictures, not documents; this is a stated limitation, not a bug.

## ADR-086: AI entry is an account with edit rights; a budget is agreed, not defaulted

**Status:** accepted (2026-10-27)

**Context.** ADR-066 made an agent a principal that acts for one person and only inside a
task, with three switches and hard budgets. Two gaps remained visible in the product: an
agent task could be created with no budget, in which case the server quietly supplied
defaults, and the dialog did not say which board content leaves for the model. A public
link also showed the AI button to a signed-in visitor whose only access was the link,
even though there is no account behind that decision for an agent to act for.

**Decision.**

- **AI is entered by an account with `board.edit`.** Two refusals with distinct codes:
  `ACCOUNT_REQUIRED` when the link is the only source of access (sign in or ask for a
  grant), `FORBIDDEN` when the person has an account but only reads. The button is hidden
  for both, and the server checks again: a hidden button is not a permission.
- **A budget is an agreement, not a default.** A task, a schedule or a change set without
  at least one explicit limit is refused with `BUDGET_REQUIRED`. Defaults still exist, but
  only to clamp a budget that was given.
- **The dialog shows the payload.** Before the run it names the task wording and up to
  twenty fragments of the selected objects, 200 characters each — the same rule the
  runner uses. The cards skill states that it runs without a model call.
- **Change sets are visible in the dialog** with status, `done/total`, the error, Stop and
  Resume, because a job that cannot be watched is indistinguishable from a hang.
- **The journal is filtered, not truncated.** Skill and outcome filters are client-side
  over the bounded list; `verify` stays an explicit action and names the broken record.

**Consequences.**

- A person cannot spend money or change a board by accident through a missing field, and
  cannot run an agent "as the link".
- The same refusal codes reach the API, so a script gets a reason it can act on.
- AI remains unavailable without an organisation policy, a board switch and an agent —
  three deliberate stops, not one.

## ADR-087: A configured database is not optional

**Status:** adopted 2026-10-27 (fixing a defect found at stage 6 acceptance)

**Context.** On a cold start the sync service connected to Postgres on the first
attempt, got `ECONNRESET` because the container was still starting, logged
`falling back to disk`, and served the product from local files. Nothing in the UI said
so. Every edit made in that window lived only on disk: the next start with a healthy
database would show the old board, and the work would look lost. This is worse than a
refusal, because it is silent.

**Decision.**

- A configured `DATABASE_URL` is retried for a few seconds (`connectWithRetry`), which
  covers the normal Docker cold start.
- If the database still cannot be reached, the service **exits with a clear error**. It
  does not fall back to disk.
- Falling back to disk remains the mode when **no** database is configured — that is a
  deliberate development mode, chosen before the process starts, not a reaction to an
  error.

**Consequences.**

- A failed start is visible in the terminal and in `pnpm db:check`, and no edit can be
  written to a store that the next start will ignore.
- Migrations take one advisory lock, so several processes starting together (a dev
  server, a test suite, a second instance) queue instead of blocking each other on DDL.
- The schema is **versioned** (`schema_meta`): once the row is current, a starting
  process skips DDL entirely. The lock alone was not enough — `alter table` still
  deadlocked (`40P01`) with live inserts from another test suite, which surfaced as a
  20-second timeout in the vote tests. Reading a row instead of taking table locks is
  what makes parallel suites and a second instance safe.
- Two storage modes remain, but the choice is made by configuration, not by a race.

## ADR-088: Facilitation is a capability; votes and the timer are two different records

**Status:** accepted (2026-10-27)

**Context.** ADR-074 and ADR-075 fixed the product rules: votes are rows with a quota,
the timer is a board object with `ends_at`. Implementing them raised three questions the
earlier records did not answer: who holds the capability, where the published results
come from, and what happens when two sessions overlap.

**Decision.**

- **`board.facilitate`** is granted to `editor`, `co-owner` and `owner`, and to nobody
  below: starting a session, extending or ending it, and controlling the timer are one
  capability. A viewer and a link visitor may vote and watch, not facilitate.
- **One open voting session per board.** A second `POST` is refused with
  `VOTE_SESSION_OPEN`; two live quotas on one board would make "how many votes are
  left" ambiguous both for people and for the tally.
- **The timer is one widget per board, and its phase is derived.** `ends_at`,
  `remaining_ms` and a stored `running | paused` are the record; `expired` is computed
  from `ends_at`, so no client has to write "the time is up" and a stale tab cannot keep
  a finished countdown alive.
- **Publishing is two halves with one owner each.** The server marks the session
  published and returns the aggregate; the board object is written by the client's own
  command layer (`createWidget`), because content writes belong to the document, not to
  an HTTP handler. The audit entry says who published.
- **A visitor's vote identity is a signed cookie** (`remo_visitor`), not a name and not
  the link token: the quota is per browser, the subject is `visitor:<random>`, and the
  server never learns a person. Without `REMO_VISITOR_SECRET` or `REMO_KEK` the secret
  is per process, which resets a visitor's quota on restart — stated, not hidden.
- **A configured database is mandatory** (ADR-087), and a fresh database must migrate:
  the schema's conditional `alter table widgets` now follows `create table`.

**Consequences.**

- Facilitation has one name and one grant; a workshop cannot end up with two timers or
  two open quotas.
- Results on the board are ordinary text objects: selectable, editable, exportable and
  removable like anything else.
- The tally is always an aggregate; no API response contains a subject id, including
  the caller's own (only the objects they voted for).

## ADR-089: One verification command, and the database is never skipped in CI

**Status:** accepted (2026-10-27)

**Context.** Stage acceptance was manual: 10–18 steps per stage, run by hand, with the
result recorded in a conversation. Three defects in this very session showed the cost of
that: a silent fallback from Postgres to disk, a schema that failed on a fresh volume,
and a test suite that intermittently stalled for 51 seconds because several processes
migrated at once. Each was invisible in a green `pnpm test` without a database.

**Decision.**

- **`pnpm verify`** is the single answer to "can this be shipped": database preflight,
  typecheck, all tests **including DB suites**, build, docs and design-system checks. It
  fails on the first broken step and prints a summary with durations.
- **`pnpm verify:fast`** skips the database preflight for the inner loop, and says so in
  its output; it is never the acceptance gate.
- **CI runs `pnpm verify` against a fresh Postgres service.** A skipped DB suite is a
  failure, not a pass: the difference between "green" and "green without half the
  evidence" is the whole point.
- **The fresh database is part of the test**, not an environment accident: a schema test
  asserts that no `alter table X` precedes `create table X`, and CI starts from an empty
  database on every run.
- `TESTING.md` keeps the manual steps, but every automated counterpart is named next to
  them; a stage is not accepted on a command that skips the store.

**Consequences.**

- Acceptance stops being a memory exercise; a regression in the store or in a migration
  fails the same command a developer runs locally.
- `pnpm test` remains for the fast loop, deliberately weaker than `verify`.
- The gate costs a few minutes per run and saves the 51-second mystery, the lost disk
  writes and the empty-volume breakage.

## ADR-090: Browser acceptance is a second test suite, not a demo

**Status:** accepted (2026-10-27)

**Context.** Stages 1, 4, 5 and 6 ended with manual tables: 10–18 steps each, run by a
person, with the result living in a chat. That is how a broken PNG export, a missing
permission or a vanished follow pill would reach the user. Unit tests cannot see a
button that disappeared; the store tests cannot see a dialog that never opened.

**Decision.**

- **Playwright is a dev dependency**, and `e2e/` holds the browser acceptance suite. The
  rule for adding it is the same as for any dependency: it replaces a manual mechanism
  that was already part of acceptance, not a new product feature.
- **`pnpm verify --e2e`** is the full gate: database, typecheck, all tests, browser
  scenarios, build, docs, design system. `pnpm verify` stays the faster gate without the
  browser; CI runs the full one.
- **The e2e stack is disposable and isolated**: its own database (`remo_e2e`, created
  before the service starts), sync on `:1235`, a controllable proxy on `:1237`, Vite on
  `:5175`, one worker. No dev server, database or port of the person is touched.
- **No test hooks in product code.** The one condition the browser cannot fake locally —
  losing a WebSocket to localhost, because Chromium's offline mode does not affect
  loopback — is produced by a harness proxy that can be paused and resumed over HTTP.
- **Scenarios assert through the UI, not through internal state**: a real download for
  PNG, a confirmation and notice for restore, visible save state for offline, the
  follower pill and its disappearance for follow.
- **Artifacts are evidence, not repository content**: traces, screenshots and video are
  kept on failure under `test-results/` and ignored by git.

**Consequences.**

- A stage's critical path is one command and about twenty seconds; manual acceptance is
  reduced to visual and taste judgments (Q2 adds those).
- The suite is deliberately serial and stateful: parallel workers would turn product
  races into harness races, and the suite is small enough that speed is not the problem.
- E2E does not replace unit or store tests: it proves that the assembled product works,
  not that a function is correct. Both stay.

## ADR-091: Visual evidence is committed; the automated gate is platform-independent

**Status:** accepted (2026-10-27)

**Context.** Q2 asked for PNG baselines and a comparison in CI. A literal pixel diff
between macOS and Linux fails on font rasterization alone: the same DOM produces
different antialiasing, so a moved button and a different font hinting look identical to
the comparator. Generating Linux baselines requires running the browser inside the
Playwright container, which the repository does not have yet, and pretending otherwise
would produce a gate that is red for reasons unrelated to the product.

**Decision.**

- **Five PNG baselines live in `spec/baselines/`** (three connector routings on one
  canvas, the board, the export dialog, the timer and the vote panel). They are the
  artefact a person reviews; `pnpm baselines` regenerates them.
- **The automated gate is platform-independent and semantic**: connector pixels are
  sampled where a straight line, an elbow and a curve must differ; every screen must fit
  the 1440×900 design target without horizontal overflow; axe runs on the board and the
  dialogs; the painter runs inside a frame budget.
- **A pixel diff is deliberately not the gate yet.** When a Linux baseline job exists
  (same Playwright image locally and in CI), `toHaveScreenshot` can be added on top;
  until then a red diff would mean "another platform", not "a regression".
- **Accessibility fails on serious and critical only.** Cosmetic findings are recorded,
  not fatal; a control without a name or unreadable text is.
- **The topbar collapses the words of Timer, Settings and Panel below 1560 px**, keeping
  the icon and the tooltip. At 1440 the bar overflowed by 62 px, which the viewport check
  found; the product targets 1440×900 and a horizontal scrollbar is a defect.

**Consequences.**

- A visual regression in geometry, visibility, names or performance fails the suite; a
  change in pixels that a person would notice is caught by reviewing the committed PNGs.
- The suite stays green on any OS, which is why it can run on every push.
- The path to full pixel comparison is written down instead of being implied.

## ADR-092: A command is the only way an integration writes

**Status:** accepted (2026-10-27)

**Context.** The interactive editor writes through Yjs because offline work is part of the
product (ADR-084). An integration or an automation has no tab, no local document and no
offline queue: it needs one named operation, a permission check, a durable answer and a
safe retry. Change sets already do this for two bulk skills, but they are not a general
API and their connector writer is a second implementation of the same rules.

**Decision.**

- **A command registry** (`apps/sync/commands.mjs`) holds name, required capabilities,
  input validation and the one Yjs transaction that applies the change. Six commands
  ship first: `board.item.create`, `board.item.update`, `board.item.delete`,
  `board.text.set`, `board.connector.create`, `board.connector.update`.
- **`POST /boards/:id/commands`** is the HTTP surface. It requires an account with
  `board.edit`; a link visitor gets `ACCOUNT_REQUIRED`, a viewer `FORBIDDEN`.
- **An `Idempotency-Key` is mandatory.** The key is recorded with the result; a retry
  returns the same object, and the created id is derived from board + actor + command +
  key, so even a lost response cannot produce a second object.
- **`ifVersion` makes a stale write explicit.** The version is a hash of the Yjs state
  vector; a mismatch is `409 STALE` instead of silently overwriting a person's edit.
- **A 200 means durable.** The route waits for the room's update log to flush and answers
  `503 NOT_PERSISTED` otherwise; it does not claim a save it cannot prove (ADR-084).
- **Commands are serialised per board** inside the process: Yjs merges, but a stale check
  needs a queue. Horizontal scaling would need a shared queue, which v1 does not pretend
  to have.
- **Audit is part of the command**, not of a caller: `board.command` with the object id
  and version, `board.command.denied` with the reason. Content is never in the audit.
- **The interactive UI stays on Yjs.** Making every keystroke a server command would
  destroy offline editing and add a round trip to a drag. The command layer is for
  writes that originate outside the person's open tab; the first product use is
  publishing voting results, which is one audited, idempotent write.
- **Change sets write through the registry.** The agent/MCP path still owns the plan,
  chunking, progress and resume, but connector creation and routing/waypoint changes call
  `board.connector.create`/`board.connector.update`; the old second writer is gone. The
  error codes a change set promises (`connector_self_loop`, `CONNECTOR_EXISTS`) are a
  translation of the command's codes, so the API contract did not move.

**Consequences.**

- An integration can write safely today: permissions, schema, idempotency, staleness,
  durability and audit are one path, and every refusal names its reason.
- Two write paths remain by design — interactive Yjs and server commands — and the rule
  between them is "does the writer have an open tab with an offline queue?".
- The command set is deliberately small; adding one is a registry entry, not a new route.
- One rule now decides whether a line is allowed, whether the writer is a person, an
  integration or an agent.

## ADR-093: One file, one reason to change — and a ratchet that keeps it

**Status:** accepted (2026-10-27)

**Context.** `postgres.mjs` had grown to 3 214 lines mixing six domains: rooms and
projection, identity, boards and grants, agents, provider keys, change sets, commands and
votes. Every change paid a navigation tax, and a mistake at a boundary (a method moved,
an import forgotten) was invisible until a test failed. Q4 named three modules; the
first line-count measurement found **seven** above the 800-line budget: `App.tsx` 2015,
`i18n.tsx` 2067, `useGestures.ts` 1306, `BoardCanvas.tsx` 1222, `agent-api.mjs` 1712,
`iam-api.mjs` 1239, `server.mjs` 1046.

**Decision.**

- **The store is composed, not one class body.** `PostgresStore` keeps its lifecycle
  (`connect`, `migrate`, `health`, `close`) and the two room hooks; its other methods live
  in `apps/sync/pg/*` as plain objects mixed into the prototype. The public API is
  unchanged, so no caller, test or route moved. A split that renames everything at once
  is a rewrite; this is a move.
- **One module owns one reason to change**: `rooms`, `boards`, `iam-users`, `iam-boards`,
  `agents`, `ai`, `change-sets`, `commands`, `votes`.
- **A size ratchet** (`pnpm size:check`, part of `pnpm verify`) fails on any source file
  over 800 lines. Files still waiting for their split carry their **current** ceiling in
  the allowlist: the number can go down, never up. The list shrinks as files are split:
  `i18n.tsx` (2 067) became six domain tables in Q4.2 and left the list; the remaining
  names are the Q4.2/Q4.3 work.
- **No behavior change and no new tests for behavior**: the existing 594 tests and 13
  browser scenarios are the proof that the move preserved semantics.

**Consequences.**

- `postgres.mjs` is 205 lines; the largest `pg/*` module is 552. The seven remaining
  files are explicit debt with a hard ceiling, not an unmeasured habit.
- A future feature adds a method to the module that owns its reason, and the gate notices
  when a file starts absorbing another.
- The mixin is deliberately low-tech: `Object.assign` on the prototype keeps `this.pool`
  and stack traces intact. A repository-per-domain rewrite can follow when the API
  changes for another reason.

**Q4 closed (27.10.2026).** All seven files are split; the allowlist is empty and the
800-line limit applies to every one of the 276 source files. Final sizes: `App.tsx` 797,
`BoardCanvas.tsx` 751, `useGestures.ts` 43 (plus `gestureEnv.ts` 472 and four phase
modules), `i18n.tsx` 234 (six tables), `agent-api.mjs` 79 + 7 modules, `iam-api.mjs` 86 +
`iam-http.mjs` + 5 modules, `server.mjs` 427 + 6 `sync-*.mjs` modules, `postgres.mjs` 205 +
9 modules. The 594 tests and 17 browser scenarios were never edited — the move is the
proof.

## ADR-094: Domain events come from the command layer, through an outbox

**Status:** accepted (2026-10-27)

**Context.** Q5 opens the product to integrations and automations, and both need to learn
*what happened* without polling the whole board. Two sources were on the table.

Hooking Yjs updates is the obvious one and it is wrong: a Yjs update is a byte delta, not
a fact — it carries no actor, no intent, no before/after, and it arrives from every peer
including somebody dragging a note in their own tab. An event built on top of it would be
a description of storage, not of the domain, and it could not be written transactionally
with the database that has to remember it.

**Decision.**

- **A command declares the events it produces**, the same way it already declares its
  capabilities, its validation and its transaction: a `events(result, ctx)` function next
  to `apply`. The registry stays the one place where a write to a board is described, so
  a new command cannot ship without its event being obvious.
- **The outbox row is written in the same transaction as the idempotency row.** A retry
  with the same `Idempotency-Key` writes neither twice; an event exists if and only if the
  command it describes was recorded. Storage is `event_outbox` (ADR-089 for the schema
  version), unique on `(command_run_id, type)`.
- **The envelope carries ids and counts, never board content.** `type`, `board_id`,
  `org_id`, `actor_id`, `actor_type`, `subject`, `payload`. A consumer that needs the text
  reads it through the API with its own rights (ADR-069); the default event must be safe to
  hand to a third party.
- **Delivery is a drain, not a push from the request.** A worker selects unpublished rows
  with `for update skip locked`, hands them to the consumers, then marks them published.
  Q5.1 ships the drain (`sync-events.mjs`) as the proof that the queue is ordered and
  drainable; Q5.2 adds the signed webhook as its first real consumer, reusing the same
  drain.
- **Disk mode has no outbox.** `store.recordEvents` absent means the command route behaves
  exactly as before, the same way it already does without `recordCommandRun`.

**Consequences.**

- Exactly-once relative to the command: no event without a recorded command, no duplicate
  on replay. Delivery itself is at-least-once, so a consumer must be idempotent on the
  event `id` — that is stated for the consumer rather than faked with a distributed lock.
- The command transaction grows by one insert. That is the price of the guarantee, and it
  is paid inside the transaction the route already waits for.
- Order per board is insertion order of `occurred_at`, which is enough for the automation
  scenarios in `spec/miniapps.md`; a global total order is explicitly not promised.
- **Known gap, recorded rather than hidden:** today only the HTTP command route writes the
  outbox. A change set (the agent path) calls `runCommand` in-process, so agent writes emit
  no events yet. Closing it means moving the `recordCommandRun` call into the path both
  share, and it belongs with the webhook (Q5.2), where the missing events would first be
  noticed for real.

*Correction (ADR-095):* the webhook did not close this, and should not have been expected
to. Cards are written by `cards.mjs` and connectors by `board.connector.create`, neither of
which declares an event; making agent activity observable is its own item, Q5.4.

## ADR-095: One signed webhook per organisation, delivered at-least-once with a dead-letter queue

**Status:** accepted (2026-10-27)

**Context.** Q5.1 left the outbox with a drain but no consumer. The first real consumer has
to be trustworthy enough that an integrator can act on it without asking the board: proof
that the payload came from us, proof that it is not a replay, a retry policy that survives
our restart, and a way to see and re-send what failed.

**Decision.**

- **One endpoint per organisation.** `org_webhooks` has `unique (org_id)`: the product
  sells "an integration per workspace", not a fan-out bus, and one row makes "which
  consumer gets this" a property of the tenant rather than of the event. Fan-out, if it is
  ever needed, is the consumer's job.
- **The signing secret is generated by us and shown once.** `whsec_…` on create and on
  rotate, stored in the same envelope as provider keys (own DEK wrapped by the KEK, no
  plaintext column). It is never returned again, and `GET` answers with a
  fingerprint so an operator can tell two secrets apart.
- **The signature covers the timestamp and the exact bytes:**
  `X-Remo-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>." + body)>`. A consumer
  rejects a timestamp older than five minutes, which is what makes a captured request
  useless. The event id travels in `X-Remo-Event`, so the consumer dedupes on it — delivery
  is at-least-once and the protocol says so.
- **Retries are ours; the schedule is explicit.** A failed delivery bumps `attempts`,
  stores `last_error`, sets `next_attempt_at` from a fixed ladder (10 s, 30 s, 2 min,
  10 min, 30 min, 1 h, 3 h) and after the eighth failure sets `dead_at`. The drain only
  takes rows that are due, so a broken endpoint does not spin.
- **The dead-letter queue is a column, not a folder.** Dead rows stay queryable, are shown
  in the deliveries view, and are re-sent by an explicit `POST …/webhook/replay`
  (`{eventIds?}`, otherwise everything dead for the org). Replay resets
  `published_at`/`dead_at`/`attempts` and is audited.
- **No endpoint means no recipient.** With the feature off, events are marked published
  without being sent — otherwise the outbox would grow forever for every tenant that never
  configured one. This is stated in the docs rather than left implicit.
- **Admin only, and validated like any outbound URL.** The endpoint must be public HTTPS
  (`assertSafeBaseUrl` + `assertPublicDns`, the same check as provider keys), redirects are
  refused at call time, and every change is audited.

**Consequences.**

- A consumer's outage costs us a bounded number of retries and leaves evidence in
  `event_outbox`, instead of silently dropping events during the outage.
- Delivery holds the row lock for one HTTP call (5 s timeout, batch of 20). That is
  acceptable for a first-party endpoint; a high-volume fan-out would need a lease column
  instead of `for update`.
- The protocol is documented in `spec/webhooks.md` so an integrator can verify a signature
  without reading the server.
- **The agent boundary is stated precisely, not papered over:** a change set writes cards
  through `cards.mjs` and connectors through `board.connector.create`, and neither declares
  a domain event today, so agent activity is not yet observable. Making it observable is
  its own item (Q5.4), not a claim that the webhook already covers it.

## ADR-096: An integration token is its owner's access, narrowed by scopes

**Status:** accepted (2026-10-28)

**Context.** Q5.2 gives integrations something to hear. Q5.3 has to let them act without a
browser session, and the product has exactly one model for "who may do what": the board is
the unit of authorization, and capabilities come from the viewer's role on that board
(ADR-061/062). A second permission system for tokens would be a second mechanism for the
same job — the thing this repository refuses by rule.

**Decision.**

- **A token is a person's access, narrowed.** `integration_tokens` carries `org_id`,
  `owner_id` (the admin who created it), `scopes`, `expires_at`, `revoked_at`, and a
  SHA-256 `token_hash`; the secret is `remo_it_…` and shown once. Every request resolves
  the token to its owner and asks `accessForBoard` for *that person's* current access. The
  token never grants anything the owner cannot do, and losing board access kills the token's
  power on the next request without anyone remembering to revoke it.
- **Scopes are the capability names that already exist.** `board.read` and `board.edit`
  are checked against the same strings the board access returns: the effective permission
  is the intersection `owner's capabilities ∩ token scopes`. A token with `board.edit` but
  an owner who is a viewer is a viewer; a token with `board.read` on a board the owner can
  edit is a reader.
- **Bearer only, and only where a session is not.** `Authorization: Bearer remo_it_…` is
  accepted on the read API and on `POST /boards/:id/commands`. A cookie is never required
  alongside it and is never accepted on the agent routes; agent tokens (ADR-066) stay a
  separate principal because an agent is owned by a person but acts under its own policy.
- **The audit names the token, not the person.** A command run by a token records
  `actor_type = 'integration'` and the token id, so "who did this" answers with the
  integration and its owner is one join away. Idempotency keys are scoped to the token for
  the same reason: two integrations must not replay each other's commands.
- **Expiry is mandatory, revocation is immediate.** Default 90 days, maximum one year;
  revocation sets `revoked_at` and the next request answers `401 TOKEN_REVOKED`. There is no
  "never expires" flag: a leaked token with no end date is a permanent hole.
- **Admin-only management.** `POST/GET /orgs/:id/integration-tokens` and
  `DELETE /orgs/:id/integration-tokens/:tokenId` require `org_admin`; create and revoke are
  audited (`integration.token.created`, `integration.token.revoked`).

**Consequences.**

- One permission system: a bug in board access is a bug for tokens too, and fixing board
  access fixes both. The cost is that a token cannot be broader than its creator — an
  org-wide automation needs an admin's token, which is the honest authority it needs.
- A token cannot read a board its owner cannot read, even with `board.read`: the scope
  narrows, it never widens.
- Scopes are coarse (`board.read`, `board.edit`) because the command registry's
  capabilities are coarse. When a command grows a finer capability, both the registry and
  the scope list change in one place — the registry stays the source of truth.

## ADR-097: An agent's writes are domain events too, keyed so a resume cannot duplicate them

**Status:** accepted (2026-10-28)

**Context.** ADR-095 recorded the boundary honestly: a change set writes cards through
`cards.mjs` and connectors through `board.connector.create`, and neither declared a domain
event, so a webhook consumer saw what people and integrations did and nothing an agent did.
That is backwards for the feature Q5 exists for — an automation is more likely to care about
an agent's output than about a person dragging a note.

**Decision.**

- **Connector operations become command events.** `board.connector.create` and
  `board.connector.update` declare `board.connector.created` and `board.connector.updated`
  next to their transaction, exactly like `board.item.create`. Every path that uses the
  registry emits them — the HTTP command route, a change set, MCP — so the change set needs
  no special case for them.
- **Cards are not a command, so the change set speaks for them.** `create_cards` is a bulk
  conversion with a plan, a budget and chunked progress; wrapping it in a command would
  duplicate the planning. The change set emits `board.item.created` with
  `payload.objectType = "card"` for each card it actually created. One vocabulary:
  `board.item.created` means an object appeared, whoever made it.
- **Events are written per chunk, then progress is saved.** `executeChangeSet` gains an
  `onEvents(batch)` callback called after a chunk is applied and before `onProgress`. The
  runner records the batch through `store.recordEvents`, which is a plain multi-row insert,
  not the command transaction.
- **Each event carries a `dedupe_key`, unique per board.** The format is
  `change-set:<changeSetId>:<operationIndex>:<kind>:<objectId>`. A resumed change set that
  re-applies a chunk (crash between the document write and the saved progress) hits
  `on conflict do nothing`; a webhook consumer therefore never sees the same agent action
  twice. This is at-least-once emission with a key, not a transaction spanning Yjs and
  Postgres — that transaction does not exist and pretending it does would be a lie.
- **The actor is the agent.** `actor_type = 'agent'`, `actor_id` = the agent id. The person
  who asked lives on the task row; the event answers "what changed", not "who is to blame".
- **Still not events:** updates and deletes of existing objects and text edits, on any path.
  Recorded here so the next reader does not assume `board.*.updated` exists.

**Consequences.**

- A webhook consumer now sees agent activity in the same envelope, with no new event types
  to learn for cards.
- The outbox insert uses `on conflict do nothing` without a target, so both dedupe shapes
  (command run id and change-set key) are covered by one statement.
- The event is written after the Yjs mutation; a process that dies in between loses that
  batch, which is the same window the agent-action journal already has. Closing it means an
  outbox row inside the journal's transaction, and that is worthwhile only when the journal
  itself becomes transactional.

## ADR-098: A first-party app is a manifest in the registry, and the host renders its panel

**Status:** accepted (2026-10-28)

**Context.** Q6 is the last item of the quality roadmap and the first deliberate extension
point. `spec/miniapps.md` sets the direction: declarative UI first, no foreign code in the
product's origin, no iframe, no marketplace. The question was where "declarative" is
enforced — in the client, by rendering whatever the server sends, or in the server, by only
ever sending a schema the server itself wrote.

**Decision.**

- **The registry is the allowlist.** `first-party-apps.mjs` holds the manifests; an
  organisation installs one by **id**, and the server copies the *registry* manifest into
  `org_apps`. A client cannot send a schema, a label or an action — it can only name an app
  that already exists in the build. That is what makes "no foreign code" a property of the
  system rather than a promise.
- **The panel vocabulary is closed and typed:** `panel`, `text`, `button`, `field`. The host
  draws them with design-system components, so accessibility and tokens come for free. An
  unknown node type is a manifest bug, caught by a unit test over the registry, not a
  runtime surprise.
- **Every visible string is an i18n key, never a literal.** A manifest carries
  `titleKey`/`labelKey`/`key`, and the host interpolates its own values
  (`apps.hello.greeting` with `{username}`). A literal string in a manifest fails the test.
  This is how RU/EN and the "no labels in components" rule survive an extension point.
- **Lifecycle:** install (`POST`), disable/enable (`PATCH`), uninstall (`DELETE`), all
  `org_admin` and audited (`app.installed`, `app.enabled`, `app.disabled`, `app.removed`).
  A disabled or absent app is not listed and its action answers `404` — the kill switch
  removes the whole surface, not just the button.
- **`app.hello` is an app action, not a board command.** It does not change the document,
  and the command registry's contract is "validate → apply in one Yjs transaction → event";
  a no-op command would have made that contract dishonest. The action is declared in the
  manifest and served by `POST /orgs/:id/apps/:appId/invoke`, which requires `board.read`
  on the named board for the caller (session or integration token), audits `app.invoked`
  and emits `app.invoked` to the outbox, so an integration can react to an app being used.
- **The result is text the host can render, not HTML.** `app.hello` returns an i18n key
  plus parameters; the host interpolates and escapes as usual.

**Consequences.**

- Adding an app costs a manifest, its i18n keys and — only if a new node type is truly
  needed — a renderer case in the host. There is no path for a client to introduce UI.
- The panel cannot leak board content: the greeting interpolates the viewer's own name, and
  the event carries ids, not text.
- Q6 deliberately excludes a catalog, install-time consent screens beyond the admin action,
  third-party code, iframes and billing. When those arrive, they arrive as their own ADR.

## ADR-099: The product guide is a static portal built from the repository, not a wiki

**Status:** accepted (2026-10-28)

**Context.** The product now has one user-facing surface (in-app help, 18 short topics),
one normative layer (`spec/`) and one decision log (`ADR.md`). Neither explains the
product to a technical reader who wants the model, the tasks and the exact rules in one
place. A separate docs product or a hosted wiki would drift the day it was created.

**Decision.**

- **The guide is content in the repository.** `guide/` holds the pages; `pnpm guide:build`
  renders them into `docs-site/`; the existing nginx serves that directory under `/guide/`.
  No runtime, no container, no second deployable: documentation ships with the version it
  describes.
- **One mechanism, two outputs.** `scripts/docs-core.mjs` holds the rules both collections
  share: RU is the source, EN is a required translation tracked by a content hash, raw
  HTML is disabled, links and headings are validated. `docs-build.mjs` writes the in-app
  bundle, `guide-build.mjs` writes the portal. A second Markdown pipeline would have been
  a second place for the same rules to rot.
- **The guide is a graph, and the graph is checked.** Every page must be reachable from
  `overview/index` by following links; every capability row must point at pages that
  exist; every in-app help topic must have a guide page. A page without a place fails the
  gate, so the documentation cannot quietly become a pile.
- **The guide describes behaviour, never implementation.** It may not link to `spec/` or
  `ADR.md` and may not name packages or functions. Maintainer traceability lives in
  `guide/trace.json`, is validated against the code and the ADR log, and is never rendered.
- **Text is reviewed before it ships.** `guide/style.md` is the standard and the
  acceptance checklist; a page is done when a fresh reader has gone through it and the
  findings are closed. Translation is a separate pass, not a copy of the Russian.
- **Publishing is a build step, not a project.** A significant release updates the guide
  pages it invalidates and the changelog; there is no separate "docs release" that can
  fall behind.

**Consequences.**

- A broken cross-link, a stale translation or an orphan page fails `pnpm verify`, which is
  the same gate that protects the product.
- The portal has no search server and no database: a generated `search.json` filters in the
  browser, which is enough for a corpus of dozens of pages and keeps the deploy trivial.
- The guide cannot drift into a PRD: the rules forbid requirements language and internal
  links, and the trace file carries the mapping maintainers need instead.

## ADR-100: Creating a board is a capability of a member, not a side effect of a template

**Status:** accepted (2026-10-28)

**Context.** `POST /orgs/:id/boards` has existed since IAM P1: it creates a board with an
owner, audits `board.create` and emits `board.created`. The web client never calls it. The
only "new board" path is adding one of four templates to the board that is already open,
so a person who wants a second board has to know a URL. The route also accepts any active
org membership, which includes a guest — and ADR-063 says a guest does not create boards.

**Decision.**

- **`board.create` is an organisation-level capability.** It belongs to an active
  `org_memberships.relation = member`; a guest, a suspended member and a link visitor do
  not have it. The route checks it before it reads the body, so a forbidden caller learns
  nothing about teams.
- **The UI has one entry point:** "Новая доска" in the board list opens a dialog
  (title → team → empty or one of the four templates). Creation calls the existing route
  and then opens the new room; a template is applied to the new document, not to the
  current one. There is no second "create" path in the top bar.
- **The template choice is content, not a new board type.** A board created from a
  template has the same schema as an empty one; the template only seeds widgets and a
  title. That keeps one board model and one import path.
- **A refusal is a sentence, not a disabled control:** a guest sees why they cannot create
  a board and what to ask for. The server answers `403 BOARD_CREATE_FORBIDDEN` with the
  same reason.

**Consequences.**

- The capability is checked on the server, so hiding the button is a convenience, not the
  rule.
- Creating a board is one transaction: board row, owner grant, audit, metric. A failure
  after the row would leave an ownerless board, so the store keeps it in one call.
- An organisation that later wants to restrict creation gets a policy row, not a second
  route; the capability function is the place to add it.

## ADR-101: A group can have a name without becoming a container

**Status:** accepted (2026-10-28)

**Context.** ADR-022 made a group membership (`Widget.groupId`), not an object, because a
container would have to answer geometry questions the document could disagree about.
Brainstorming needs the one thing membership cannot express: a cluster name ("Onboarding",
"Pricing"). Putting the name on every member duplicates it and lets the copies disagree.
Reviving a group object would undo ADR-022.

**Decision.**

- **A name is a board-level record keyed by group id**, not a field on members and not a
  widget: `groupNames: Y.Map<string>` (groupId → name). The group still has no box, no
  clipping and no nesting.
- **The name is a label, not geometry.** A named group draws a small label at the top-left
  of its union box; an unnamed group draws nothing. The label is selection-independent, so
  a cluster reads as a cluster without selecting it.
- **Names survive adding members.** When a selection contains exactly one existing group
  plus ungrouped objects, `groupWidgets` reuses that group's id instead of minting a new
  one, so the name stays. A merge of two named groups mints a new id and drops both names —
  there is no honest way to choose one of two names, and keeping both would be a second
  state.
- **Dissolving the group deletes the name.** Ungroup and deletion of any member already
  dissolve the group (ADR-022); a name without a group would be an orphan record.
- **The name is content:** `board.edit` writes it, undo covers it, a backup carries it.
  Limit: 64 characters, trimmed; empty means "no name".

**Consequences.**

- Existing boards gain nothing until someone names a group; no migration.
- The inspector shows the name when exactly one whole group is selected; the label is the
  always-visible half, the inspector is the edit half.
- Renaming is one map write, so two people renaming the same group resolve as one
  last-writer-wins value — the same rule as a board title, and honest for a label.

## ADR-102: Tags are a board vocabulary with stable ids

**Status:** accepted (2026-10-28)

**Context.** Tags are the cheapest way to see themes across cards and notes, and the first
half of the research-synthesis case (UC-07). A free-text tag on every object would create
"pricing", "Pricing" and "pricing " as three tags, and renaming one would require touching
every object that happened to carry the old string.

**Decision.**

- **A tag is a board-level record:** `tags: Y.Map<Tag>`, `Tag = {id, name, color}`. A
  widget carries `tagIds: string[]`, never the tag's text. Renaming changes one record;
  every object follows.
- **Colours are palette keys, not hex.** The picker offers a fixed set
  (`blue`, `green`, `yellow`, `orange`, `red`, `purple`, `pink`, `gray`) resolved through
  the design tokens, so a tag reads in light and dark and cannot introduce a literal
  colour into a component.
- **Limits:** 50 tags per board, 10 per object, name 1…32 characters after trimming.
  Duplicate names are refused with a message that points at the existing tag instead of
  silently creating a twin.
- **Deleting a tag removes it from every object in one transaction.** Undo restores both
  the record and the assignments. There is no "merge tags" command in v1: merging is
  rename plus delete, which is already two understandable steps.
- **Tags apply to cards and sticky notes in v1.** Frames are containers and connectors are
  relations; tagging them would create a second way to say what the object already says.
- **Filtering is a view state, not a document field.** The board panel can focus a tag;
  the state is local to the viewer, is not synced and is not part of undo. A saved view is
  a later feature, not a hidden tag property.

**Consequences.**

- A tag survives export/import by id and name; the backup carries the `tags` map.
- An object can point at a deleted tag only through a bug: deletion and assignment share
  one document transaction.
- The change-set schema validates `tagIds` as known ids, so an agent cannot invent a tag
  vocabulary in a card operation.

## ADR-103: An object link is one field with two targets; an internal link is a board deep link

**Status:** accepted (2026-10-28)

**Context.** People need to attach a source to a sticky, a spec to a frame, and a pointer
from one object to another object on the same board. Miro's object menu has `Link to` and
`Copy link`; the first is a hyperlink, the second is a board URL. Two features, one user
job: "take me to the thing this object is about".

**Decision.**

- **One field, two targets:**
  `Widget.link?: { kind: "url"; url: string } | { kind: "widget"; widgetId: string }`.
  A widget link is the same board deep link the search already uses
  (`?room=<board>&select=<widget>`), not a second sharing mechanism.
- **A link is content, not access.** Opening an internal link still runs the normal access
  check; a link never grants `board.read`. Copying a link is available to anyone who can
  read the object, and it is not a secret.
- **External URLs are validated on the client and on the server:** `http`, `https` and
  `mailto` only; no credentials, no control characters, maximum 2048 characters.
  `javascript:`, `data:` and `file:` are refused with a reason. An external link opens in a
  new tab with `noopener noreferrer`; remo does not fetch, embed or preview it in v1, so a
  pasted URL cannot make the server request an internal address.
- **The two kinds are distinguishable in the model and in the UI.** An external link shows
  a chain badge; an internal link shows the target's type/icon and "открыть в доске".
  A missing target is a state ("объект удалён"), not an empty board.
- **Text hyperlinks are deferred.** Rich text currently carries bold/italic/underline/
  strike; adding a link mark is a second representation of the same target and belongs
  with the text model, not with this field. When it arrives it uses the same URL validator.
- **Backup v2 carries `link` inside the widget record; import v1 has no links.**

**Consequences.**

- `Copy link` on an object is exactly the URL a person can paste into a chat; it does not
  create a token, a grant or a second link record.
- A link to a widget on another board is not a `widget` link in v1 (the target id alone is
  ambiguous); the external URL form is the way to point at another board, and it is
  honest about being external.
- If a target is deleted, the link remains as text and shows the broken state until the
  author removes or repoints it; deleting the target does not silently rewrite other
  objects.

### Amendment 28.10.2026 — where the URL is validated

`setWidgetLink` validates the URL in the document write: `safeExternalUrl` allows only
`http`, `https` and `mailto`, refuses credentials and control characters, and caps the
length. v1 has no `set_link` command on the HTTP command surface, so an integration
cannot create an invalid link through the API. A raw Yjs client with `board.edit` can
still write any value, exactly like the lock boundary (ADR-107); the UI and the document
reject unsafe URLs, but the server does not rewrite them. When a link command is added,
it must call the same validator.


## ADR-104: Comments and reactions are a server-side social layer, not document state

**Status:** accepted (2026-10-28)

**Context.** There are no comments and no reactions. The obvious cheap move is to put them
in the Yjs document, where they would sync and work offline for free. That move breaks the
one authorization rule the product has: the board is the unit of authorization, and a Yjs
update is not per-object (ADR-062). A `commenter` must be able to write a comment without
being able to write the board. Adding a second Yjs room with its own write rule would
duplicate the document lifecycle, offline queue and backup for a feature that is
inherently social. Votes already chose the opposite path for the same reason: rows, not
document state (ADR-074).

**Decision.**

- **Comments and reactions are PostgreSQL records with their own API.** They are read by
  anyone with `board.read` who is signed in; written with `board.comment`; moderated with
  `board.manage`. A link visitor does not see them: a public link is a viewing grant, not
  an invitation to an internal discussion.
- **The document stays the only place for board content.** Comments do not enter
  `BoardDocument`, undo, the Yjs room or the command registry. A comment cannot be undone
  with ⌘Z, and that is correct: it is a message, not an edit.
- **Live updates reuse the existing socket.** The server broadcasts a `comments.changed`
  nudge (message type 11, outside the Yjs range) with ids only; clients refetch. While the
  discussion panel is open, a 30-second poll is the fallback. There is no second realtime
  channel and no comment payload in the socket.
- **Offline is honest.** A comment draft is kept locally, but sending requires a
  connection; the UI says so and does not queue a message that could arrive hours later.
  Reactions are online-only for the same reason.
- **`commenter` stops being an alias of `viewer`.** `board.comment` is added to the role
  table for `commenter`, `editor`, `coowner` and `owner`; `viewer` reads comments only.
  ADR-063's footnote is superseded by this ADR, not rewritten.
- **Reactions are records, not a counter:** `(board, object, subject, emoji)` is unique, so
  two simultaneous clicks produce two rows and a count of two; toggling deletes the row.
  The emoji set is closed (12 common reactions) so rendering is one font path, not an
  image pipeline.
- **Backup v2 carries comments and reactions** in the same plain-JSON bundle. PNG/PDF and
  CSV do not: a picture of a board is not a discussion export.
- **Audit without content:** `comment.created`, `comment.resolved`, `comment.deleted`,
  `reaction.added`, `reaction.removed` carry ids and counts, never the body.

**Consequences.**

- Comments do not work on a board that has never been claimed and has no database; the
  unclaimed-room mode stays read/write for the document only. The panel says so.
- The social layer can grow notifications and mentions without touching the document
  model.
- A backup now has two sources (Yjs state and social rows); the export route builds both in
  one request, and the checksum covers the whole bundle.
- Deleting a board deletes its threads and reactions by `on delete cascade`; trashing a
  board hides them with the board and restore brings them back.

### Amendment 28.10.2026 — reactions are live, not records

The first version of this ADR put reactions in the same server-side table as comments,
with one row per person and emoji. R1 (`F20-reactions`) showed that Miro's reaction is
**not** an object tally: the facilitation menu sends one of six emoji as a large burst
near the pointer, with no badge, count or author list on the object. Persisting that as a
row would invent a feature nobody asked for and make a momentary signal look permanent.

- **Reactions are ephemeral awareness/overlay events.** Payload: emoji, subject,
  timestamp, position. They are not written to PostgreSQL, not part of a backup and not
  counted.
- **The set is closed** (thumbs up, love, fire, surprised, party, clap), matching the six
  the product offers.
- **Any reader may react**, including a link visitor: a burst creates no content and no
  record. This is a deliberate difference from comments, which remain account-only.
- **The schema does not gain `object_reactions`.** M4 delivers comments (server rows) and
  reactions (overlay) as two mechanisms, because they are two jobs.

## ADR-105: A comment thread has an explicit anchor, a resolve state and no nesting

**Status:** accepted (2026-10-28)

**Context.** The live product shows the lifecycle clearly (F10-comment-pin): a pin is
dropped on the canvas or on an object, a thread card opens, `Resolve` is a toggle, and a
reply re-opens the discussion. Two things were not verified: whether the pin follows an
object, and what happens when the object disappears. The model has to answer both before
the UI can be honest.

**Decision.**

- **Every thread has exactly one anchor:** `{kind: "widget", widgetId}` or
  `{kind: "point", x, y}`. A widget anchor stores the id, not coordinates, so the pin
  follows the object; a point anchor stores absolute canvas coordinates and stays where it
  was dropped. A pin never "looks attached" without being attached.
- **A thread is a root comment plus flat replies.** No nesting: a reply to a reply belongs
  to the same thread, which is what the source product shows and what keeps the panel
  readable. Body limit 4000 characters; a thread has no hard reply cap in v1.
- **Resolve is a state; a reply re-opens.** `resolved_at`/`resolved_by` are set by the
  resolve toggle and cleared by a reply. Resolved threads are hidden from the default list
  with an explicit "show resolved" switch; the pin stays on the canvas.
- **Deleting a widget does not delete its threads.** The anchor resolves to `null`, the
  pin disappears, and the thread remains in the panel marked "объект удалён". History is
  not silently destroyed by a canvas edit. Deleting the board still cascades.
- **Read state is per subject:** `comment_reads(thread_id, subject_id, last_read_at)`.
  Unread is derived, not a counter that can drift. Opening a thread marks it read; the
  panel shows the unread count.
- **Authorship is an id plus a name snapshot.** A signed-in author is `user:<uuid>` with the
  name at the time of writing; a rename shows the current name when the user still exists,
  and the snapshot keeps history readable when they do not.
- **Rights:** author edits/deletes their own comment (edited comments say "изменён");
  `board.manage` may soft-delete any comment for moderation; nobody can edit another
  person's words. A deleted comment leaves a tombstone in the thread.
- **No mentions or notifications in v1.** `@` is a second system (resolution, access
  check, delivery) and would be a promise the product cannot keep yet. The help topic says
  comments are read in the board, not pushed.

**Consequences.**

- The activity panel is a list over rows, so "since last visit" and unread are queries, not
  client heuristics.
- A free pin and an object pin are visibly different; moving an object does not drag free
  pins with it.
- A thread can outlive its object, which is the point: the discussion is often the reason
  the object existed.

### Amendment 28.10.2026 — pins, one live signal, restore and offline

ADR-105 left three questions open: how a thread is seen on the canvas, how a peer learns
about a new comment without polling, and what a backup does with threads. M4 closed them
with one mechanism each.

- **A pin is a projection, not a stored position.** The screen point is recomputed from
  the anchor and the current camera on every render. A widget anchor follows the widget;
  a point anchor stays in world coordinates; a deleted widget has no pin while its thread
  remains in the panel. No screen coordinates are saved anywhere.
- **One live signal: frame type 11.** A mutation on the comments route broadcasts an empty
  frame to the board's sockets. The panel reloads the list; it does not poll. A frame
  missed while disconnected is recovered by the reload on reconnect, so the frame needs no
  queue and cannot become a second source of truth.
- **Restore is part of replacing the board.** `POST /boards/:id/comments/restore` requires
  `board.backup` (not merely `board.comment`), deletes the board's threads and recreates
  them from the backup. Author ids are absent from a backup, so names are kept and the
  account link is dropped; a restored thread is history, not authorship. An empty backup
  clears the discussion, because import replaces rather than merges.
- **Offline keeps the draft and says so.** The textarea stays editable, sending is
  disabled, and the panel names the reason. There is no outbox for comments: a comment is
  a server write, and a client queue would be a second delivery mechanism. The draft is
  local UI state and is not promised across a reload.

**Consequences.**

- Moving an object moves its pin with no extra write, and a camera move never mutates the
  document.
- The socket stays a nudge: comments are still fetched over HTTP, so access checks and
  unread counts have one home.
- Import cannot silently keep threads that the restored board never had.


## ADR-106: A card's status is its column; assignee, due date and tags are fields

**Status:** accepted (2026-10-28)

**Context.** The card currently has a title, text and colour. F15-card-fields found six
fields in the source product's own card tour: colour, tags, assignee, due date, title and
an expandable description. It also found no status control on the card itself: status is
where the card sits in a kanban. The product has no users yet, so the model can change
without a migration promise.

**Decision.**

- **Add three fields, not a status:** `assigneeId?`, `assigneeName?`, `dueAt?` and
  `tagIds?`. `status` is deliberately absent: a card's state is its
  `KanbanPlacement.columnId` (ADR-006). Storing both would create two answers to "where is
  this card", and the first drag would make them disagree.
- **`dueAt` is a calendar date (`YYYY-MM-DD`), not a timestamp.** A card is due on a day;
  storing an instant would make "today" depend on the server's timezone. Overdue is
  derived in the viewer's local date.
- **`assigneeName` is a snapshot.** Assigning writes the user id and the current name;
  the UI prefers the live name when the user still exists, and the snapshot keeps export,
  backup and a deleted account readable.
- **Assignee is any signed-in person who can read the board**, not only editors. Being
  named is metadata, not permission. The picker lists board members and grants, never the
  whole organisation.
- **WIP limit is an indicator, not a gate.** The column stores `wipLimit`; the header shows
  `count / limit` and a warning state when exceeded. A drop is never refused: blocking a
  person mid-workshop is worse than a red number, and the source product's own behaviour is
  unverified (F15-wip-limit is queued for REA).
- **Card face:** title, assignee, due badge, at most three tag chips; the rest is in the
  inspector. Overdue is a word/icon plus colour, not colour alone.
- **Filters are view state.** Tag and assignee filters live in the board panel and are not
  synced; a saved view is a later feature.
- **Existing cards need no migration:** all fields are optional. CSV gains columns in a
  fixed order; backup v2 carries the fields inside `widgets`; import v1 reads as "no
  fields".
- **Agents may set the fields.** `create_cards`/`update_card` validate a known key map;
  adding a field is a schema addition, not a new operation (ADR-068).

**Consequences.**

- Moving a card changes its status by changing its column, and there is no status field to
  keep in sync.
- A card outside a kanban has no status; the inspector says "не в колонке" instead of
  inventing one.
- WIP overrun can be ignored by the team; it is information, not policy. If a customer
  needs a hard limit, that is a policy feature with its own ADR.

### Amendment 28.10.2026 — status is a card field, and the date is a range

R1 (`F15-card-fields-edit`) exercised a native card on the Business plan. The card
toolbar exposes **status** (`To do` / `In progress` / `Done` / `Remove status`), one
assignee, tags, a link and a **Start Date / End Date** range. The original decision —
"status is the column, one due date" — is therefore only half right.

- **Add `status` to the card:** `todo | in_progress | done`, optional. It is a card field
  and is rendered as a chip on the card face.
- **The kanban column stays a placement.** Moving a card between columns does **not**
  automatically rewrite its status in v1; the two are separate concepts until
  `F15-kanban-move` says otherwise. This is a deliberate difference from a system that
  derives one from the other, and it avoids a second source of truth that disagrees on
  the first drag.
- **Replace `dueAt` with a range:** `startAt?` and `dueAt?` (the end). A single date is
  the same pair with `startAt` absent; a range renders `Oct 30 — Oct 31`.
- **One assignee in v1.** The picker shows names and emails to a collaborator; the card
  chip shows the name, never the email.
- **The card remains a record, not a second kanban.** A card outside a kanban can carry
  a status; a card inside one carries both its status and its column, and the inspector
  says which is which.


## ADR-107: An author lock records its author; only the author or a board manager unlocks it

**Status:** accepted (2026-10-28)

**Context.** ADR-040 added `locked: boolean`: a locked object cannot be moved, resized,
edited or deleted, but any editor can unlock it. The owner now asks for an author lock:
the person who protected an object should be the one who releases it. F03-lock found that
Miro's hint ("Long press to unlock") suggests anyone with edit rights can release a lock;
the behavioural test was not completed.

**Decision.**

- **The lock records who made it:** `lockedBy` (user id) and `lockedAt` next to `locked`.
  The flag stays, so old documents and old clients still understand "locked".
- **Unlock rule:** the author, or a holder of `board.manage`, may unlock. Any other editor
  gets a refusal with the author's name — not a silent no-op. `Unlock all` releases the
  caller's locks; a manager's `Unlock all` releases every lock.
- **A legacy lock without `lockedBy`** is treated as "any editor may unlock" until it is
  toggled once; this is the only migration and it is visible in the UI.
- **Locking a group locks its members.** A group is membership (ADR-022), so there is no
  group object to lock; selecting a group and locking writes the flag on each member. A
  lock on a frame does not lock its children: a child is a separate object and can still
  be arranged inside its frame.
- **Copies are unlocked.** Duplicate, copy/paste and import of a locked object produce an
  unlocked copy: a lock protects the original, and a copy is a new decision.
- **Agents and change sets skip locked objects** and report the skip in the result. They do
  not fail the whole job and they do not force-unlock.
- **Lock is coordination, not access control.** The server enforces it in commands and in
  the social layer, but a raw Yjs client with `board.edit` can still write the document.
  The UI, the help topic and this ADR say that plainly. A true per-object permission needs
  a different model (per-object rooms or a server-side document), which the board-level
  rule deliberately rejects.
- **Every toggle is audited** as `object.locked` / `object.unlocked` with the actor and the
  object id; no content.

**Consequences.**

- A locked object remains selectable, alignable, exportable and a connector endpoint; the
  lock refuses change, not reading.
- A person who leaves the organisation leaves their locks behind; a board manager can
  release them, which is why the override exists.
- The UI can no longer promise "anyone can unlock"; it promises "the author or a board
  manager", and the refusal names the author.

### Amendment 28.10.2026 — the author's name, and what enforcement actually covers

The accepted rule stands: one author lock, released by the author or a `board.manage`
holder, with a legacy authorless lock releasable by any editor. Implementation added two
details the decision implied but did not name.

- **`lockedByName` is a snapshot.** `lockedBy` stays the id, because that is what the
  permission check compares. The name is copied at lock time so a refusal can say
  "заблокировал Анна" without a user lookup, and so the sentence stays readable after a
  rename or a deleted account. This mirrors `assigneeName` (ADR-106).
- **Enforcement covers every write path the product owns.** Document commands refuse a
  locked object for move, resize, text, style, card fields, tags, links, kanban placement
  and kanban structure; the server command registry refuses update and delete with
  `OBJECT_LOCKED` and refuses a foreign release with `LOCKED_BY_OTHER`; agents and change
  sets skip and report `reason: "locked"` instead of failing. A raw document client with
  `board.edit` is still outside this boundary, which is why the help topic calls the lock
  coordination rather than security.
- **Locking a mixed selection skips what is already locked.** Re-locking must not take
  authorship from the person who locked the object first.
- **Audit follows the path that has an actor.** A server command that toggles the flag
  writes `object.locked` or `object.unlocked` beside its `board.command` row. An
  interactive toggle is a Yjs update and cannot be attributed server-side, so it is not
  separately audited; the document does not carry the acting user.
- **Copies drop the lock fields at paste time.** Duplicate, copy/paste and a template
  insert all go through the same insertion path, so one deletion of `locked*` keeps the
  rule in one place. A board backup restore is not a copy: it restores the board as it
  was, including the lock record.

**Consequences.**

- The refusal has a name to show and does not need a network round trip.
- The UI still cannot promise that a determined client is stopped; it promises that the
  product's own surfaces refuse, name the author and leave an audit trail.


## ADR-108: Presentation is frame order in the document and live state in awareness

**Status:** accepted (2026-10-28). One presenter at a time is added by ADR-152.

**Context.** Follow already streams a camera through awareness: a viewer can follow a
presenter, the counter is public, either side can stop (ADR-076). Presentation needs more
than a camera: an order of frames that is independent of canvas position, a presenter who
can advance, followers who cannot, a late joiner who starts at the current slide, and an
exit that does not throw the presenter's viewport away. The evidence (F09) confirms the
order is independent of position; the exit and late-join behaviour were not tested.

**Decision.**

- **The order is document state:** `presentation: Y.Array<string>` of frame ids. It is
  independent of frame coordinates and `z`; reordering slides never moves a frame on the
  canvas. Adding a frame to the order is explicit ("добавить все фреймы" is one action,
  not a background rule).
- **The live state is awareness, not the document:** `{presenterId, frameId, index,
  startedAt}` in the presenter's awareness. Nothing about "who is presenting" is written
  to the board, so a crash or a closed tab ends the presentation instead of leaving a
  ghost. A reconnecting presenter resumes only if the awareness state is still fresh.
- **The presenter is a facilitator:** starting requires `board.facilitate` (editor and
  above, ADR-074/075). Followers need `board.read` only.
- **Followers fit the frame locally, they do not mirror a pixel viewport.** The presenter's
  window is not the follower's window; copying the camera would crop or letterbox the
  slide differently on every screen. Each client frames the current slide with padding,
  and the presenter's cursor remains visible as a separate awareness object.
- **Navigation belongs to the presenter:** next/previous, `→`/`←`, `PageUp`/`PageDown`,
  `Esc`. A follower cannot advance; they can leave the view. The presenter's chrome stays
  (they may need to edit live); followers see the board without panels and grids.
- **Late join and return:** a late reader sees "Идёт презентация · Смотреть" and joins at
  the current slide, never at slide one. "Вернуться к ведущему" re-fits the current slide
  after the follower has panned away.
- **Exit restores the presenter, not the followers.** The presenter's camera before start
  is stored locally and restored on exit. Followers stay on the last slide and can navigate
  away; they are not thrown back to a viewport that was never theirs.
- **A deleted slide is skipped.** If the current frame disappears, the presenter advances
  to the next existing frame; if none remains, the presentation ends with a message. The
  order array is cleaned when a frame is deleted.
- **No second realtime channel.** Presentation reuses the awareness and follow plumbing;
  there is no presentation server and no recording in v1.

**Consequences.**

- The same board can be presented by one person while another edits; edits appear live to
  followers, and the presenter is not a lock.
- Presentation order is part of a backup (v2) because it is document state; the live
  "who is presenting" is not.
- A follower on a small screen sees a readable slide, not a scaled-down copy of the
  presenter's desktop; this is a deliberate difference from pixel mirroring.


### Amendment 28.10.2026 — Miro has two locks; we keep one author lock

R1 (`F03-author-lock`) found two controls on a card: an ordinary padlock whose hint is
"Long press to unlock" and a shield whose aria-label toggles between **"Anyone can
unlock"** and **"Only board owner or co-owner can unlock"**. The second is Miro's
protected lock; the first is a coordination lock any editor can release.

ADR-107 keeps **one** lock with `lockedBy`: the author or a `board.manage` holder
unlocks. That is a deliberate difference:

- Miro's protected lock is narrower than the request ("the author protects the object"):
  an editor who locks a card cannot release it, and only the owner/co-owner can.
- A second mode would be a second mechanism for the same job on a team of ten. If a
  customer needs owner-only protection, that is a policy feature with its own ADR.
- The ordinary Miro lock is closer to our model, but without an author: it says "anyone
  can unlock". We add the author because accountability is the point of the request.

The help text says "the author or a board manager", never "only the owner".

## ADR-109: Hostile input is refused at the boundary, never decoded by guesswork

**Status:** accepted (2026-10-29)

**Context.** A security pass found six ways around the access model: a non-canonical
varint let a viewer's update pass the read-only socket filter; an editor could promote
themselves to co-owner through the sharing route; a bearer invitation granted access
before its email was checked; one malformed URL or cookie could end the sync process; a
custom AI endpoint could reach loopback through IPv4-mapped IPv6, a named provider could
override its URL, and the model client followed redirects; and the access endpoint
returned board metadata to an account that could not open the board.

**Decision.**

- **Protocol fields are decoded, not indexed.** The read-only guard reads message type and
  sync step as `lib0` varints, the same decoder Yjs uses, and allows exactly awareness
  plus one initial `syncStep1`. A frame that cannot be decoded is dropped. The server's
  own `isSyncStep1` uses the same decoder.
- **Management roles are management decisions.** Creating, promoting to, demoting or
  deleting a `coowner` grant requires `board.manage`, whatever the subject type and even
  when the subject is the caller. `board.share` remains enough for viewer/commenter/editor.
- **A bearer invitation is checked inside its transaction.** The recipient email is
  compared after the row is locked and before any membership, grant or invitation state is
  written. A mismatch rolls back: no seat, no grant, invitation still pending.
- **Both network boundaries answer instead of throwing.** URL and cookie decoding is
  guarded; an HTTP handler rejection is caught and answered 400 for caller input or 500
  otherwise; a malformed upgrade gets 400 before a WebSocket exists.
- **Outbound provider calls go through one client.** It accepts HTTPS only, resolves every
  address, refuses private, loopback, link-local, unique-local, multicast and
  IPv4-mapped/compatible IPv6, pins the connection to the verified address through the
  socket `lookup`, and refuses redirects. Named providers keep their fixed preset; a
  different URL means the `custom` provider, which is DNS-checked on save and on every call.
- **No metadata without access.** `/boards/:id/access` returns 404 with no board object
  when access is not allowed; the password-required and inactive-link answers stay as they
  were because they carry no metadata either.

**Consequences.**

- A viewer cannot write even with a hand-crafted frame; the test applies the same bytes to
  Yjs to prove they were a real update.
- A mismatched invitation is still usable by the right account, which is what an inviter
  expects after a leaked link.
- A malformed request costs one 400, not the process.
- DNS rebinding has no window between check and connect: the socket is pinned.
- These are boundary rules, not per-object permissions; ADR-107's lock remains
  coordination, and the document itself still trusts a client with `board.edit`.


### Amendment 29.10.2026 — webhooks share the pinned outbound transport

ADR-109 covered model-provider calls. A webhook URL has the same DNS-rebinding problem:
validating the host when it is saved does not stop a later DNS answer from pointing at
loopback. Delivery now uses the same `safeFetch`: every attempt resolves and checks all
addresses, pins the socket to the verified address, refuses redirects and requires HTTPS.
`REMO_WEBHOOK_ALLOW_PRIVATE=1` is the explicit exception that permits private destinations;
it is passed as `allowPrivate` per delivery and does not weaken the address pinning. A test
runs the real Node HTTPS transport with a `{ all: true }` lookup, which is the callback shape
that previously failed with `ERR_INVALID_IP_ADDRESS`.

## ADR-110: A frame adopts an object dropped inside it, and releases it on exit

**Status:** accepted (2026-10-29)

**Context.** Frames already own their children: a template places stickies inside a frame
with `parentId`, and moving the frame moves them. But a sticky added later never joined a
frame, so the documented promise "objects inside a frame move with it" held only for
template content. The portal now states the real behaviour as a limitation; the product
gap is worth closing rather than keeping two kinds of frames.

**Decision.**

- **Membership follows the centre point.** After a move, a top-level object whose centre is
  inside a frame becomes its child; an object that was a frame child and whose centre is
  outside is released. Position is not enough on its own: an object half outside belongs to
  the frame only when its centre is inside.
- **Only ordinary objects are adopted.** Frames do not nest, connectors are not children,
  and a card inside a kanban stays placed by the matrix. Locked objects are not moved, so
  they are not reparented either.
- **The smallest containing frame wins** when frames overlap. This is deterministic and
  does not depend on z-order.
- **One transaction.** The move and the parent change are one undo step. Moving a frame
  itself does not reparent its children: they keep belonging to it.
- **A release is explicit.** Dragging a child out removes `parentId`; the object stops
  following the frame. `delete`/undo keep working on the resulting tree.

**Consequences.**

- A sticky dropped into a section now moves with the section, which is what a frame looks
  like to a person.
- Moving an object through a frame without stopping does not adopt it: only the final
  position is evaluated.
- Templates and old documents keep their `parentId`; no migration is needed.
- A frame is still a container, not a permission boundary: membership changes geometry,
  never access.

## ADR-111: Board titles are searched in the board panel, not in the widget index

**Status:** accepted (2026-10-29)

**Context.** The board panel searches widget text through the projection: a query returns
objects, not boards. A person who remembers the name of a board but not a phrase inside it
has no way to find it, although the list of accessible boards is already loaded in the
same panel.

**Decision.**

- **The title filter runs over the loaded board list.** The panel already receives every
  accessible board from `GET /boards`; filtering that list by title is exact, instant and
  does not introduce a second server-side search. The widget search stays as it is.
- **One query field drives both.** A query of at least two characters shows matching board
  names first and widget hits second, each with its own count. A board opens with the same
  action as in the list.
- **The filter is case-insensitive and matches the id as a fallback**, because a board may
  have no title yet. It never reveals a board that is not already in the list.
- **No new table or index.** The projection index is for content; the board directory is
  small by design (one team, tens of boards).

**Consequences.**

- A board is findable by the name a person remembers, without touching a room.
- The panel remains one search surface: title first, content second.
- A very large directory would need a server query later; that is a different ADR, and the
  current product target is a small team.

## ADR-112: A card filter selects matching cards; it does not hide the board

**Status:** accepted (2026-10-29)

**Context.** Cards carry assignee and a date range, but there is no way to answer "what is
mine" or "what is overdue" without scanning the canvas. Hiding non-matching cards would
change what a colleague sees and would need a second visibility model on top of the
document; saving named filters would be a third.

**Decision.**

- **A filter is a selection.** The panel computes the cards that match the assignee and due
  condition and selects them. The canvas keeps every object visible, the selection badge
  shows the count, and the existing commands work on the result.
- **Two conditions in v1:** assignee (any / one person from the cards on the board) and due
  state (any / overdue / no due date). Status is already a field and can be added when a
  real request exists; it is not a second filter mechanism now.
- **Overdue is local.** `dueAt < today` in the viewer's local date, the same rule the card
  face uses. A card with no due date is its own option, not "not overdue".
- **No document write and no saved views.** The filter is UI state; a reload clears it.
  Named views would be a document feature with its own ADR.
- **Empty result is stated.** The panel says that nothing matches instead of selecting an
  empty set silently.

**Consequences.**

- A person can act on "my cards" or "overdue" with the commands they already know.
- Nothing is hidden from collaborators, so the filter cannot be mistaken for permissions.
- The people list comes from the cards themselves, so the panel needs no extra request.

## ADR-113: A card can be a connector endpoint, resolved through its kanban placement

**Status:** accepted (2026-10-29)

**Context.** ADR-020 excluded cards as connector endpoints because a card has no free
coordinates: its box comes from the kanban matrix, while `widget.x/y` are a stale capture
value. Drawing a line to `widget.x/y` would attach it to an invisible point. The product
now has cards as records with assignee and dates; a dependency line between a card and a
note is useful, and "a card cannot be an endpoint" reads as an accidental limit.

**Decision.**

- **Cards are connectable.** A connector may start or end on a card, with the same side and
  offset anchors as any leaf object.
- **Geometry resolves through the matrix.** Every consumer that turns a widget into a box
  (connector path, anchors, hit-test, export) first replaces a card with a placement-aware
  clone: `x/y` is the card's current placement centre and `width/height` its placement
  box. The stored `widget.x/y` is never used for a card.
- **Moving a card moves the line.** The placement changes, the clone changes on the next
  paint, and the path is derived again; nothing is written to the connector.
- **Missing card, missing line.** If a card is deleted or its kanban is gone, the resolver
  returns no box and the connector disappears like any other broken endpoint.
- **Server and change sets agree.** The command registry and change set `CONNECTABLE` sets
  include `card`, so an integration can create the same line as the UI.
- **Selection and editing are unchanged.** A card is still picked as a card, not as a
  connector; only the geometry helpers see the placement clone.

**Consequences.**

- A dependency from a note to a card now follows the card between columns.
- A connector to a card inside a filtered/selected view is still the same document edge;
  filters select, they do not hide.
- Old boards have no card endpoints, so no migration is needed; old connectors keep their
  current ends.

## ADR-114: Comments follow the slide in presentation and travel into an export

**Status:** accepted (2026-10-29)

**Context.** Comments were deliberately server-side and absent from PNG/PDF (ADR-105).
That is right for a picture of the board, but two workflows were left without an answer:
a presenter cannot see the discussion for the slide being shown, and a person who exports
a board for review loses the discussion that explains it.

**Decision.**

- **Presentation shows the comments of the current slide.** Pins are filtered to threads
  whose anchor belongs to the frame the presenter (or the followed presenter) is showing:
  a widget anchor walks its parent chain, a point anchor is inside the frame box. The
  panel lists the same threads, so a pin and a row cannot disagree.
- **Export includes comments only on request.** PNG/PDF has an **Include comments**
  checkbox, on by default when the board has unresolved threads. A backup already carries
  comments and is not affected.
- **One visual language: numbered pins and a legend.** Open threads are numbered in the
  export, a pin sits at the anchor, and a legend below the picture repeats the number,
  the anchor label and the messages. Resolved threads stay out, as they do on the board.
- **Scope is respected.** A thread is exported when its widget anchor is in the chosen
  scope, or a point anchor is inside the exported box. A frame scope therefore carries its
  comments, a selection carries only its own.
- **Presentation and export are read-only.** Neither writes a comment, a read marker or a
  document change. Opening the panel still marks a thread read, as on the board.
- **The picture stays the picture.** Export without the checkbox is exactly the old image;
  the legend is added below the board, not over it, so a print has both.

**Consequences.**

- A reviewer receives the discussion with the board, with pins that point at the objects.
- A presenter can answer "what was said about this slide" without leaving the mode.
- Resolved history is not printed; the panel is still the place for it.
- Long threads are capped in the legend (first messages, then an ellipsis); the full text
  stays in remo.

## ADR-115: VPS releases use Compose, immutable source revisions and explicit rollback

**Status:** accepted (2026-10-29)

**Context.** The first VPS installation shares ports 80/443 with existing projects served
by Caddy. Running Vite, the guide development server and a host Node process makes
updates depend on terminal sessions and the machine's package installation.

**Decision.** Production uses one Compose project with Postgres, one sync process and
nginx serving the built app and guide. The existing Caddy terminates TLS and routes the
two domains to the web container through its external Docker network. Database and sync
ports are never published. Development keeps the existing commands; the previous host
systemd/nginx recipe is historical and must not run alongside Compose in production.

A release is a full Git commit, uploaded with `git archive` (no local environment, ignored
files or credentials), built into two revision-tagged images. Updates build first, stop
writers, take and validate a database dump, and then replace the app containers. Health
checks gate success. The previous release and dump remain available on failure. Rollback
is explicit: a compatible schema may use the previous images; incompatible schema/data
changes require a separately approved restore, never an automatic destructive restore.
Secrets live in `/srv/remo/shared/production.env` with mode 600; the KEK must be copied
off the machine separately. Volumes and backups survive application updates.

**Consequences.** First installation needs one Caddy change. Later updates use one local
release command and server operations use one `remo` script. There is a short socket
interruption during replacement. Same-host dumps protect against a bad update, not loss
of the VPS; off-machine backup remains an operator responsibility. Build and release
scripts refuse tracked uncommitted changes rather than deploying a partial security fix.

## ADR-116: The test VPS shares one independently managed PostgreSQL instance

**Status:** accepted (2026-10-29)

**Context.** The VPS already runs four PostgreSQL instances on 4 GB RAM. The owner approved
reusing an existing PostgreSQL 16 instance for remo instead of creating a fifth. The
Narratio database currently belongs to the application's Compose lifecycle.

**Decision.** Amend ADR-115: remo production Compose contains sync, web and an on-demand
Postgres client for backup/readiness, but no database server. The existing Narratio
PostgreSQL 16 data volume is retained and its server is managed by an independent
infrastructure Compose project. Existing database names, credentials, network alias and
loopback port are retained for Narratio. Remo gets its own database and non-superuser
login, with no create-role/create-database privilege, and a private external Docker
network. App releases never stop, recreate or upgrade the shared database server.

Database dumps and the KEK remain separately backed up; the app backup command uses the
remo role and dumps only remo. The other apps' existing superuser roles remain a known
trust boundary on this shared test host; changing their privileges needs a separate
compatibility review. A maintenance restart of shared PostgreSQL affects both apps.

**Consequences.** The first setup includes an independently recoverable transfer of the
existing DB container lifecycle after a logical backup. No existing database or volume is
deleted. Later remo updates affect only remo services. Local development retains its
standalone database Compose. Replacing a shared server's image is an infrastructure
maintenance action, not an application release.

## ADR-117: Voting happens on the board and shares the board's clock

**Status:** accepted (2026-10-29)

**Context.** ADR-074 put the tally in a panel: a list of objects with a small `+`/`−`
next to each row. In a real session the facilitator selected the timer object, started a
session, and got one row reading "timer без текста" with two glyph buttons; nobody could
tell where voting was supposed to happen. Worse, two clocks were running at once: the
board timer showed "Время вышло" while the vote session still had seconds left and
accepted a vote. The panel polled every three seconds for a change that is not a document
edit, so the tally looked frozen until some other repaint happened.

**Decision.**

- **The board is the voting surface.** Every object in the session's scope carries a
  counter chip anchored to its top-right corner: the total, `+` to cast, `−` to withdraw.
  A bar above the board shows the remaining quota and the clock, and opens the panel. The
  panel keeps the full scope, the facilitator controls and the results.
- **One clock.** When the shared timer is running, a new session is pinned to it: the
  client sends `endsAt` and the server stores that deadline, so votes stop exactly when
  the timer stops. Without a timer the session keeps its own duration. Starting the timer
  after the session does not re-pin it — that is stated, not implied.
- **A deadline is derived, not written.** `state` is computed from `ends_at`: an open
  session whose deadline has passed reads as `ended`, casting and withdrawing are refused
  with `VOTE_SESSION_CLOSED`, extending is refused, and publishing is allowed. No writer
  is needed for "the time is up", matching the timer rule in ADR-075.
- **A nudge, not a poll.** The server broadcasts an empty frame (type 12) to the board's
  room after a start, cast, withdraw, extend, end or publish; clients reload the session.
  A four-second poll and a reload on window focus remain as the fallback for a missed
  frame. One hook (`useVoteSessions`) owns that state for the board layer and the panel.
- **Names come from the object.** A row labels an object by title, then text, then its type
  and the tail of its id — never "timer without text".

**Consequences.**

- Voting is discoverable without opening a dialog, and the count moves in place.
- The board and the panel cannot disagree about a session or a clock.
- One more socket frame type (12) and one more field in the create request.
- A session that expired can be published but not extended; a facilitator who needs more
  time starts a new session rather than reviving a closed tally.

## ADR-118: Every question is the product's own dialog

**Status:** accepted (2026-10-29)

**Context.** Four flows still asked the browser: deleting a tag, replacing the whole
board, deleting a comment, and showing the invitation link when the clipboard was
refused. `window.confirm` blocks the page, cannot use the design tokens or the i18n
table, and in some embedded browsers is suppressed — the destructive action then proceeds
without a question. `window.prompt` in the clipboard fallback put an untranslated,
unstyleable field in front of a link the person needed to read.

**Decision.**

- One component, `apps/web/src/ConfirmDialog.tsx`, owns every "are you sure": a title that
  states the action, one sentence of consequence, cancel first with focus, and a
  destructive primary button.
- The clipboard fallback is a normal dialog (`ShareLinkDialog.tsx`) with the link in a
  read-only, preselected field and a second attempt to copy.
- A destructive dialog never invents a second deletion mechanism: it calls the same
  function the button did.
- `spec/forms.md` is the registry of every form and dialog with its entry point, file and
  test. A new form is added to it in the same commit.

**Consequences.** No code path calls `window.confirm`, `window.prompt` or `window.alert`.
Dialogs are translatable, keyboard reachable and part of the design system. The registry
makes "where do I change this screen" a lookup instead of a search.

## ADR-119: Objects are created from one tool rail; the top bar describes the board

**Status:** accepted (2026-10-29)

**Context.** Creation lives in `BoardTopbar.tsx` next to the board title and undo: a
text button "+ sticker" and three glyph buttons (▭ ○ ◇) drawn on different grids. The top
bar mixes "which board is this" with "add something", and the shape glyphs do not belong
to the `@remo/ui` icon set. There are no single-key tool shortcuts. Mockups and the full
brief: `spec/ui-redesign.md` §2, §4.1.

**Decision.**

- A vertical tool rail on the left (`toolbar-width` 48) is the only place that creates
  objects: select, sticky note, text, shape, connector, frame, card, comment; undo and
  redo sit in a separate group under it. A pen (freehand) needs its own object and painter,
  so it joins the rail when that ADR exists — not before.
- Rail icons come from `Icon` only; missing ones are drawn on the same 24/1.75 grid and
  added to `ICONS`.
- A tool with variants opens a flyout that shows samples of the object (note colours,
  shape silhouettes), its name and its key.
- The top bar keeps only board identity and session state: path, title menu, role
  source, `SyncStatus`, theme, facilitation menu, presence, Share.
- Keys: V select, N note, T text, R rectangle, O ellipse, L connector, F frame, C card,
  P pen, ⇧N note stack. They never fire inside an input or the inline editor.

**Consequences.** One creation mechanism, one icon language. Clicking a tool with variants
opens its flyout; clicking a direct tool, or pressing its key, creates at once and the rail
returns to Select. E2E tests that click creation buttons in the top bar move to the rail's
roles and labels. The keyboard map in `spec/design-system.md` gains the tool keys.

## ADR-120: One object toolbar layout; every colour names its role; built-in style presets

**Status:** accepted (2026-10-29)

**Context.** The note bar shows two unlabeled colour circles; whether a circle paints the
fill, the border or the text is found by trial. Shapes have three colour roles in the
model (`fillColor`, `strokeColor`, `textColor`), connectors one, notes one. The bars for
notes, connectors and a multi-selection each order their controls differently.

**Decision.**

- Every object toolbar reads left to right: type │ style │ text │ actions (link,
  comment, lock) │ More. Delete lives only in More, after a separator, with the object
  count. Converting one object type into another has no model operation yet, so the type is
  a label, not a "▾" menu; conversion returns with its own ADR.
- Every colour control carries its role in words: "Fill", "Border"/"Line", "Text". Text
  offers "Auto — from fill" first, which is the absence of `textColor` (ADR-038).
- Style presets are built in, not user-defined: a fixed set of fill+border+text bundles
  for shapes and colour+width+dash bundles for lines. A preset chip is drawn as the object
  it produces. "Customize" opens the roles one by one. A note has one colour role, so its
  chips are the note colour and it has no "Customize".
- A multi-selection names its content ("4 objects · 3 notes, 1 shape"), offers only roles
  shared by all, and shows "≠" for mixed values.

**Presets accepted (2026-10-29).** Six shape bundles and five line bundles, data in
`packages/model/src/stylePresets.ts`, names in i18n (`preset.shape.*`, `preset.line.*`):

| Shapes | Fill | Border |
|---|---|---|
| Plain | white `#ffffff` | grey `#595959`, 2 px |
| Outline | none (`transparent`) | dark `#1a1a1a`, 2 px |
| Sunny | yellow `#ffdc4a` | none |
| Warm | peach `#f8d3af` | terracotta `#9b4a08`, 2 px |
| Cool | light blue `#c6dcff` | blue `#305bab`, 2 px |
| Accent | turquoise (nearest content colour `#2dc75c`) | none |

| Lines | Colour | Width | Dash | Arrow |
|---|---|---|---|---|
| Plain | dark `#1a1a1a` | 2 | solid | end |
| Dashed relation | grey `#595959` | 1 | dashed | end |
| Accent | turquoise `#2dc75c` | 4 | solid | end |
| Warning | terracotta `#9b4a08` | 2 | solid | end |
| Dependency | blue `#305bab` | 2 | dotted | end |

Shape presets never set `textColor`: the ink stays automatic (ADR-038). Colours are content
colours — a theme switch does not repaint them.

**Consequences.** No colour without a label. Presets write the same `WidgetStyle` fields
as manual edits — no new field, no migration. User-defined presets at team or
organisation level are out of scope until a separate ADR.

## ADR-121: The "/" command line finds; it does not create a second way to add objects

**Status:** accepted (2026-10-29)

**Context.** Templates, timer, voting, follow mode, apps, AI tasks and export are spread
over the top bar and menus. A command line would gather them, but if it also inserted
notes and shapes it would be a second creation mechanism next to the rail (AGENTS.md §2.1).

**Decision.**

- A field in the top bar, opened with "/" or a click, searches and launches what the rail
  does not hold: templates, facilitation, apps, AI task, export.
- A query that matches a rail tool does not create the object: it highlights the rail
  button and shows its key.

**Consequences.** One creation path stays; the command line teaches the keys. Results
come from the same command registry and i18n strings as the menus they open.

## ADR-122: Restore is its own dialog and backs up the board before replacing it

**Status:** accepted (2026-10-29). Amends ADR-085.

**Context.** Importing a backup replaces the whole board for everyone, yet it sits inside
the export dialog, whose other choices only download a file. The replaced board is gone
unless someone made a backup by hand.

**Decision.**

- "Restore from backup" is a separate entry in the board menu and a separate dialog:
  choose file → checks (format, version, checksum) → consequence in numbers ("212 now →
  206 after") → destructive button with the count.
- Before replacing, the product writes a backup of the current board: the same open JSON
  the export dialog produces, offered as a download before the destructive action. No new
  server table and no retention policy exist for it.
- Export keeps PNG, PDF and a separate "Backup whole board (JSON)" action.

**Consequences.** Downloading and destroying are no longer one dialog. The backup is the
person's file, not a hidden server copy, so its fate is theirs.

## ADR-123: Board settings are a side panel that previews the draft

**Status:** accepted (2026-10-29)

**Context.** `SettingsPanel.tsx` keeps a local draft and applies it on Save, inside a modal
that hides the canvas. Settings are expressed as raw units and ratios ("grid cell, units",
"gap, fraction of a note"), so the effect is visible only after saving.

**Decision.**

- Settings open as a side panel; the canvas stays visible and renders the draft locally
  as a preview. "Save" writes the person's own preference; Cancel discards.
- Settings stay per-browser (ADR-032): the grid, snapping and fonts are how one person
  reads the board. Nothing is synced to the team, so the button never says "for everyone".
- Choices are shown as their effect: grid style as preview cards, cell size as four steps,
  snap distance as a slider with the pixel value, gaps as "Tight / Medium / Loose".
  Curve parameters and JSON stay available, collapsed.

**Consequences.** The draft never leaves the browser; other participants keep their own
settings. Preview is honest only where a field affects what is painted: grid, snapping,
guides and font caps. Gaps and connector defaults apply to newly created objects, so those
fields preview by description, not on existing content. Every setting keeps a control.

## ADR-124: UI primitives come from @remo/ui; the app owns layout and domain

**Status:** accepted (2026-10-29)

**Context.** `@remo/ui` ships 53 components — buttons, dialogs, fields, menus, toolbars,
tables, canvas parts — and the app uses two of them (`Icon` and `readCanvasTokens`). Every
screen rebuilt its own `.dialog-backdrop`, `.share-head`, `.auth-actions`, `.primary-button`,
colour picker and popover. That is a second mechanism for every primitive: 17 dialogs with
their own scaffolding, 115 hand-written button usages, 78 raw inputs, 4 984 lines of app CSS
against 387 in the design system. The redesign (S2 panels, S3 forms) would rewrite those
same screens again, so the duplication is about to be paid for twice.

**Decision.**

- Controls come from `@remo/ui`: `Button`, `IconButton`, `Dialog`, `ConfirmDialog`,
  `Menu`, `Popover`, `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Switch`,
  `Tooltip`, `Kbd`, `Badge`, `Avatar`, `Tabs`, `Table`, `EmptyState`, `Toast`, `Banner`.
  The app owns layout, positioning, canvas painting and domain state, not control markup.
- The design system grows where the product needs a missing primitive (`Segmented`,
  `ChoiceCard`, a colour field with a named role). A new primitive lands with states in
  `/__ds` and a render test; a screen never grows its own copy "for now".
- Migration follows the redesign stages, not a big-bang rewrite: S2 rebuilds the object
  panels, S3 the nine forms, S4 the “/” palette. A screen that is not being redesigned
  keeps its markup until its stage; the rule forbids *new* duplicates.
- App CSS keeps layout, canvas and one-off surfaces; control styling lives in tokens and
  the design system. Splitting `styles.css` by surface is allowed when a stage touches it.

**Consequences.** Fewer places to change one control; keyboard, focus and labels are fixed
once. Existing screens may look slightly different as they move to DS primitives — that is
the redesign, reviewed per stage with baselines and e2e. The app can no longer ship a
private button "just for this dialog". The list of decisions this migration cannot make on
its own lives in `spec/ui-redesign.md` §9.

## ADR-125: Confirmations come from @remo/ui (amends ADR-118)

**Status:** accepted (2026-10-29). Amends ADR-118.

**Context.** ADR-118 made `apps/web/src/ConfirmDialog.tsx` the owner of every question.
The design system already ships `ConfirmDialog` (focus trap, Esc, primary-button rule,
count on the button) on top of its `Dialog`. Two confirmation dialogs are a second
mechanism for the same job (AGENTS.md §2.1), and the app's copy would be rewritten in S3
anyway.

**Decision.** `@remo/ui` `ConfirmDialog` is the only confirmation. The app keeps the state
that opens it and passes the title, one sentence of consequence as children, the button
label and an optional object count; cancel and Esc come from the design system. The file
`apps/web/src/ConfirmDialog.tsx` is deleted. `spec/forms.md` §6 names the DS component.

**Consequences.** One component, one focus behaviour, one wording rule. A destructive
confirmation cannot drift from the design system. ADR-118's wording about the owner file is
superseded by this record, while its rule ("never a browser dialog") stands.

## ADR-126: An open vote shows who voted in the results panel (amends ADR-088, ADR-117)

**Status:** accepted (2026-10-29)

**Context.** ADR-074/088 made anonymity a session property, fixed at creation, and stated
that the tally is always an aggregate: no API response contains a subject id. With that rule
an "open" session and an "anonymous" one look identical to everyone; the only difference
is a word in the header. The owner decided (spec/ui-redesign.md §9 № 28) that an open
session must show who voted. Mockup: canvas artboard `Vote-Open`.

**Decision.**

- **Anonymous sessions do not change.** The aggregate rule of ADR-088 stays absolute for
  them: no response, export or audit view joins votes to people.
- **Open sessions expose voters in results only.** The results response of a session with
  `anonymous_votes = false` adds, per object, the list of voters as account display name,
  avatar and the number of votes they gave. Link visitors are counted, never named
  ("Гости по ссылке · 2"), as ADR-088 forbids inventing a name.
- **Who sees it:** anyone who can open the board's results panel. The published result
  object on the board carries no names: a board travels further (export, share link,
  copies) than its results panel.
- **Consent before the first vote.** While an open session runs, the status bar says so in
  words ("Голосование открытое: участники доски увидят, за что вы голосовали"), and the
  start form describes both modes by their consequence. The mode is fixed at start.
- **Two views in the results.** Per object: who gave it votes (name, avatar, count).
  Summary: one row per person with the total they spread across the session. Both are
  built from the same ended-session response; guests are one counted row in both.
- **Live tally stays aggregate** in both modes; names appear only once the session ends,
  so a running count cannot be used to pressure individual voters.

**Consequences.** "Open" and "anonymous" differ in what people can actually see. The
results endpoint gains a mode-dependent field — per-object voters and a per-person
summary — and tests proving both are absent during the session and for anonymous
sessions. ADR-088's sentence "no API response contains a subject id" now reads
"…for an anonymous session"; for an open one, ended results name account voters.

## ADR-127: One swatch per object, one colour window, one tonal palette (amends ADR-120)

**Status:** accepted (2026-10-29)

**Context.** ADR-120 put style presets as chips on the object toolbar and "Customize" for
the roles. Built, the note toolbar carried a label, seven chips and a "Customize" button
(≈ 760 px), "Customize" opened a 22-colour grid in no tonal order, and the text colour opened
a second popover on top of it with the same 22 colours. The owner chose the FigJam/Figma
pattern (spec/ui-redesign.md §9 № 34). Mockups: canvas artboards `Color-Sticker`,
`Color-Shape`, `Color-Others`.

**Decision.**

- **One swatch per object on the toolbar**, drawn as what it paints: the note sheet for a
  note, "Aa" in fill+border+text for a shape, a line segment for a connector, "A" with a
  colour bar for text; a multi-selection shows the shared role's name and swatch, "≠" when
  values differ. ADR-120's preset chips and "Customize" leave the toolbar.
- **One window per swatch, never a second level.** Inside, roles are labelled in words and
  stacked: presets first (shapes, connectors), then Fill, Border/Line with width and dash,
  Text.
- **One tonal palette:** seven hues in fixed columns (grey, yellow, orange, pink, violet,
  blue, green) × three levels — 100 and 300 for fills, 600 for lines, borders and text. It
  becomes a token group `content-*` in `@remo/ui`; `sticker-*` are its 100 row. Text on a
  filled object offers "Auto / Dark / White" (Auto = no `textColor`, ADR-038); free text
  offers the 600 row.
- **The 22 `BOARD_COLORS` are no longer offered.** Objects that already use one keep their
  hex and show it as "Current: custom colour" until changed. No migration.
- Keys 1–7 set the main colour of the selection without opening the window.

**Consequences.** Every object toolbar fits ≈ 300–380 px. Colour choice looks and works the
same for every type. Presets (ADR-120 list, journal № 3) are unchanged in content, only in
place. `ColorPicker` stays deleted; the window is one DS component used by every swatch.

## ADR-128: The stored board name survives an empty document title; one teardown per room

**Status:** accepted (2026-10-30)

**Context.** A board created through the API (`POST /orgs/{id}/boards`) has a name in
`boards.title` and nothing in its document yet. The projection wrote the document's
`meta.title` back into the row on every pass, so the first refresh after opening such a
board replaced the name with `''`. The client's seed guard reads the server name
("a named board is never seeded", ADR seed-once): with the name gone, the next reload
looked like a legacy room and could seed the default template over the arriving
document, and "Create a copy" produced "Untitled (copy)".
Separately, a reload closes the last socket of the old room (y-websocket calls
`writeState` and does not await it) and immediately binds a replacement. Both the
closing socket and the bind could start a teardown of the same room; a late teardown
compacted the old document after the new room had logged updates, and its watermark
then deleted them. The reload also read `boards.snapshot` and `board_updates` in two
statements, which a concurrent compaction could split.

**Decision.**

- **An empty document title never clears the stored name.** The projection writes
  `coalesce(nullif(docTitle, ''), boards.title)` in both the full and the diff pass.
  A non-empty document title always wins, so a rename still reaches the row and the
  directory. Renaming to an empty string is not a way to clear a board's name.
- **The snapshot and log are read in one statement** (`boards` left join
  `board_updates` after `snapshot_through`), so a compaction that commits during a load
  can never produce a half state.
- **A room has at most one teardown.** `writeState` stores its promise on the room and
  returns it to a second caller; the room is removed from the map only by the teardown
  that owns it. No timers or delays are involved.

**Consequences.** A named board keeps its name through every projection, so a reload
takes the "never seed a named board" path instead of the legacy one. Copy and backup
read the same name. The loader can see a few hundred log rows in one result set (the
log is compacted after 200 updates), which is what the previous two queries returned
anyway.

## ADR-129: Presets and defaults live on the tonal palette (amends ADR-120, ADR-127)

**Status:** accepted (2026-10-30). Amends ADR-120 (preset content) and ADR-127 (defaults,
keys 1–7, window placement).

**Context.** ADR-120 fixed the presets before the tonal palette of ADR-127 existed, so the
values came from the old `BOARD_COLORS` set: `#595959`, `#ffdc4a`, `#f8d3af`, `#9b4a08`,
`#c6dcff`, `#305bab`, `#2dc75c`. In the colour window every one of them is outside the
twenty-one, so the window honestly says "Custom colour" — including for the preset the person
just pressed (spec/ui-redesign.md §9 № 50). A new shape also wrote a border the "Plain" chip
did not highlight, and a new line took `#333333`, a value no swatch offers. A default that no
swatch can ring teaches the wrong thing on the first object a person makes.

**Decision.**

- **Shape presets are tonal** — one fill level and one border level per bundle:

| Shapes | Fill | Border | Width |
|---|---|---|---|
| Plain | `#ffffff` white | `#58534e` grey 600 | 2 |
| Outline | `transparent` | `#58534e` grey 600 | 2 |
| Sunny | `#f2b94a` yellow 300 | `transparent` | 0 |
| Warm | `#ffcd9e` orange 100 | `#c93e0a` orange 600 | 2 |
| Cool | `#b5dcff` blue 100 | `#1a6ad8` blue 600 | 2 |
| Accent | `#85d965` green 300 | `transparent` | 0 |

- **Line presets are tonal**:

| Lines | Colour | Width | Dash | Arrow |
|---|---|---|---|---|
| Plain | `#58534e` grey 600 | 2 | solid | end |
| Dashed relation | `#bfb9b1` grey 300 | 1 | dashed | end |
| Accent | `#2b7f17` green 600 | 4 | solid | end |
| Warning | `#c93e0a` orange 600 | 2 | solid | end |
| Dependency | `#1a6ad8` blue 600 | 2 | dotted | end |

  Both tables are data in `packages/model/src/stylePresets.ts`, resolved from
  `colorLevels.ts` so the preset and the swatch cannot drift apart. `#ffffff` is not one of
  the twenty-one (it is a named chip beside "Fill", ADR-127), so a plain fill is the one
  value a preset takes from outside the grid — it is the sheet a note already uses.
  Text stays automatic in every shape (`textColor` is never set, ADR-038).
- **A new object starts on the palette**, so its sample rings a swatch on the first open:
  a shape takes the Plain preset; a new line takes the line Plain preset (grey 600, 2,
  solid, arrow end); a new text object writes `color: #58534e` instead of relying on the
  near-black fallback.
- **Untouched browser defaults migrate on read, deliberate ones do not.** `settings.ts`
  reads a stored shape style of (`#1a1a1a`, 1) or (`#595959`, 2) — the two defaults the
  product shipped — as Plain (`#58534e`, 2), and a stored connector of (`#333333`, 1) as the
  line Plain (`#58534e`, 2). Any other stored value is the person's, and is kept.
  Document content is never migrated: an old object keeps its hex and the window says
  "Custom colour" (ADR-127).
- **Keys 1–7 on a selection with two fill rows take 100.** When every selected fill is on
  the same row (100 or 300) the key keeps that row; when they disagree the key paints 100,
  so one press cannot move half the selection to the pale row and half to the deep one.
  Lines and text stay on 600, as before.
- **Panel windows are clamped by one shared mechanism.** Every window of a floating object
  bar (note, shape, text, line, multi-selection, "More", alignment) measures itself and
  shifts into the viewport: the left reserve is the rail's `--toolbar-width` plus its 12 px
  offset, the right reserve is the inspector's measured width and only while it is
  painted, and the window never leaves the top or bottom edge. When the window is taller
  than the space it scrolls inside instead of being cut. Reserves are read from the
  document and the DOM, never guessed: no constant stands for the inspector's width.

**Consequences.** Every preset a person presses rings the swatch it produced — the window no
longer answers "Custom colour" for a built-in look. Presets still write the same
`WidgetStyle` fields as a manual edit: no new field, no document migration. A board created
before this record keeps its colours; only the browser's untouched defaults move. Window
placement is one hook and one test instead of a per-panel offset, so a wider inspector, a
narrower viewport or a seventh row in a window cannot push a window under the rail or off
the edge.

## ADR-130: One browser-gate run owns its ports, its database and its reports

**Status:** accepted (2026-10-30). Amends ADR-090 (the gate owns a disposable stack).

**Context.** ADR-090 fixed the browser gate to three ports (1235, 1237, 5175), one
database (`remo_e2e`) and one worker, because the scenarios share a board and a store and a
parallel run would turn a product bug into a race in the harness. That was right for the
gate's own correctness, and it made the gate unaddressable: measured on 30.10.2026 it takes
176 s of the 199 s full gate, and a second run — a second worktree, a second agent, a
reviewer checking a branch — cannot start while the first one holds the ports, the database
and the report directories. `scripts/e2e-db.mjs` also dropped its database by name with
`with (force)`, so a second run would have destroyed the first run's database mid-flight
rather than failing to start.

**Decision.**

- **One run owns a port base.** `E2E_PORT_BASE` shifts all three ports
  (`1235 + base`, `1237 + base`, `5175 + base`); `E2E_SYNC_PORT`, `E2E_PROXY_PORT` and
  `E2E_WEB_PORT` override one port at a time. With no variables set the ports are exactly
  the ADR-090 values, so CI and a plain `pnpm e2e` are unchanged.
- **The database name follows the run suffix.** A base of 0 keeps `remo_e2e`; a base of
  1000 uses `remo_e2e_1000`; `E2E_RUN_SUFFIX` names the suffix explicitly and
  `REMO_E2E_DATABASE_URL` still wins outright. The suffix is lowercased and reduced to
  `[a-z0-9_]`, because it becomes part of an identifier.
- **The recreator refuses foreign names.** `scripts/e2e-db.mjs` exits before connecting when
  the name is not `remo_e2e` or `remo_e2e_<suffix>`. Dropping a database is the one
  destructive statement in the gate, so it is guarded by the name, not by a comment.
- **Reports are per run too.** `E2E_OUTPUT_DIR` and `E2E_REPORT_DIR` move
  `test-results/` and `e2e-report/`; the defaults are unchanged. Two runs that wrote the
  same HTML report would overwrite each other's evidence.
- **Parallelism is file-level and opt-in.** `E2E_WORKERS` sets the worker count, default 1.
  `fullyParallel` stays false: scenarios inside one file keep running in order. Two workers
  share one sync service, which is safe because every scenario registers its own account and
  board (`e2e/helpers.ts`), but the default stays 1 until a flake rate has been measured.
- **A spec never hardcodes a port.** `e2e/ports.ts` is the single source; `save-offline.spec.ts`
  imported `1237` and now imports `PROXY_PORT` like the config does.

**Consequences.** The default run is byte-for-byte the same stack as before, so the CI gate
and `deploy/release.sh` need no change. A second run is one environment variable away, which
is what makes parallel worktrees possible. The gate keeps one shared database per run, so a
scenario that relied on another scenario's leftover rows would now fail when two runs use
different databases — that is the intended direction, not a regression. Enabling more than
one worker is a measurement to make, not a default to assume: the frame-budget scenario in
`perf.spec.ts` and the PNG comparisons in `visual.spec.ts` both depend on a quiet machine.

**Amendment (measured, 2026-10-30).** Four runs on a 10-core Mac, warm cache, the same
machine and the same database server:

| Run | Wall time | Result |
|---|---|---|
| `pnpm e2e`, before this record | 176.2 s | 67 passed |
| `pnpm e2e`, after this record | 179.1 s | 67 passed |
| two runs at once — default and `E2E_PORT_BASE=1000` | 178.2 s and 174.4 s | both 67 passed |
| `E2E_WORKERS=2 pnpm e2e` | 91.3 s / 87.7 s / 94.0 s (three runs) | 67 passed each |

Two concurrent runs finish in the wall time of one, so the gate no longer serialises
worktrees. The default worker count stays 1: the frame-budget scenario and the PNG
comparisons depend on a quiet machine, and one fast run is not a flake rate. The opt-in
number is recorded so the next decision has a baseline.

**Amendment (review correction, 2026-10-30).** Independent review found that the guard was a
name test — the same assumption the unit-test lifecycle was already rejecting — and that the
default artifact directories were still shared with a shifted run. The corrected contract:

- **Every managed database is run-scoped.** `E2E_RUN_ID` (generated once by
  `scripts/e2e-run.mjs`) is part of the name: `remo_test_e2e_<run>` or
  `remo_test_e2e_<suffix>_<run>`. Two runs cannot derive the same database unless the random
  run id collides. The old stable `remo_e2e` name is no longer created.
- **Name plus ownership marker.** `scripts/db-lifecycle.mjs` is the only create/drop path.
  Creation writes `COMMENT ON DATABASE … IS 'remo-owner:<environment-instance>:<run>'`; a
  reset or teardown drops only when that marker names this exact environment instance and
  run. An existing database with no marker or a foreign marker is preserved and the script
  fails closed. A name alone never authorises a delete.
- **No forced drop.** Both lifecycles use a plain `drop database`; a connected session makes
  it fail rather than forcing a database somebody may still be using.
- **Cleanup is part of the command.** `pnpm e2e` runs `scripts/e2e-run.mjs`, which passes the
  run id to Playwright and invokes `scripts/e2e-db.mjs --teardown` after the web servers
  stop. Cleanup runs after a failed scenario too; there is no browser-specific database URL
  that could opt out of identity checks (ADR-136).
- **Artifacts are run-scoped siblings.** Default and shifted runs write
  `test-results/<label>_<run>` and `e2e-report/<label>_<run>` (`label` is `default` or the
  suffix). No run's output directory is an ancestor of another run's, so Playwright cleaning
  one run cannot delete another's traces. `E2E_OUTPUT_DIR` and `E2E_REPORT_DIR` still win,
  but must be separate and non-nested or the run refuses to start; cross-run disjointness is
  the caller's responsibility once overridden.
- **A suffix that would need normalising is refused.** `E2E_RUN_SUFFIX` must already be an
  exact lowercase identifier, so `1000-a` and `1000_a` cannot collapse onto one name.

## ADR-131: Database suites run against a throwaway database, and a skip is never silent

**Status:** accepted (2026-10-30). Amends ADR-089 (the gate must not hide a missing store).

**Context.** Eight of the thirty-eight sync suites connect to whatever `DATABASE_URL`
resolves to — the developer's own `remo` database — and create accounts, boards, invitations,
votes and audit rows there on every run. Measured on 30.10.2026 that database held 16,808
boards, of which 16,653 (99.1%) matched the test prefixes `scripts/db-prune.mjs` knows, plus
7,403 invitations and 6,900 audit rows: 147 MB of a 147 MB database was test residue. The
same suites degrade to `describe.skip` when no database answers, and `pnpm test` then exits 0
— ADR-089 made the *gate* refuse to start without a database, but the command a person types
while working still reported success with its database coverage removed.

**Decision.**

- **One throwaway database per run.** `remo_test_<run>` is created before the workers start,
  migrated once through `PostgresStore.connect()` — the same path the service uses, so the
  gate keeps testing the real `schema.sql` — and dropped in the teardown. No suite touches
  `remo` any more.
- **The run token comes from the command, not from a process.** `pnpm test` runs
  `REMO_TEST_RUN=$$ vitest run`; every process in the run reads the same token from its own
  environment, so no value has to be passed between the setup and the workers. Two runs get
  two databases, for the same reason the browser gate does (ADR-130). An unset token falls
  back to `local`, which is one run at a time by definition.
- **A database whose run is gone is swept.** The token is the pid of the shell that started
  the run; a `remo_test_*` database whose pid no longer exists is dropped at the next start.
  A crashed run therefore leaves nothing behind, and a live parallel run is never touched.
- **A skip is loud, and fatal under CI.** Without a reachable database the setup prints how
  many suites are skipped and how to fix it, and exits 0 — the inner loop still works on a
  laptop without Docker. With `CI` set it throws, because a gate that quietly drops its
  database coverage is worse than a red gate.
- **One test command, not two.** `pnpm test` keeps running everything. Splitting it into
  "unit" and "database" would recreate the exact failure this record closes: the fast command
  goes green, and the database command is the one nobody runs. `pnpm test:watch` is the only
  addition.
- **`REMO_TEST_DATABASE_URL` opts out.** For a server where the role may not create
  databases, the suites use that database and nothing is created or dropped. The value is the
  person's responsibility to clean.

**Consequences.** `pnpm test` leaves the developer's database byte-identical: measured
16,809 boards and 27,418 users before and after a full run. The suite also got faster — 9.49 s
against the 147 MB database, 7.27 s against a fresh one — because the fixtures stop competing
with accumulated rows. Two runs can execute at once. The price is a `CREATEDB` grant for the
`remo` role (already true in the Docker image and the CI service) and one more database to
explain in `TESTING.md`. `scripts/db-prune.mjs` stays: it removes the 16,653 legacy rows that
this record does not delete, and it is still the tool for a database that predates it.

**Amendment (review correction, 2026-10-30).** Independent review found that the sweep
treated a local pid as proof of ownership — meaningless on a database server shared by
several machines — and that a startup probe could still leave suites silently skipped. The
corrected contract, shared with the browser gate through `scripts/db-lifecycle.mjs`:

- **A collision-resistant run token.** `pnpm test` sets `REMO_TEST_RUN=$$_<8 random hex>`.
  The shell pid alone was reusable, and the old sanitiser could map two different raw values
  onto one name; the token is now an exact `[a-z0-9]`-with-single-underscores identifier and
  anything that would need rewriting is refused.
- **Ownership is a marker, not a pid.** Creating the database writes
  `COMMENT ON DATABASE … IS 'remo-owner:<environment-instance>:<run>'`. Reset and teardown
  drop only while that marker still names this environment instance and run. A missing or
  foreign marker means unknown ownership and the database is left alone.
- **No destructive cleanup of unknown databases.** The automatic sweep is gone. A crashed
  run's database has no live process to prove anything, so it is not another run's to
  delete; it remains until a person removes it. An existing database with this run's name is
  reset only when it already carries this run's marker.
- **No forced drop.** Teardown uses plain `drop database`; if a session is still connected
  it fails and says so.
- **The suite owns enforcement, not the startup probe.** Every database suite opens its
  store through `testDatabaseStore()`. A missing URL, a connection failure or a migration
  failure fails the suite under `CI`; the same failure locally prints how many suites are
  skipped and exits 0. A successful global-setup probe cannot turn a later suite failure
  green.
- **One test-only connection contract, verified before mutation.** `REMO_TEST_POSTGRES_URL`
  selects the dedicated test server (ADR-136); `DATABASE_URL`, `.env` and the removed
  `REMO_TEST_DATABASE_URL` override are not fallbacks. The installed identity is verified
  before any create/drop, and an unreachable server is a local skip while `CI` fails.
- **PostgreSQL privileges and concurrency assumptions.** Managed databases require
  `CREATEDB` for the dedicated `remo_test` role (the CI service has the same). The creator
  owns the database and may comment on it. `drop database` requires no other session to be
  connected. Create/reset/drop hold a session advisory lock keyed by database name; the lock
  serialises replacement but is not proof of ownership and is released by a crashed session.
  The marker is read from `pg_shdescription` before connecting to the database itself.

## ADR-132: The numbers in the documents are generated, not typed

**Status:** accepted (2026-10-30). Amends the "current numbers live only in HANDOFF" rule by
enforcing it.

**Context.** The engineering audit of 30.10.2026 found ten hand-typed facts across four
documents, and every one of them was wrong: `AGENTS.md` claimed 114 ADRs (129), 636 tests
(804), `SCHEMA_VERSION` 8 (9), contrast 152/152 (154), "e2e about 30 s" (176 s); `TESTING.md`
claimed 40 scenarios (67) and 9 baselines (19); `spec/INDEX.md` claimed ADRs 110–125 (129) and
53 claims (47 in the table); `spec/HANDOFF.md` claimed 128 ADRs (129). The rule that should
have prevented this — "current numbers live only in `spec/HANDOFF.md`" — was written in
`AGENTS.md` and enforced by nothing. `AGENTS.md` §8 was a dated duplicate of `HANDOFF.md`, so
it drifted first and was read first.

**Decision.**

- **Two kinds of numbers, treated differently.** A *tree fact* is a property of the repository
  — ADR count, schema version, scenarios, pages, baselines, claims, the largest file. It is
  generated. A *run fact* is a property of one execution — durations, pass counts, coverage.
  The command that measures it prints it, and a document restates one only with a date.
- **One generator, one block, checked in the gate.** `scripts/state-report.mjs` computes the
  tree facts and rewrites the text between `<!-- generated:state:begin -->` and
  `<!-- generated:state:end -->`. `pnpm state:write` updates; `pnpm state:check` — a step in
  `pnpm verify` — fails with the file, the block line, the value found and the value expected.
- **Three documents carry the block**: `AGENTS.md` §8, `spec/HANDOFF.md` §1, `TESTING.md` §0.1.
  `spec/INDEX.md` carries no number at all — it is a map, and a map that repeats state is the
  next thing to drift.
- **`AGENTS.md` §8 stops being a state snapshot.** It was a dated copy of `HANDOFF.md` §1 and
  §5 with its own numbers. It is now the block plus pointers: current state and open work in
  `HANDOFF.md` §1/§4, history in `HANDOFF.md` §5 and `guide/support/changelog.md`, and a
  number-free list of what exists.
- **Counts come from the artefact, not from a pattern.** The scenario count is read from
  `playwright test --list` (which collects without starting a server) rather than by grepping
  `test(`; the claim count is read from the claims table itself, not from the prose that
  describes it.

**Consequences.** A number in these documents can no longer disagree with the tree: adding an
ADR, a scenario, a page or a baseline fails the gate until `pnpm state:write` runs, and the
failure names the exact line. The generator found two drifts nobody had noticed while it was
being written — 19 product baselines, not 14, and 47 REA claims, not 53. The block adds about a
second to `pnpm verify`. The cost is a habit: after a change that moves a count, run
`pnpm state:write`. A number that describes a run — "the gate takes three minutes" — is still
typed by a person, which is why it now carries its date.

## ADR-133: The gate has a supply-chain boundary, and CI publishes what it cost

**Status:** accepted (2026-10-30). Amends ADR-089 (the gate) and ADR-090 (CI runs it).

**Context.** The engineering audit of 30.10.2026 found two things about the pipeline rather
than the product. First, `pnpm-workspace.yaml` set `dangerouslyAllowAllBuilds: true` while its
`allowBuilds` entry still contained pnpm's own placeholder text (`esbuild: set this to true or
false`) — so the allow-list described nothing and any transitive dependency could run arbitrary
code at install time, on every developer machine and in CI. Nothing in the pipeline looked at
dependencies: no `pnpm audit`, no Dependabot, no SAST. Second, the workflow was one job with no
browser cache, no cancellation of superseded pushes, no artefacts when the browser suite failed,
and no published duration — so a red run cost a local reproduction and no run produced a number
anyone could compare against.

**Decision.**

- **One reviewed allow-list for install-time scripts.** `allowBuilds: {esbuild: true}` — pnpm
  11's map form, which replaces `onlyBuiltDependencies` — and `dangerouslyAllowAllBuilds`
  removed. Anything else that wants to run a script now fails as unreviewed instead of running.
  Proven by `pnpm rebuild esbuild` after the change: the postinstall still runs, nothing else
  does.
- **Dependency risk is reported before it is enforced.** `pnpm audit --prod --audit-level high`
  runs with `continue-on-error` and writes into the job summary. It becomes blocking once the
  current findings are triaged; a transitive advisory must not stop delivery on the day the
  check appears. Dependabot opens weekly npm updates (grouped, majors for React ignored because
  the product is pinned to 18) and monthly Action updates.
- **CI pays once per change, not once per push.** `concurrency` with `cancel-in-progress`
  cancels a superseded run of the same branch. Chromium comes from a cache keyed on the
  lockfile and the pinned Playwright version, so a code-only change skips the download and a
  dependency bump invalidates it.
- **A failed browser run leaves evidence.** `e2e-report/` and `test-results/` are uploaded on
  failure with seven-day retention; without them the only way to see why a scenario failed is
  to reproduce it locally.
- **The gate publishes its own duration.** The gate step writes `gate: <n>s` into
  `$GITHUB_STEP_SUMMARY`, so "did this change make CI slower" has an answer without access to
  the run log.
- **No job split.** The audit left the split conditional on measurement, and measurement is
  blocked: there is no CI telemetry and no way to obtain it without pushing. Three parallel jobs
  would each pay `pnpm install` and a browser download, which is a larger fixed cost than the
  193 s gate they would divide. The split stays a candidate for when the summary above has a
  week of numbers.

**Consequences.** Install-time code execution is limited to one reviewed package instead of
everything. A vulnerability now appears in the job summary instead of in a release note read by
a person. A superseded push stops burning minutes, and a red browser run is debuggable from its
artefacts. None of this is measured yet: CI duration, cache hit rate and audit findings are
`null` in the audit baseline until the first runs after this change. The pipeline is still one
job, deliberately, and that decision is now written down rather than implied.

## ADR-134: The product stylesheet is one entry and many files; paint defaults have one home

**Status:** accepted (2026-10-30). Amends ADR-079 (tokens only) and ADR-129 (defaults on the
tonal palette).

**Context.** `apps/web/src/styles.css` was 5,347 lines and the fifth most-changed file in the
repository (53 commits) — and it was the one file the size ratchet could not see, because
`scripts/file-size-check.mjs` matched `.ts`, `.tsx` and `.mjs` only. The audit of 30.10.2026
recorded it as the largest file in the repository (F-06) and noted that the rule "no literal
colours" was enforced by `apps/web/src/styles.test.ts` for that file and for nothing else.
Separately, twenty paint fallbacks (`?? "#ffffff"`, `?? "#1a1a1a"`) were written inline across
ten components, so a colour literal in a component could not be told apart from data.

**Decision.**

- **One entry, twenty files.** `styles.css` keeps its single import for consumers and becomes
  `@import`s into `src/styles/*.css`, cut at the section banners that were already there plus
  four finer cuts in the long tail. The import order **is** the cascade; the concatenation of
  the files in that order is byte-identical to the old file (checked with `diff` on
  non-blank lines before the change landed), and the built CSS keeps the same name, size and
  hash (`index-CsJR7sV5.css`, 118.61 kB).
- **The ratchet sees CSS.** `scripts/file-size-check.mjs` now includes `.css` with the same
  800-line limit and no exception list, and reports files in the last 10% of the budget as
  warnings — six files are there today, all TypeScript.
- **The guard follows the split.** `styles.test.ts` reads every module with
  `import.meta.glob` instead of one path, so a rule that used to cover the file now covers the
  directory; it also asserts that the split exists, so the guard cannot silently become a
  no-op on an empty entry.
- **Paint defaults have one home.** `apps/web/src/objectDefaults.ts` holds `DEFAULT_FILL`,
  `DEFAULT_INK`, `DEFAULT_LINE_STROKE`, `DEFAULT_MUTED_INK` and the two translucent overlay
  surfaces. Ten components import them instead of writing the value. `scripts/ui-rules-check.mjs`
  fails any other colour literal in `apps/web/src`, with four named data modules allowed:
  the defaults file, the presence palette, the legacy-default detection in `settings.ts`, and
  the colour window's data.
- **Two values are kept apart on purpose.** The inline editor's surface is 0.94 white and the
  connector bar's is 0.96; they are named separately rather than unified, because unifying them
  is a visual decision for the owner, not a cleanup. The rule found the inconsistency; the
  record keeps it visible.

**Consequences.** The largest file in the repository is now `apps/sync/agent-runner.mjs` at 793
lines, and the gate noticed that fact by itself on the first run after the split — the generated
state block failed until `pnpm state:write` ran, which is the mechanism working. A new CSS file
is covered by the ratchet and by the colour guard without anyone remembering to add it. The cost
is one indirection when reading styles: the file name now says which surface, and the order of
the imports matters.

## ADR-135: Agent guidance is a contract in the repository, not a habit of one harness

**Status:** accepted (2026-10-30).

**Context.** Everything that made this repository easy for an agent — the code graph, the REA
tool, the browser tool, the subagent roster — lived in the operator's global harness
configuration. The only repository-owned harness file was `.claude/launch.json`, and it declared
port 3000 for a dev server that listens on 5173. `AGENTS.md` was 22 KB of rules and a state
snapshot; it said where the rules were but not what a task touches, and the audit measured the
onboarding set at 178 KB before any code is read.

**Decision.**

- **A contract file, additive by construction.** `docs/agents/README.md` holds what `AGENTS.md`
  does not: measured command durations, a task → files table, the definition of done, the
  parallel-work rule, and the short list of things an agent must not do. It never restates a
  rule — restatement is what drifted (ADR-132).
- **Per-directory guidance states only the difference.** `apps/web/AGENTS.md` and
  `apps/sync/AGENTS.md` describe the shape, the rules that bite in that directory, and how to
  test there. A reader who has read `AGENTS.md` learns nothing twice.
- **The state is printed, not recalled.** `pnpm agent:brief` prints the generated block from
  `spec/HANDOFF.md`, the last six ADR titles and the open-work headings — the same block the
  gate verifies, so a wrong brief is a red gate, not a stale document.
- **The stale harness file is corrected rather than deleted.** `.claude/launch.json` now points
  at 5173, the port `apps/web/vite.config.ts` actually uses.

**Consequences.** A session starts with `pnpm agent:brief` and `docs/agents/README.md` instead of
178 KB of prose, and the same files work in a harness that knows nothing about this machine. The
contract can still rot — nothing generates the task → files table — so it is reviewed when a new
top-level area appears, not on a schedule. That is a deliberate limit: a table that guesses is
worse than a table that is occasionally incomplete.

## ADR-136: Tests run against a separate PostgreSQL environment with an installed identity

**Status:** accepted (2026-10-30). Amends ADR-131 (test databases) and ADR-130 (browser gate).

**Context.** The test lifecycle had become safe about *database names* but not about *which
server* it was talking to. `test-db.mjs` still resolved `DATABASE_URL`, then the repository
`.env`, and fell back to the development credentials; the browser gate default was
`postgres://remo:remo@localhost:5432/…`. A developer with the dev stack running could therefore
point a supported command at the development server by accident, and an explicit
`REMO_TEST_DATABASE_URL` skipped creation and ownership checks entirely. This contradicts the
primary invariant: no test command may create, modify or delete data in the development or
production environment.

**Decision.**

- **A dedicated Compose project.** `docker-compose.test.yml` defines project `remo-test`, one
  container `remo-test-postgres`, one volume `remo-test-postgres-data`, credentials
  `remo_test`/`remo_test`, and a loopback-only port `127.0.0.1:55432`. It references no
  development volume, credential or service, and has no restart policy: startup and shutdown are
  explicit (`pnpm test:db:up` / `pnpm test:db:down`). The development volume is never deleted by
  any test command.
- **One connection contract.** Every test path reads `REMO_TEST_POSTGRES_URL`; its default is the
  dedicated server above. `DATABASE_URL` and the repository `.env` are never consulted by test
  code, verification preflight, the browser gate or CI. The explicit `REMO_TEST_DATABASE_URL`
  and `REMO_E2E_DATABASE_URL` escape hatches are removed: they bypassed identity and ownership.
- **An identity installed once per server volume.** `pnpm test:db:init` creates
  `remo_test_control` and its `test_environment_identity` row: fixed environment `remo-test`,
  fixed namespace `remo_test`, and a random instance UUID. Before any create/drop, every path
  verifies exactly one matching row, and every suite verifies it again through
  `testDatabaseStore()` before constructing a store or running migrations. Host and port are
  never evidence of environment identity. Bootstrap refuses a server that already holds any
  database other than the control/system databases, so pointing it at the development server
  fails instead of writing there.
- **Ownership includes the environment instance.** Markers are
  `remo-owner:remo-test:<instance>:<run>`. A database created by another test server is not ours
  even when the run token matches. Names must stay in `remo_test_`; unknown or unmarked
  databases are preserved.
- **A failed marker write preserves the database.** If `CREATE DATABASE` succeeds but
  `COMMENT ON DATABASE` fails, the run returns an explicit `DatabaseMarkerError` and leaves the
  unmarked database for manual inspection. It never drops a database whose ownership it could
  not record: ownership must be confirmed before any deletion.
- **Coordinated replacement.** Create/reset/drop hold a session advisory lock keyed by database
  name. The lock serialises concurrent replacement; it is not proof of ownership and is released
  by a crashed session. Drops are plain `drop database` — no `WITH (FORCE)` — and there is no
  automatic sweep.
- **Same contract in CI.** The GitHub Actions service uses the same role, control database and
  `REMO_TEST_POSTGRES_URL`; the job runs `pnpm test:db:init` once, then the gate re-verifies
  identity. Connection and migration failures remain fatal through `testDatabaseStore()`.
- **Commands.** `pnpm test:db:up`, `test:db:init`, `test:db:check`, `test:db:down`,
  `test:db:logs`; fast feedback and the full gate stay `pnpm verify:fast` and `pnpm verify`.
  `pnpm test` contains the database suites.

**Consequences.** A supported test command can no longer reach the development server through
configuration defaults, and a mistaken URL fails closed at identity verification. The cost is an
extra explicit server to start, a fixed local test credential, and a bootstrap step in CI. The
server requires `CREATEDB`; drops require no connected session. Run-scoped databases are dropped
after normal completion and after ordinary test failures; a killed process, or a database whose
ownership marker could not be written, remains for manual inspection. Removing the persistent
test volume remains a manual action, documented in `TESTING.md`.

## ADR-137: A port connects to the object in the copy's slot; objects have four ports

**Status:** accepted (2026-11-01). Amends ADR-080 (a port click no longer always grows a note)
and the anchor model of ADR-077 (eight anchors become four).

**Context.** ADR-080 made a port click mean "connect to the nearest connectable object within
160 px, otherwise enter preview". In practice the click grew a connected clone (ADR-035's old
half survived in `onCreateConnected`), and the eight anchors — four side midpoints and four
corners — produced three different offsets per side. Two problems followed. The gesture the
owner expects is "point at the place where the next object would go": if that place is empty,
grow the copy there; if something is already standing there, join the two objects instead of
stacking a second copy on top. And a corner anchor is not a different address for a line: it
is the end of a side, and an elbow leaving a corner reads as a line that missed the object.

**Decision.**

- **A port click is a placement question.** The click computes the slot the cloned source
  would occupy: same type and size, one gap away in the anchor's direction. The gap is the
  tuned `noteGap` (settings `gapRatio`/`minGap`, minimum 1 px), and the centre offset is the
  source's own extent plus the gap, so a large object is cleared as reliably as a small one —
  the source can never fall inside its own slot.
- **The slot is occupied by intersection, not by a centre test.** Any object whose placed
  rectangle overlaps the copy rectangle competes for the slot. A centre inside the rectangle
  is not enough (a wide object can reach into the slot from outside) and not required.
- **Only connectable leaves are candidates.** `canConnect` is the filter: frames, kanbans and
  connectors never take the slot, so a slot covered only by them still clones. Cards are
  candidates through their kanban placement, like every other card geometry (ADR-113).
- **One target is chosen in this order:** the same type as the source; then the object whose
  centre is nearest the copy's centre; then the topmost object by `layerKey` (explicit `z`,
  otherwise paint rank, ADR-039). The order makes a note prefer a note over a card sitting on
  the same point without making type a hard filter.
- **No copy when the slot is taken.** The click creates one connector A→B: the start is the
  clicked port of A, the end is the port of B whose midpoint is nearest A's port. The command
  runs in one transaction, so one undo restores the board; the camera does not move and the
  new line is selected. A locked B is a valid target: the connector changes A and the
  document's edges, never B (ADR-040).
- **A second connector between the same pair is not created.** The click does nothing and the
  selection stays as it was; a duplicate line is noise (ADR-077's pair rule, ADR-080).
- **Only the port click is affected.** `Tab`, the floating bar's arrows and the rail's "add"
  commands keep growing a clone unconditionally. They are explicit requests for an object, so
  a slot rule there would override the person's words.
- **Four ports, not eight.** `anchorsOf` returns one midpoint per side (`left`, `right`, `top`,
  `bottom`); the corner spots, the anchor offsets, the drag/pending offset fields and the
  port-offset comparisons are removed rather than left unused. A connector end stores a side
  and no offset.
- **Old corners are read as the nearest side.** A saved end with `offset` 0 or 1 is a corner
  from the eight-port world: the reader compares the corner point with the four side midpoints
  of the endpoint's box and uses the nearest, with the fixed tie order `left`, `right`, `top`,
  `bottom` (only a square is ambiguous). Other stored offsets are ignored and the side midpoint
  is used. Nothing is rewritten on read; the migration is a read rule, so old boards keep
  their geometry and a later edit writes a side-only end.

**Consequences.** A click on a port is now honest about what is in front of it: an empty slot
grows a copy, a taken slot describes the relation the person was pointing at. The number of
port hit targets halves, which is why the selected and targeted anchors are redrawn as four
dots rather than eight; product baselines are regenerated. Corner-to-side migration is
deterministic but can move one end of an old line along its object by up to half a side; that
is the visible cost of removing a port model that produced ambiguous addresses. The slot rule
exists in one pure function and is tested without a browser; the gesture only commits its
answer.

## ADR-138: A line enters a selection and an export only with both of its ends

**Status:** accepted (2026-11-02). Amends ADR-113 (a line is picked on its path, but a
selection can take it in) and the connector semantics of ADR-080 (a line is a relation
of two objects, so it travels with them). ADR-077's geometry is unchanged.

**Context.** A connector has no coordinates of its own: it stores two endpoints and the
line is derived from their boxes on every paint (ADR-077; cards resolve through their
kanban placement, ADR-113). The marquee skips lines on purpose — `pickInRect` refuses
connectors because their stored box is the bounding rectangle of the two ends and would
swallow every click in the empty space between two objects — so a rectangle drawn around
two notes and the line between them selected the notes and left the line behind. Moving
the pair left an orphan line where the note used to be, and deleting the pair left the
line too. The export had the mirror problem: a selection exported exactly the objects it
was given, so the same picture lost its lines, and a line whose second end was outside
the scope was drawn cut at the picture edge, which reads as "these two belong together"
about an object that is not in the file. The clipboard already had the right answer —
`copyFragment` takes a connector only when both of its ends come along — so the rule
existed, but was applied in one of three places.

**Decision.**

- **One predicate.** `joinsWithin(connector, ids)` in the model answers the question:
  the widget is a connector and both `start.item` and `end.item` are in the set. A line
  with one end, or none, is broken and joins nothing. The clipboard, the marquee and the
  export call it instead of each deriving "both ends" from `start`/`end`.
- **The marquee resolves objects first, then adds their lines.** The objects come from
  `pickInRect` (or from the placements when the rectangle is inside a kanban); the lines
  are the connectors that set joins. The additive (shift) marquee applies the rule to the
  union it is about to commit, so the order objects were picked in cannot change the
  answer.
- **The export scope applies the same rule.** `selection` is the selected objects plus
  their descendants plus the lines between them; `frame` is the frame, its descendants and
  the lines that stay inside it — a line leaving the frame is not exported rather than
  clipped; `board` is unchanged, because every end is in scope by construction.
- **An explicitly selected line stays.** An export of a line the person selected on its
  own still contains it, cut at the edge as before. An explicit selection is a statement
  about that object; the scope rule adds members and never removes the ones it was given.
- **A selected kanban is its cards** (ADR-006, ADR-071): the set is widened through the
  kanban layout, so a line between two cards of a selected kanban counts as internal, the
  same way the export's container expansion already counts the cards as members. A card
  end is matched by id through its placement, never by `widget.x/y` (ADR-113).
- **A line contributes no box of its own to the picture.** Its stored rectangle is the
  bounding box captured at creation and goes stale as soon as an end moves, while an
  included line lies between two ends that are in scope. The stored box is the fallback
  only for a picture that is nothing but a line.
- **A single click does not change.** `pick` still refuses connectors and a clicked object
  is selected alone, so one object never pulls its lines into the selection.

**Consequences.** A marquee around a pair now moves and deletes the line with the pair: the
gesture means the relation, and one undo returns all three. The stored connector
coordinates travel with the drag and nothing is re-derived from them, because the path is
always computed from the ends. Duplicates are impossible: the set is de-duplicated by id
and the added lines follow document order, not pick order. The export costs one extra scan
and the dialog's object count now includes the lines, which is what the file shows. A line
that leaves a frame disappears from that frame's export; the person includes the other
object instead, and the help topic `export.scope` says so. The rule lives in one predicate
and is tested without a browser: the gesture and the export only pass their set to it.

## ADR-139: The rail draws the window's fill grid; layers are one named ladder

**Status:** accepted (2026-11-02). Amends ADR-127 (one palette), ADR-129 (the 1–7 row
rule) and DS §18 (layers).

**Context.** Two UI regressions showed that "one palette" and "one layer order" existed in
the specification but not in the product. The rail's flyout still listed seven `sticker-*`
tokens in its own order (neutral, yellow, green, blue, pink, violet, orange) at the 100
level only, while the colour window showed seven tonal columns in the ADR-127 order
(grey, yellow, orange, pink, violet, blue, green) at 100 and 300. A person opening both
saw two palettes and could not learn one grid. Separately, the social layer used small
numbers of its own (`comment-pins` 16, `vote-chip` 6, reactions 24) and the floating object
bars used 8, so a comment pin painted over an open "Style" window and swallowed its clicks.

**Decision.**

- **One fill grid.** `packages/model/src/colorLevels.ts` gains `FILL_LEVELS` (100 and 300)
  and `colorsForLevels(levels)`. Both the colour window's fill section and the rail's
  flyout are `colorsForLevels(FILL_LEVELS)`: fourteen values, row-major (the whole 100 row,
  then the 300 row), seven columns. There is no list, order or level pair anywhere else.
- **One set of words.** A palette value is named by `color.<hex>` through one helper,
  `colorWord`; the rail's `note.*` names and `tool.stickyColor` are removed. `note.yellow`
  at 100 (`#ffe07a`) stays the default and is the swatch the rail marks.
- **No migration.** The old sheet colour `#ffdd33` is not a palette value; an object that
  carries it keeps it and every surface calls it "Custom colour" (ADR-127).
- **One layer ladder.** The tokens are `--z-canvas` (1), `--z-canvas-overlay` (10),
  `--z-bar` (100), `--z-popover` (200), `--z-dialog` (300), `--z-toast` (400). The canvas
  is below objects; comment pins, vote chips, cursors, reactions and the comment-placement
  layer use the social token; every floating panel (top bar, rail, object bars, inspector,
  discussion panel, HUD) uses the panel token; the windows and menus a panel opens use the
  popover token; dialogs and toasts keep their rows. Component CSS uses only these tokens
  — no literal layer numbers.
- **Panels win over objects and the social layer, their windows win over panels.** A pin
  under an open panel is painted under it and does not take the click; a vote chip never
  covers a panel. Inside one layer the DOM order decides, as before.

**Consequences.** The rail and the window teach the same grid; changing a tone or a level
happens once in the model and both surfaces follow, and `palette.test.ts` fails if they
drift. The rail's flyout grows from four columns to seven (280 px, the DS popover default).
The layer ladder is six numbers in `tokens.json`; reviewers can name the row a surface
belongs to instead of guessing a number, and `pnpm ds:check` keeps the generated CSS in
step. Product baselines of the rail flyout and of a board with a comment pin over an open
panel have to be regenerated after the change.

## ADR-140: White, black and transparent are named chips outside the tonal grid (amends ADR-127, ADR-129)

**Status:** accepted (2026-11-02). Amends ADR-127 (one tonal palette) and ADR-129 (presets
and defaults).

**Context.** The tonal palette of ADR-127 answered "which shade" but not the three values a
person asks for by name. White was already a chip beside Fill on a shape (ADR-129 needed it
for the Plain preset), a note could not be painted white or black at all, a border could not
be set to the same black a line preset uses, and transparency existed as a stored value but
was drawn as an empty square — which reads as white, the very value that was missing. The
gap was visible in the product: a Plain shape's fill was named "White" while a Plain border
was "Graphite", and a note could not reach either end of the ladder.

**Decision.**

- **Named values are not columns or rows.** Three values live beside the 7 × 3 grid:

| Chip | Stored value | Word |
|---|---|---|
| White | `#ffffff` | `color.ffffff` |
| Black | `#1a1a1a` | `color.1a1a1a` |
| Transparent / None | `transparent` | `color.transparent` for a fill, `object.none` for a border or a line |

  They never enter `COLOR_LEVELS`, `colorsForLevels` or `FILL_LEVELS`, so they take no key
  1–7 and no keyboard focus stops of the grid. Each is one labelled chip with an
  `aria-label` and the same word in the window, the rail and the object bar's sample.
- **One list per role, in the model.** `packages/model/src/namedColors.ts` carries
  `NAMED_COLORS` (the stored values) and `COLOR_EXTRAS`, a role → ordered list map; every
  surface reads `colorExtras(role)`. Transparency keeps one stored value and two words: a
  fill says "Transparent" (a shape with no fill is still a shape), a border or a line says
  "None" (the role itself is absent). The roles are the ones the product already has:

| Role | Where | Chips, in order |
|---|---|---|
| `note` | note sheet; the rail's sticky flyout | White, Black |
| `fill` | shape fill; a multi-selection's shared fill | White, Black, None |
| `stroke` | shape border; connector line; a multi-selection's line | Black, None |
| `text` | free text; connector label | Black, White |

  A note has no transparency: its sheet is the object, and an invisible note is a lost
  object. Text keeps its `Auto / Dark / White` control; Black joins it as a named value,
  and White is not repeated as a chip because the control already says it (`inkExtraIds`).
- **Transparency is a checkerboard, not an empty square.** A sample whose value is
  `transparent` takes the shared `.checkerboard` class: a `conic-gradient` built from
  `--bg-panel` and `--bg-active`, so the pattern follows the theme and `pnpm ds:check`
  keeps the tokens in step. It is used by the shape preset sample, the shape's bar sample
  and the multi-selection's sample. The chip itself stays a word ("Transparent" or "None"),
  because a checkerboard the size of a chip would read as a colour named "checked".
- **No migration and no new fields.** A stored value keeps its meaning: `#ffdd33` is still
  "Custom colour", and `#1a1a1a` is now named "Black" in the roles that offer the chip
  (it was one of the old twenty-two, so it is named rather than repainted). Presets keep
  writing `fillColor`, `strokeColor`, `strokeWidth` and `style` exactly as before; the
  server, the widget model and the document schema are untouched.

**Consequences.** Every role offers the two ends of the ladder and transparency where it
can be painted, and a person can reach a Plain shape's fill or a black border by name.
`namedColors.test.ts` checks the role lists, the values and the exclusion from the grid;
`palette.test.ts` checks the rail and the note window draw the same chips in the same order.
The rail's flyout grows by a two-chip row, and a white note no longer looks like an empty
square anywhere. Baselines of the rail flyout and of a shape with a transparent fill have to
be regenerated after this change.

## ADR-141: A frame can be resized; contents keep their size and membership follows the centre

**Status:** accepted (2026-11-02). Amends ADR-049 (the capability table) and applies
ADR-110 (membership follows the centre) to a frame's own box.

**Context.** A frame is the unit of layout, presentation (ADR-108) and export (ADR-071),
but its box was fixed at creation: `WIDGET_KINDS.frame.resizable` was `false`, so the only
way to make a frame cover more of the board was to delete it and draw another. That also
made frames the one container whose size could not answer "how much of the board is this
section". Resizing a container raises two questions the rest of the model may not answer
by accident: whether its contents scale, and what happens to `parentId` when the boundary
moves under them. ADR-110 already answers the second for a drop; a resize needs the same
answer, not a second rule.

**Decision.**

- **A frame is resizable.** `kindOf("frame").resizable` is `true`, so a selected frame
  gets the same four corner handles as a note, from the same painter and the same hit
  test (design-system §5). No separate frame handle, no side handles.
- **Contents do not scale and do not move.** A resize changes only the frame's `x`, `y`,
  `width` and `height`. Children keep their absolute box: no font size, note size or
  image changes, and a child does not follow a corner the way it follows a frame *move*
  (ADR-110). Making a frame larger can therefore leave empty space, which is what a
  container is for.
- **Membership is re-evaluated by the centre, in the same transaction.** After the new box
  is written:
  - a child of this frame whose centre is outside is released (`parentId = null`);
  - if another frame still contains that centre, the child joins the **smallest** such
    frame — the same winner as a drop, so shrinking an inner frame inside an outer one has
    one answer;
  - a free adoptable object whose centre is inside the resized frame joins it (again the
    smallest containing frame wins);
  - children of *other* frames, cards, connectors, frames (they do not nest, ADR-110) and
    locked objects are never reparented.
  The box change and every `parentId` change share one `board.transact`, so undo restores
  the size and the membership together.
- **The containment test reads the painted box.** The shared helper interpreted a frame's
  `x`/`y` as its top-left corner while every painter, hit test and export read the same
  fields as the centre (the model is centre-anchored). The resize path made the
  discrepancy visible — membership would change half a frame away from the plate — so
  `frameContaining` now tests the frame's own centre ± half its size. This is a correction
  of ADR-110's implementation, not of its rule.
- **A frame has a floor of 160 × 120.** The title line is 13/18 bold (design-system §5);
  16 px of padding above and below leaves 70 px of usable height at 120, and 160 px is
  the narrowest box that still reads as a section and lets a note's centre land inside.
  The floor is `minSize` on the kind and is read through `minimumSizeOf()`, not written
  as a number in the gesture: the handle preview and the document command clamp with the
  same value. Other kinds keep the generic 80 × 60 floor.
- **Presentation and export use the new box as it is.** A slide fits whatever rectangle
  the frame now has (ADR-108), and an export paints the frame and its members at their
  real sizes (ADR-071). Neither scales content, because content never scaled with the
  frame in the first place.

**Consequences.**

- A section can be made bigger around existing content without touching the content; an
  object that leaves the section by shrinking it becomes independent in the same gesture,
  and one that the growing section now covers joins it.
- A resize is one undo step, including the membership it changed. Moving a frame still
  moves its children (ADR-110); resizing never does, and the two commands stay separate.
- No new field, migration or server command: `resizable` and `minSize` are capabilities,
  and `setWidgetRects` already carried a resize. The frame gains corner handles when
  selected; no existing product baseline shows a selected frame, so no PNG changes.
- `kinds.test.ts` pins the capability and the floor, `widgets.test.ts` pins grow, shrink,
  re-homing, the floor, the locked child and the single undo step, and the browser
  scenario in `gestures.spec.ts` checks the real handle and the unchanged child.


## ADR-142: An agent proposes a plan of objects; the client applies it in one transaction

**Status:** accepted (2026-11-02). Extends the authoring contract of ADR-068/ADR-092; it
does not change the change-set path for cards and connectors.

**Context.** Change sets already let an agent write cards and connectors on the server,
and that is the right shape for work that has no open tab. Authoring a structure is
different: a story map of sixty stickers is a *person's gesture*. If the server writes
it, the update arrives from a remote origin, ⌘Z in the author's tab does not take it
back, and the one thing people expect after accepting a structure is the one thing that
fails. A model answer is also untrusted: it can name objects that do not exist, put a
box outside the canvas, join a frame to a line, exceed a sensible size or invent a style
field the document would silently ignore. M1 is the contract for that: operations,
validation, dry run and the apply rule. UI, files, Markdown and the runner prompt are
M2/M3.

**Decision.**

- **A plan, not a change set.** The authoring operations are `create_widgets`
  (`{tempId, type, x, y, width, height, parentRef?, title?, text?, shapeKind?, style?}`),
  `create_connector` (`{from, to, arrow?, routing?, style?}`) and `create_structure`
  (`{template: "user-story-map", title?, columns: [{title, stories}], swimlanes?}`).
  They normalize into one **plan**: absolute centre-anchored objects, connectors,
  bounds, counts and warnings. Creating is the whole of M1; changing or deleting
  existing objects has its own validation and undo story and comes later.
- **Temp ids are the plan's identity.** A `tempId` starts with a letter, uses letters,
  digits, `_` or `-`, is at most 64 characters, is unique in the plan and never equals
  an id already on the board. `parentRef` and connector ends name a `tempId` or an
  existing object id; the client mints real ids only when it applies the plan. A plan
  is therefore not replayable by itself, which is correct: replaying a structure would
  mean duplicating it.
- **The limits are part of the contract.** One plan has at most 10 operations, 300
  objects, 100 connectors, 12 columns, 50 stories per column, 6 swimlanes of up to 4
  rows each, coordinates within ±1 000 000 and boxes from 80 × 60 to 20 000 (a frame
  keeps its model floor of 160 × 120). Text is at most 2 000 characters and a title
  200. Above 200 objects the dry run warns that the plan is close to the ceiling. A
  request that needs more is split, not applied halfway.
- **Parenting follows the document.** Only a frame may be a parent, it must exist and be
  unlocked, a frame never has a parent (ADR-110), and a parent chain may not cycle.
  Objects without a parent are free on the canvas.
- **A connector joins connectable leaves.** Both ends must exist after the plan is
  applied and must be connectable kinds (`sticky_note`, `text`, `shape`, `card`,
  `image`, `stamp`), never a frame. Self-loop and a duplicate unordered pair are
  refused, both inside the plan and against the connectors already on the board. The
  codes match the existing API promises: `connector_self_loop`, `CONNECTOR_EXISTS`.
- **Style is an allowlist.** Only fields the model already has (`fillColor`,
  `cardTheme`, `strokeColor`, `strokeStyle`, `strokeWidth`, `fontSize`, `fontFamily`,
  `color`, `textAlign`, `textVAlign`, `stickySize`, `textColor`) survive validation;
  an unknown field is a refusal, not a value to ignore. A connector accepts only the
  three stroke fields. No new widget field and no migration.
- **The story map is measured, not invented.** `create_structure` uses the constants of
  `spec/templates.json` → `user-story-map-basic`: a 161.2 × 184.7 note, 181.6
  horizontal and 194.7 vertical pitch, a 364.1 label band, a 225.9-tall lane row and a
  32 gap between frames. The generated map has a header frame with one text per column,
  one frame per swimlane with a label text in its band, and the stories as sticky notes
  centred in their rows. Column titles are texts, not stickers, because a title is not
  an object a person moves; the measured sticker geometry is kept for the stories. A
  column with more stories than the declared rows extends the last swimlane and reports
  `STORIES_EXCEED_LANES` instead of dropping stories.
- **The dry run is the default.** Validation returns counts (objects, connectors, by
  type), bounds (width and height) and warnings: overlaps between planned boxes
  (frames and their children excluded), out-of-bounds boxes, an empty column, an
  extended swimlane and a plan close to the ceiling. It writes nothing. Overlap is a
  warning, not a refusal: a label on a shape can be intentional, and the person
  approving the plan decides.
- **Explicit approval, then the client writes.** A plan is applied only after a person
  confirms it; preview is the default and a model answer is never auto-applied.
  `applyAgentPlan` refuses a call without `approved: true`, so the gate is a property of
  the only write entry point rather than a convention in a dialog. The client then
  validates the shared contract, preflights every external parent and connector end
  against the live document, and writes all objects and connectors in **one transaction
  with `LOCAL_ORIGIN`**. One ⌘Z removes the whole plan. The server validates against the
  board, estimates and — once the preview route lands with M2 — records the approval in
  the audit; it does not write objects in M1, so there is no second writer and no
  remote-origin undo surprise.
- **One module, two runtimes.** The pure planner and validator live in
  `@remo/agent-plan` — plain ESM with a `.d.ts`, the `@remo/metrics` pattern — because
  `apps/sync` has no build step and the web must apply exactly the same plan. The sync
  wrapper (`apps/sync/agent-plan.mjs`) adds board facts and the action budget; it does
  not repeat a rule. A document-level guard keeps the connectable list equal to
  `WIDGET_KINDS`.
- **Change sets stay as they are.** Cards and connectors keep their server-side path
  and their error codes. Agent authoring does not become a general scripting language
  and does not bypass the task, budget or ACL that ADR-068 defines.

**A plan is stored, not written (M2a).** The runner of the `brief-to-board` skill ends
with a plan and stops. `agent_task_plans` holds one row per task (`task_id` is unique,
so a repeated run refreshes a still-proposed plan and never replaces one a person has
acted on), with `plan`, `estimate`, `status` (`proposed`, `approved`, `applied`,
`rejected`), the skill and model that produced it, and who approved or rejected it.
`GET /agent-tasks/:id/plan` returns the plan and its dry run; `POST .../plan/approve`
records the approval and the `agent.plan.approved` audit line; `POST .../plan/reject`
records the rejection, closes the task and writes `agent.plan.rejected`. Approval is a
write right: it needs an account and `board.edit` on the task's board, so a public-link
visitor or a reader is refused with a reason. Both transitions are conditional updates,
so a repeated call returns the same state instead of a second audit line. `applied` is
reserved for the client's confirmation in M2b: the server still never writes the board.
`SCHEMA_VERSION` moves to 10 and the read path treats a missing plan or input row as
"not there yet" (`PLAN_NOT_READY`), so a task created before this release keeps working.

**Applied is the client's report (M2b).** After the one local transaction the author's
tab calls `POST /agent-tasks/:id/plan/applied`. The route accepts only a plan that is
already `approved`, writes the `agent.plan.applied` audit line once and moves the task
to `applied`; a repeat is a replay. It confirms a write that already happened and cannot
produce one, so the server still has a single authoring writer.

**The preview is legible (M3).** The dialog shows a miniature computed from the
estimate's bounds — frames as outlines, sticky notes, text and shapes by kind, planned
connectors as lines — and one sentence with the object count, connector count and bounds
that is also the image's accessible name. Objects are grouped by kind with their count;
the collapsed list renders a few rows per group and "show all" is a deliberate act, so a
300-object plan is cheap to open. Warnings are rows with the server's code and our
sentence: `PLAN_OUT_OF_BOUNDS` and `PLAN_TOO_LARGE` disable Apply, while overlap, an
extended lane and `PLAN_LARGE` remain warnings a person may accept. Apply approves, writes
in one local transaction and records `applied`; the dialog then becomes the result — the
button does not return, the undo hint names ⌘Z, and "Show on board" leaves the preview
with the created frames selected.

**Untrusted content.** The task text, an attached file and the board are **data, never
instructions**. The prompt states this, every input is a labelled JSON block, and the
model's only possible action is one of the three create operations above: it cannot
change or delete an object, read another board, fetch a URL or send anything anywhere,
so "ignore previous instructions" has no tool to reach. The model cannot grant itself a
capability either — the runner re-reads the task, the agent and the owner's access after
the call and before a plan is stored.

The context is minimal by construction. The board snapshot carries ids, types, boxes,
parent ids, frame ids and kanban column ids, capped at 200 objects; it never reads
titles, note text, comments, audit rows, ai runs, tags or people. The brief and the file
are the only free text that leaves for the provider.

The door is narrow. A file must be `.md`, `.txt` or `.csv`, is decoded as UTF-8, is
refused with `BAD_FILE_TYPE`, `BAD_FILE_ENCODING` or `FILE_TOO_LARGE` in words that say
what to do, and is capped at 100 000 bytes and 20 000 extracted characters. CSV is read
by a small dependency-free RFC 4180 parser and flattened to `header: value` lines. Text
beyond the cap is cut at a line boundary and the task records `truncated` with
`TASK_INPUT_TRUNCATED`; a plan is never truncated. The extracted text lives in
`agent_task_inputs` beside the task, is readable only through the plan route with
`board.edit`, and is not copied into the task history or the audit. The original bytes
are deliberately not stored: the extracted text is all a model can use, and keeping the
upload would only widen the exposure.

The reply is all-or-nothing. The model must return exactly `{"operations": [...]}` with
1–10 operations and no other key; an unknown field, an unknown object type, a reference
to an object that is not on the board, text with markup or a script, or more objects than
the limits fails the whole task with a code (`BRIEF_SCHEMA`, `TOO_MANY_OPERATIONS`,
`UNSAFE_TEXT`, `PLAN_TOO_LARGE`, `PARENT_NOT_FOUND`, `CONNECTOR_TARGET_MISSING`,
`BUDGET_ACTIONS`). Nothing is repaired into a partial plan, because a half structure is
worse than a refusal a person can read.

The tests pin the promise: `task-file.test.mjs` covers the CSV parser, UTF-8 refusals,
size caps and truncation; `agent-brief.test.mjs` covers the snapshot fields, the prompt
guard and the strict reply; `agent-plan-api.test.mjs` runs a brief with injected
instructions, 10 000 objects, a foreign parent id, HTML and a URL, and proves that the
runner writes no widget, the plan is stored once per task, approval and rejection are
audited and idempotent, and a viewer or a link-only visitor cannot read or approve a
plan.

**Consequences.**

- Accepting a plan and pressing ⌘Z are the same gesture seen twice: the plan is one
  transaction, and no partial structure can be left behind because validation and
  preflight finish before the first write.
- A refused plan costs nothing and names its reason; a plan that is too large is
  reported before it is approved. The ceiling is a gesture, not an import.
- The audit will record that a person approved a plan when the preview route lands
  (M2); the board records the result. The server never has a second writer for
  authoring, so the two write paths of ADR-092 are unchanged.
- Editing existing objects, files/Markdown, skills and the runner prompt are M2/M3.
  When editing arrives it needs its own ADR: `create_widgets` is deliberately not a
  patch operation with a different name.
- Tests: `packages/agent-plan/src/layout.test.mjs` pins the measured geometry and the
  generalisation; `validate.test.mjs` pins limits, temp refs, parents, connectors and
  the dry run; `apps/sync/agent-plan.test.mjs` pins board facts and the action budget;
  `packages/doc/src/agentPlan.test.ts` pins one transaction, one undo step, provenance
  and the preflight.

## ADR-143: A selection is a source, and tidying is a plan of positions

**Status:** accepted (2026-11-02). Extends ADR-142 (the plan contract) and ADR-110
(frames and membership); it does not create a second authoring path.

**Context.** A person already arranges objects by hand: they select five notes written
"US-1"…"US-5" and drag them into a column. The command should do that gesture, not ask
for a brief. Two things were missing. The task could not say *what it read* from a
selection: groups were not expanded, a frame was a single object instead of its
contents, and the model saw twenty fragments in selection order. And the plan contract
could only create, so the only way to move an existing object was a second writer or a
change of its identity.

**Decision.**

- **The selection is a source beside the brief and the file.** A task accepts
  `selectionIds`. The server expands groups to their members and a selected frame to
  everything it contains, reads the editable text (not the stale field), keeps kinds,
  boxes, parent ids and the lines whose *both* ends are selected, orders objects
  top-down then left-right, drops empty texts and repeated sentences, and stores the
  result in `agent_task_inputs` with source `selection` (SCHEMA_VERSION 11). The caps are
  50 objects and 20 000 characters; the tail is cut at a boundary and the task records
  `SELECTION_TRUNCATED`. The plan route returns the counts and the allowed ids, never
  the text itself.
- **"What goes to the model" is three named things.** The task wording, the selection
  text (with the count and characters) and the board snapshot (ids, kinds, boxes,
  parents, frame and kanban column ids). The dialog shows the same list the server will
  send and offers "Remove" (task without object text) and "Selection only" (the
  selection becomes the task). The selection is data, never instructions: the existing
  prompt guard and the `<`/`>` escaping apply unchanged.
- **A tidy plan moves, it does not rewrite.** Two operations join the contract:
  `place_widgets` (`{id, x, y, parentRef?}` for existing objects) and `create_widgets`
  (the frames that are visual blocks). `create_group` deliberately does not exist: a
  group is a selection helper, a frame is a named region a reader can see and move.
  `place_widgets` carries no size, text or style, and no connector operation is added,
  so a tidy cannot resize, rewrite or break a line.
- **A tidy plan is validated like any other plan.** `context.allowedIds` is the
  expanded selection; a placement outside it, an object that is not on this board, a
  frame or connector as the target, a card inside a kanban, a duplicate destination, a
  missing or locked parent and a coordinate outside ±1 000 000 are refusals. The brief
  runner passes `allowPlacements: false`, so a model reply that asks to move an object
  is refused with `OPERATION_NOT_ALLOWED`: the create-only skill stays create-only. A locked
  *target* is skipped with `TIDY_LOCKED_SKIPPED` instead of failing the whole gesture:
  a lock is a decision, and the report says the object stayed. `PLAN_TOO_LARGE` is a
  refusal, not a preview warning (ADR-144).
- **The layout is deterministic and the model only reads.** `@remo/agent-plan` lays out
  one of four readings: `grid`, `prefix` (natural order, so `US-2` is before `US-10`),
  `type`, and `meaning` (the model's named blocks). Prefix and type use the same
  columns: one block frame per group, a title band, padding, a gap, objects stacked in
  natural order, and a downward shift when a foreign object is in the way. Nothing that
  is not selected moves. A selected frame is a container: its contents are laid out
  inside its inner rectangle and no frame is nested (ADR-110). If the objects cannot fit
  at their current size, the plan is refused with `TIDY_DOES_NOT_FIT`; the frame is
  never resized. The engine clamps every box to the canvas and reports locked, foreign
  and unselected-frame objects.
- **The model is optional.** If a provider is configured the runner asks for block
  labels and a strategy; a missing key, a timeout, an invalid reply, markup or a
  foreign id all mean the same thing: the deterministic prefix/type fallback is used
  and `TIDY_CLASSIFICATION_IGNORED` is shown with the plan. A model never returns a
  coordinate.
- **One preview, one transaction, one undo.** The person confirms the strategy in the
  plan preview and may switch it; `POST /agent-tasks/:id/plan/relayout` recomputes the
  geometry for a still-proposed plan, keeping the labels, and audits
  `agent.plan.relayout`. Accepting approves, the client writes frames and placements in
  one `LOCAL_ORIGIN` transaction, then reports `applied`. ⌘Z takes the whole tidy back.
  A plan approved in another tab cannot be re-laid-out here: the strategy is part of
  what the person read.
- **The command is one entry point.** "Tidy up" appears in the selection context menu
  and on the arrange bar; it opens the same plan dialog. The skill selector offers only
  skills that can run with the current source plus "Auto"; an explicit slug still wins
  over every intent hint, and the intents for "tidy up", "arrange", "приберись",
  "наведи порядок" and "разложи" resolve to `tidy-selection`.

**Consequences.**

- Moving objects is now part of the authoring contract without a second writer. The
  server still never touches the document, and the client applies one plan in one
  transaction (ADR-142).
- The selection source is stored, so the preview in another tab can say what was read
  and which ids are legal without re-reading the board.
- A tidy does not update connector geometry: the line record is derived from its
  endpoints, so moving a note moves the line without editing it.
- The 50-object cap keeps a tidy a gesture. A larger selection is a refusal a person can
  read, not a partial arrangement.
- Tests: `packages/agent-plan/src/tidy.test.mjs` pins natural order, grid, blocks, a
  frame's inside, the foreign shift and the fallback; `apps/sync/selection-source.test.mjs`
  pins group/frame expansion, reading order and both caps; `apps/sync/agent-tidy.test.mjs`
  pins operations, locked skips and the strict classification; `agent-tidy-api.test.mjs`
  pins storage, relayout, foreign ids and the ceiling; `packages/doc/src/agentPlan.test.ts`
  pins one undo and unchanged sizes/texts/lines; `e2e/tidy.spec.ts` pins the command,
  the frame interior, the model labels and the refusal.

## ADR-144: `PLAN_TOO_LARGE` is a refusal, not a preview warning (corrects ADR-142)

**Status:** accepted (2026-11-02). A correction to the M3 paragraph of ADR-142.

**Context.** ADR-142 says "`PLAN_OUT_OF_BOUNDS` and `PLAN_TOO_LARGE` disable Apply" among
the preview warnings. That cannot happen: the shared validator raises `PLAN_TOO_LARGE`
while normalizing operations, before a plan row exists. A plan over the ceiling is never
stored, so no dialog can show it. The sentence described a warning that is unreachable,
and a reader could infer a second, preview-time ceiling that does not exist.

**Decision.** `PLAN_TOO_LARGE` is a **validation refusal**. It is thrown by
`normalizePlan` for too many created objects or placements; the runner fails the task
with the code and writes no plan. The preview treats only `PLAN_OUT_OF_BOUNDS` as
critical and keeps `PLAN_LARGE`, overlap, an extended lane and a locked skip as warnings
a person may accept. Tidy reuses the same code for a selection over 50 objects.

**Consequences.** The refusal is one sentence with one code, and the client never
invents a second ceiling. The remaining risk is unchanged and recorded here: two tabs
can read the same approved plan and both apply it, because approval and the local
transaction are separate acts. An atomic claim on the plan (or a per-tab apply token)
is a separate change; it is not pretended to be solved by this correction.

## ADR-145: A shape resizes like a note; its text reflows and its box is the only thing that changes

**Status:** accepted (2026-11-02). Amends ADR-049 (the capability table); applies
ADR-141's floor mechanism and ADR-033's shared text painter to a shape.

**Context.** A shape was created at a fixed size per kind (`SHAPE_SIZES`: 260 × 160 for
a rectangle, 240 × 240 for an ellipse) and `WIDGET_KINDS.shape.resizable` was `false`.
That made a shape the one text-bearing box whose size could not answer its label: a
longer label had to become a note, losing the outline, and a diagram that needed a wider
box had no gesture. A shape already holds text, is connectable and editable, and its text
has been painted by the same `drawTextInBox` as a note since ADR-033 — "a shape is a note
with another outline" was true everywhere except the capability row. Resizing raises
three questions: whether the text scales, what happens to connectors, and what the floor
is. ADR-141 answered the floor for a frame with `minSize` and `minimumSizeOf()`; this ADR
uses that mechanism rather than adding a second one.

**Decision.**

- **A shape is resizable.** `kindOf("shape").resizable` is `true`, so a selected shape
  gets the same four corner handles as a note and a frame, from the same painter and the
  same hit test (design-system §5). No side handles, no separate shape handle. The press
  order in `pointerDown` already tries a resize corner before the connector ports, so a
  corner drag is never read as pulling a line.
- **The box is the only thing that changes.** `setWidgetRects` writes `x`, `y`, `width`
  and `height`; `content`, `runs`, `style`, `shapeKind`, links and tags are copied
  unchanged. No `fontSize` is written and no scale transform is applied: growing a shape
  can leave empty space, exactly like growing a note.
- **Text reflows; it is not scaled.** A shape's text goes through `drawTextInBox` with the
  note's Auto fitting (ADR-033). With no explicit `fontSize`, the largest size that fits
  the new box is chosen and the chosen alignment and vertical alignment are kept; an
  explicit size is a decision and is respected. The inline editor measures with the same
  rule (`noteFontSizeFor`), so the caret never sits at a different size from the letters
  around it.
- **The floor is the generic 80 × 60.** A shape keeps `DEFAULT_MIN_SIZE` through
  `minimumSizeOf()`; it needs no `minSize` of its own. The gesture clamps the preview and
  the document command clamps the written box with the same value, so the preview and the
  result cannot disagree. 80 × 60 is the floor a note has: a corner handle and a word
  still fit.
- **Connectors follow the ends.** A line stores only its endpoints and derives its route
  from their boxes (ADR-006, ADR-077), so a resized shape moves its four ports with its
  edges without any connector write. The ports are recomputed from the new box on the
  next paint; no anchor position is stored.
- **No style change.** A resize is geometry: fill, outline, outline width and dash, text
  colour, alignment and shape kind are untouched, so the object bar still describes the
  same object before and after.
- **One undo.** `pointerUp` commits the live preview through `setWidgetRects` in one
  transaction, so ⌘Z restores the four numbers together. A shape has no children, so the
  box is the whole step. A shape that sits inside a frame keeps that membership: a resize
  is not a drop, and membership is re-evaluated when the frame's own box changes
  (ADR-141), not when a child is resized. A note already behaves this way, so the shape
  introduces no second rule.
- **The same answer for every box that holds text.** The capability row is the only
  switch: the gesture, the painter, the ports and the document command were already
  generic. A future kind that is a box with text asks for `resizable: true` and, if it
  cannot be small, declares `minSize` and is clamped by the same function.

**Consequences.**

- A shape can be made to fit its label or the contents of a diagram without being
  replaced by a note. The preset size is a starting point, not a property of the kind.
- Notes and frames do not change: they take the same path and keep their own floors —
  the note the generic one, the frame 160 × 120 (ADR-141).
- No new field, migration or server command: `resizable` is a capability and
  `setWidgetRects` already carried the resize.
- No baseline PNG changes: no existing baseline shows a selected shape, so the new
  corner handles are not in any artefact. A baseline that selects a shape will include
  them.
- `kinds.test.ts` pins the shape in the resizable list and the 80 × 60 floor;
  `canvasGeometry.test.ts` pins the corner clamp and the ports on the new box;
  `widgets.test.ts` pins the box-only change and the single undo step; the browser
  scenario in `gestures.spec.ts` creates a shape, types into it, drags the SE handle, and
  checks the new box, the unchanged text and style, that the grown box is the one
  selection reads, and ⌘Z. The note and frame resize scenarios stay green.

## ADR-146: A published voting result is plain text, not HTML

**Status:** accepted (2026-11-02). Amends ADR-074 (publishing) in format only.

**Context.** Publishing built an HTML string (`<p><strong>…`) and created a text object
with it. A text widget stores rich-text deltas, not markup, so the board showed the tags
literally.

**Decision.**

- The published card is **plain text**: a title line, numbered rows (`1. label — votes`,
  top 10) and a meta line (`Voted: N people · …`), separated by newlines.
- No HTML is generated, escaped or parsed. Labels keep whatever characters they have.
- The session, the tally and the publishing command do not change; only the string the
  client puts into `board.item.create`.
- A rich-text or a dedicated result object is a later decision, not this one.

**Consequences.** A published snapshot is readable on the board and in export. Formatting
is gone until a structured result object exists (candidate: ADR on vote results).

## ADR-147: Named colours are square swatches beside the tonal grid

**Status:** accepted (2026-11-02). Amends ADR-140 (presentation only).

**Context.** ADR-140 added White, Black, Transparent and None as named colours, and the
first implementation drew them as pill buttons next to section labels. A pill truncates
("Transp…"), changes width per word, and reads as an action rather than a colour. The grid
beside it used square swatches.

**Decision.**

- Every colour — tonal or named — is the same square **`ColorSwatch`** (34×34, the same
  gap).
- Named colours sit in a **vertical column to the left** of the 7×2 grid: note White/Black;
  shape fill White/Black/Transparent; border and line Black/None; multi-selection by role.
  Text keeps its Auto/Dark/Black/White segment.
- Transparent is a checkerboard; None is a checkerboard with a diagonal. Names live in
  `aria-label`/tooltip, never in a truncated label.
- Keys 1–7 belong to the tonal grid only; named colours have no number.
- "Custom colour" is one line under the grid and only when the current value is outside
  the palette.

**Consequences.** One swatch look across the rail and the windows, no truncation, and the
named colour is a colour, not a button.

## ADR-148: One room per board; the projection is a replay

**Status:** accepted (2026-11-02). Extends ADR-128 (one teardown per room), ADR-016 (rooms),
ADR-089 (one schema source).

**Context.** Two different paths turned one board into two rooms, and the second room is
what produced `duplicate key value violates unique constraint "widgets_pkey"`.

1. **The socket named its room from the raw path.** y-websocket's `setupWSConnection`
   derives the document name from `req.url`, which is percent-encoded on the wire. A board
   with a non-ASCII name (`запуск-продукта-c49e0f86`) was therefore persisted as a second
   room `%D0%B7…`, while the upgrade handler (which decodes once for the access check) and
   the read API used the decoded id. One browser tab talked to two rooms: the socket wrote
   the encoded one and `bindState` created a `boards` row for it, while commands, exports
   and the read API used the real board. The router was split the same way: the IAM and
   agent routes took the board id straight from `url.pathname`, so `/api/boards/%D0%B7…/access`
   was a different board from `/boards/%D0%B7…` (the read API, which did decode). The
   development database shows the result — 15 encoded phantom boards, each with a full set
   of widgets and a decoded twin.
2. **Two loads decided the room was missing.** `bindState` (socket) and `roomDocument`
   (HTTP command, agent task, backup) both read `rooms` and then awaited Postgres. When
   both missed, each built a room with its own document, write flag and timers, and each
   scheduled the "first refresh" that rewrites the mirror. The two full passes deleted and
   re-inserted the same rows; the second insert failed on the primary key, the mirror kept
   whichever document committed last, and the losing document's edits were never projected.

**Decision.**

- **The room name is the board id, decoded exactly once.** The upgrade decodes the path
  (`roomFromRequestUrl`) and passes that value to y-websocket
  (`setupWSConnection(socket, request, { docName })`). The raw URL is never a room.
- **Every request path is decoded exactly once, in one place.** `pathSegments(url)` in
  `http-boundary.mjs` is what the IAM and agent routers split; no handler calls
  `decodeURIComponent` on a segment again. The read API, commands and exports already
  decoded once and stay as they are.
- **One load per room.** `bindState`, `roomDocument` and `writeState` queue on a per-board
  promise chain (`withRoomLock`) and go through `loadRoom`, which re-checks the map inside
  the queue. A second caller that has no document of its own receives the room that was
  just loaded instead of a copy; a caller that binds a *new* document waits for the
  previous room to be flushed, then replaces it. No timers and no polling.
- **A teardown belongs to its own document.** `writeState(docName, ydoc)` tears down only
  the room whose document it was given, so a late close of a replaced document is a no-op
  rather than the death of a live room. A retired room drops its listeners, and none of its
  passes may write the mirror: `refreshProjection`, `fullProjection` (re-checked before
  commit) and `compact` ask `isCurrentRoom`.
- **The projection is a replay, not a rewrite.** The full pass deletes rows by absence
  (`not (id = any($ids))`, `not exists (select 1 from unnest(...))`) and upserts every row
  (`on conflict … do update`). A row that a rival writer already inserted is updated, not a
  failure; the stored row converges on the document. The diff pass already upserted.
- **A database that ran the old build is repaired at start.** `mergeLegacyRoomIds()` runs
  once in the sync service's boot, after the store connects and before the port opens. For
  every `boards.id` that still contains a percent sequence it decodes one level and merges
  the encoded row into the decoded board: rows of every `board_id` table move first (the
  projection, grants, links, log, comments, votes, agent work, audit), the target keeps its
  snapshot and the source's snapshot becomes one more log entry, `snapshot_through` becomes
  0 so no moved update is skipped, an unowned target inherits the source's owner, org, team,
  visibility and claim, and only then is the duplicate row deleted — inside one
  transaction. A pair with two different owners is left alone and logged, and so is a board
  table the repair does not know: deleting it by cascade would be data loss. A second start
  finds nothing to do.

**Consequences.** A board has one room however it is opened, and a non-ASCII name no longer
creates a phantom board. Two writers of the same board — a rival room, a second process, a
replay after a crash — converge instead of failing on the constraint. `snapshot_through`
and the compaction watermark keep their meaning: the watermark is still read before the
document is encoded, and a stale room no longer compacts at all, so its watermark cannot
delete a replacement's updates. A full pass now sends the board's widget and kanban ids
instead of deleting four tables wholesale — the same rows, one array parameter.

The repair turns the encoded twin into the board the URL names, so the user who opens
`запуск-продукта…` sees the widgets that were stranded under `%D0%B7…`, keeps the claim and
the grants, and the directory loses the phantom. The merged board replays one extra update
on its next load (its own snapshot plus the other row's), which costs one Yjs merge and no
data.

**Limits.** The repair decodes one level: a doubly-encoded legacy id (`%25D0…`) is merged
on the next start, not in the same pass. A percent sequence that is not valid UTF-8
encoding is left untouched (it is not a URL form). Backup and import read `boards` and
`widgets` after the repair, so an export taken before it exports the same content as after.

## ADR-149: A signed-in cursor wears the account name

**Status:** accepted (2026-11-03). Amends ADR-021 (per-browser interface language) only in
the identity it names, not in where language is stored. Theme and language storage is
amended by ADR-150.

**Context.** `readPresence` collapses two windows by name: "Identity is the user name, not
the client id: two windows on one account are one person". The cursor identity itself was
still a per-browser `Guest 59a8`, generated on first load and saved as if it were a choice.
A person signed in as Alexander Kostylev in one browser and opening the same board in another saw
two participants — Alexander Kostylev and a guest — although both sessions were the same account.
The account menu made the split visible: the face said "Alexander Kostylev", the field below said
"Guest 59a8". Separately, the socket was rebuilt whenever the cursor name or the interface
language changed, because both were dependencies of `connectBoard`; typing a name
disconnected the room on every keystroke and switching language did the same.

**Decision.**

- **A browser has a guest name; an account has the cursor name.** `Identity` separates
  `guestName` (stored per browser, used when signed out) from `name` (what awareness
  announces). `?user=Name` sets `override` and wins even for a signed-in account, for tests
  and screenshots.
- **A signed-in cursor always wears the account name.** When `/auth/me` resolves and there
  is no `?user=` override, `name` becomes the account name whatever the browser stored
  before. The account menu no longer offers a separate "name on the cursor" field while
  signed in: presence must not disagree with the account by a typo.
- **Signing out restores the guest name.** The account name must not remain on the cursor
  of a shared browser; the browser's own guest name returns.
- **Renaming and switching language do not reconnect.** `BoardConnection` gains
  `setUser`; the session effect updates the awareness `user` field in place and no longer
  depends on the cursor name or on `t`. The room put by `connectBoard` stays put.
- **Theme and language follow the account** (ADR-150); this record only decides who the
  cursor is.

**Consequences.** Two signed-in windows of one account are one person again, including a
window that had previously typed a different cursor name. A new browser no longer appears to
the team as a stranger before the name is edited, and signing out does not leave the account
name behind. Typing a guest name and changing EN/RU no longer destroy the websocket. The
stored guest name is the migration: no schema bump, and an old browser upgrades on its next
load.

**Limits.** `?user=` still makes one tab act as another person: that is the supported way to
test presence without a second account. The account name itself is not editable yet. The
"two windows are one person" consequence is superseded by ADR-151: authority stays on the
account, but presence keeps one entry per session so follow can target a device.

## ADR-150: Theme and language follow the account

**Status:** accepted (2026-11-03). Amends ADR-021 (language is stored per browser), ADR-032
and ADR-123 (settings stay per browser) for the two display preferences only, and the last
bullet of ADR-149.

**Context.** A person signed in on one browser, chose the light theme and Russian, then
opened the same account in another browser and found the defaults: system theme and English.
The choice lived in `localStorage` (`remo.theme`, `remo.lang`), which is a property of the
browser, not of the person. For board settings that is deliberate (ADR-032/123): the grid and
fonts are how one person reads one screen. A theme and an interface language are not: they
describe the person, and every other product the team uses carries them across devices. The
split also made the account menu lie: it showed a signed-in account but offered settings that
the account did not own.

**Decision.**

- **Two nullable columns on `users`.** `theme` (`system`, `light`, `dark`) and `lang`
  (`ru`, `en`); `null` means "this account has not chosen yet". Schema version 12. The
  columns are added with `add column if not exists`, so an older database upgrades on the
  next start without a data migration.
- **One wire shape.** `/auth/me`, `/auth/login` and `/auth/register` return
  `user.preferences: { theme, lang }`. `PATCH /auth/preferences` writes both values for the
  session's own account and returns the stored pair; an unknown theme or language is
  `422 BAD_THEME` / `422 BAD_LANG`. The endpoint is not audited: it changes how one person
  sees the interface, not rights or content.
- **The account wins on sign-in.** `useAccountPreferences` applies stored values when the
  session appears. A field the account has not chosen is seeded from the browser that signs
  in first, so an account created before this record does not reset the person to defaults.
  A change made while signed in is written back once.
- **`localStorage` remains the guest and pre-auth value.** Before sign-in, and after
  sign-out, the browser's own choice applies; it is also the value a failed or offline
  preference write leaves in place. The server is the source for a signed-in account; the
  local copy is a cache, not a second store. Board settings (grid, snapping, fonts) stay
  per browser (ADR-032/123).
- **No realtime preference channel.** A change in another open browser is not pushed over
  the socket; it applies on the next sign-in or load. Adding a preference event would be a
  second mechanism for a value that changes a few times a year.

**Consequences.** Theme and language now survive a new browser, a second device and a
cleared profile. A guest still gets a usable interface immediately, without an account and
without a request. An old account is seeded once by the first browser that signs in after
the upgrade; two browsers racing with different local values resolve by last write, which
is the same rule as any preference edit. A malformed request cannot store an unknown theme
or language, so the client never has to repair a value it reads.

**Limits.** A browser that is already signed in keeps its applied values until it reloads or
signs in again; there is no live cross-browser update. If the account has one field set and
the other null, the null half is seeded from the signing-in browser, not from a default. The
local copy survives sign-out, so the next guest on a shared browser sees the last theme and
language; these are not secrets, and clearing site data removes them.

## ADR-151: Presence is per session; authority is per account

**Status:** accepted (2026-11-03). Amends ADR-149 (two windows are one person) and extends
ADR-076 (follow).

**Context.** ADR-149 made a signed-in cursor wear the account name and collapsed presence by
name. That removed a phantom guest, but it also removed the only way to follow one of two
devices: two windows share a name, `readPresence` kept one entry, and `FollowState.target`
was a name. A person on a laptop and a desktop could not be followed separately, and the
second camera was invisible. At the same time, authority must not multiply: votes, comments,
author locks and budgets belong to the account, not to a tab.

**Decision.**

- **One live session is one presence entry.** Awareness carries `sessionKey` (per tab, kept
  in `sessionStorage`), `accountId` and `joinedAt`. `readPresence` never dedupes by name, and
  `self` is decided by session key, not by a shared name.
- **A label is a display name plus an index, never an email.** The base is the account name
  (or the guest name). Sessions with the same `accountId` and name get `(2)`, `(3)` in join
  order; a `?user=` test override keeps its own name and is not suffixed. The account name
  remains the only base a signed-in session shows.
- **Follow targets a session.** `followTo`, `FollowState.target`, bring-everyone invites and
  "stop everyone" carry a `sessionKey`; the pill and notices display the label. Two sessions
  of one account are two independent follow targets, each with its own camera.
- **Authority stays per account.** Votes use `subject = user:<id>`, so two sessions share one
  quota; comments and read markers use the author/account id; author locks record the user
  id; agent limits belong to the owner. A second session is a second cursor, not a second
  voter, author or budget.
- **Anonymous link visitors remain per browser.** Their vote subject is the signed visitor
  cookie; two browsers are two quotas. Without a verified identity there is no stronger
  subject to use, and inventing one would be worse than naming the limit.
- **Presentation stays in awareness.** It is per session, but the audience currently takes
  the first presenting peer. Choosing between two presenters of one account is a separate
  decision, not part of this record.

**Consequences.** A teammate can follow the exact laptop or desktop instead of guessing which
window of an account is moving. Sessions are visible with an index, while the account menu
still shows one account name. Voting cannot be doubled by opening a second tab, and the
existing `?user=` override still supports a two-person scenario in one account. A reload
keeps the session key (`sessionStorage`), a new tab is a new key, and an ordinal can change
when an earlier session leaves; follow targets the key, so it never jumps to another window.

**Limits.** Guest sessions are not grouped by account and two guests with the same chosen name
still look identical. Restoring a closed tab may create a new key. Link visitor quotas remain
per browser, and two presenters of one account still resolve to the first one seen.

## ADR-152: One presentation per board

**Status:** accepted (2026-11-03). Amends ADR-108 (presentation is live state in awareness).

**Context.** Presentation lives in awareness, so every session can write its own
`presenting`. ADR-151 made two sessions of one account visible; both could start a
presentation, and `usePresentation` showed the audience the first presenting peer it found.
In practice one meeting has one "now showing" slide, but the product offered two.

**Decision.**

- **A board has one active presentation.** `start` refuses when any other session already
  has `presenting`, and says whose presentation is running (label, including the session
  index from ADR-151). The second session can watch instead.
- **The check is in the client, at the only place that starts a presentation.** There is no
  server record: presentation is attention, not board state (ADR-108).
- **The audience still reads the first presenting peer.** With one presenter this is
  unambiguous; a future presenter chooser would be a separate record.

**Consequences.** Two windows of one account cannot fight over the slide order, and different
accounts cannot silently create competing presentations. The presenter's label distinguishes
the laptop from the desktop. Stopping the presentation releases the board for the next
presenter.

**Limits.** Two sessions that press Start in the same awareness tick can both write
`presenting`; the audience then shows the first, and one presenter must stop. The check is
best-effort by design — a server lock for ephemeral attention would be a second mechanism.

## ADR-153: Sessions are visible and individually revocable

**Status:** accepted (2026-11-03). Extends ADR-062 (sessions in a cookie).

**Context.** The `sessions` table already stores a creation time, a last-seen time, an expiry
and a user agent, but the product only offered "change the password", which revoked every
session including the current one. A person who left a laptop signed in could not end just
that session, and could not see whether it was still alive.

**Decision.**

- **The owner sees their own sessions.** `GET /auth/sessions` returns each active session's
  id, creation, last-seen, expiry and user agent, and marks the current one. A token hash is
  never part of the response.
- **One session can be revoked.** `DELETE /auth/sessions/:id` revokes a session owned by the
  caller; a missing, expired or foreign id is `404`. Revoking the current session also
  clears the cookie. The action is audited as `auth.session_revoked`.
- **Last seen is real.** A successful session lookup renews `last_seen_at` without adding
  latency to the request, so the list answers "when was this device here", not "when was it
  created".
- **The account menu owns the screen.** "Active sessions" opens a dialog with a
  device/browser label, the last activity, a "this browser" badge and one action per row.
  Ending another session leaves the current one; ending the current one signs out.
- **No schema change.** The columns existed; the missing piece was the API and the screen.

**Consequences.** A lost device can be ended without changing the password, and the password
change remains the "close everything" action. The list is per account, so two sessions of one
account both appear. Revoking a session closes its live sockets on the existing 30-second
sweep; the next HTTP request is already `401`.

**Limits.** A user agent is a hint, not a device fingerprint: two Chrome/macOS entries look
alike. There is no IP or location. Revoking a session does not synchronously close its open
WebSocket; the sweep is the backstop.

## ADR-154: The audit says which session acted

**Status:** accepted (2026-11-03). Extends ADR-061 (audit) and ADR-153 (sessions).

**Context.** With several login sessions per account, `actor_id` answers "who" but not
"which browser". Two sessions can perform the same kind of action, and an incident cannot
tell whether it came from the laptop that was left open, the phone, or an integration using
the same account. Session revocation (ADR-153) made the distinction visible; the audit did
not record it.

**Decision.**

- **`audit_events.session_id`** is a nullable UUID, not a foreign key: the row must survive a
  session row and must not block cleanup. Schema version 13; `add column if not exists`.
- **The session travels with the request, not with each action.** The IAM audit wrapper, the
  command audit, the human agent audit and the vote audit attach the current
  `session.sessionId`; a bearer token, an internal task or a pre-login event stores `null`.
  No call site has to remember it.
- **The per-organisation journal keeps its scope.** `listAudit` returns `session_id` for
  callers that need it; the account-level "session revoked" row still has no organisation and
  therefore does not appear in an organisation's journal.
- **No UI yet.** The id is available for forensics and support; showing it in the journal is a
  separate screen decision.

**Consequences.** An administrator can distinguish two sessions of one account in the raw
audit, and a future journal can render "Chrome · macOS" instead of guessing. Existing rows
have `null`; no backfill is possible and none is invented. The extra column costs one UUID per
audit row.

**Limits.** An action before sign-in (register, failed login) has no session. A bearer token
has no browser session; it keeps `session_id = null` and is identified by its token fields.
The UI does not display the id yet.

## ADR-155: Agent writes from the UI carry an idempotency key

**Status:** accepted (2026-11-03). Implements the client half of the existing agent
idempotency (ADR-142).

**Context.** The agent API already accepted `Idempotency-Key` and replayed the first task or
change set for a repeated key, but every UI call omitted it. A lost response followed by
"try again" could therefore create a second task; a slow double submit could do the same. The
same gap existed in "Tidy up".

**Decision.**

- **One key per unchanged draft.** `AgentDialog` keeps a key together with a fingerprint of
  the fields that define the request (agent, intent, skill, repeat, target, mode, source and
  file name/size). A retry of the same draft reuses the key; editing any of those fields
  makes a new one.
- **The key is cleared on success.** The next intentional task gets a new key. A failed
  request keeps it, so the retry is the same write rather than a second one.
- **Tidy uses one key per run.** Its selection and strategy define the request; the busy
  guard prevents a parallel run.
- **Only creation is keyed.** Executing an existing change set is already idempotent by its
  id and server state; it does not need a second key.
- **The key is opaque.** A UUID (with a timestamp fallback) is sent in the
  `Idempotency-Key` header; the server stores it per organisation and replays the result.

**Consequences.** A double click, a lost response or a retry after a timeout no longer
creates a second task or preview. The UI and the bearer API now use the same mechanism
instead of two.

**Limits.** Two independent browsers typing the same brief still have different keys and may
create two tasks; the key deduplicates a retry of one draft, not an intention across tabs. A
schedule creation is not keyed (it is a different write). Keys are not visible to people and
do not affect budgets beyond the task that was actually created.

## ADR-156: Explicitly decline the optional LevelDB build

**Status:** accepted (2026-11-03). Amends ADR-133.

**Context.** A clean Docker install finds the optional native `leveldown` dependency
of `y-websocket`. pnpm treats its unreviewed install script as a release error.

**Decision.** Record `leveldown: false` in the workspace build policy. The sync
service supplies its own persistence through `setPersistence`. Its deployment
does not set `YPERSISTENCE`, the switch that loads the optional LevelDB backend.

**Consequences.** Clean installs can proceed without running the native build.
The existing persistence and the policy for other dependency scripts stay in place.

## ADR-157: The portal publishes a public AI entry point

**Status:** accepted (2026-11-03). Extends ADR-099 (the guide is a static portal).

**Context.** The guide was written for people: a reader had to know which page to open, and
there was no machine-readable map for an LLM. The product already expects people to hand a
documentation link to an agent ("read this and answer"), but the portal offered no link that
was honest about being documentation-only, and no place to copy it from.

**Decision.**

- **Two generated files.** `docs-site/llms.txt` is the conventional map: product summary,
  every section and page with its English title, summary and absolute URL. `llms-full.txt`
  contains every English page in reading order with its source URL. Both are built from the
  same `guide/` source as the HTML and checked by `guide:check`; nothing is written by hand.
- **They are documentation, not authority.** The files carry no account, board, token or API
  access, and say so in their header. Acting on a board still needs the normal account and
  rights; the AI page links to the API reference for that.
- **One page explains the contract.** `guide/overview/ai` states what the files are, gives
  both URLs with the existing copy control, shows example questions, and lists what is and is
  not inside. It is reachable from the overview, the top bar and the table of contents.
- **Discoverable where the question starts.** The overview page has a tip between the page
  title and "In short"; the right-hand "On this page" box starts with a "For AI agents" link;
  the top bar carries an `AI` link on every page. Three entry points, one page.
- **English for the machine, Russian for the portal.** The generated files use the English
  pages because most models read them more easily; the Russian pages remain the human source.
- **Absolute URLs.** The files are read outside the portal, so links use the public
  documentation origin rather than site-relative paths.

**Consequences.** A person can copy one link and get an answer about remo without teaching the
agent the site structure. The same files make the guide usable by MCP clients and other tools
that accept an `llms.txt`. A content change regenerates both files in `pnpm guide:build`, and
`guide:check` fails when they are stale.

**Limits.** The files describe the product, not a live board; they contain no private data and
cannot perform an action. They are English-only, and the public origin is the documentation
domain. A future API/MCP discovery file would be a separate contract, not a second copy of
this one.

## ADR-158: Templates are authored for remo, not captured

**Status:** accepted (2026-11-03). Amends ADR-005 (template system), ADR-006 (kanban
geometry) and ADR-012 (named palette) for the starting templates only.

**Context.** The first templates were normalized from captures of another product: their
geometry, titles and example text came from that product's gallery, and `decorate.ts`
reconstructed sticker labels and a dot-voting legend from what was visible. The public
edition removed the captures and screenshots, but the shipped `templates.json` still
carried the derived layout and verbatim copy, and the kanban recipes still described the
captured matrices.

**Decision.**

- **Templates are authored, not captured.** `scripts/author-templates.mjs` writes
  `spec/templates.json` from remo's own layouts, names and prompts. `pnpm templates`
  regenerates the file and copies it to `apps/web/public`.
- **Own names and copy.** The four starting points are **Story map**, **Roadmap**,
  **Roadmap example** and **Kanban board**; the English labels live in `TEMPLATE_LABELS`,
  the Russian ones in `newBoard.template.*`. Internal keys stay unchanged so existing
  `?template=` links and stored board titles keep working.
- **Own matrices.** `reconstruct.ts` carries remo's columns, swimlanes and card placement:
  Backlog / In progress / Done for the kanban, Now / Next / Later / Not now for the
  roadmap, with own accents from the tonal palette.
- **No modelled decoration.** The capture-derived sticker labels and dot-voting legend are
  removed with `decorate.ts`; a template contains only objects a person can see and edit.
- **The agent story-map layout is ours.** The constants in
  `packages/agent-plan/src/layout.mjs` are remo's geometry, not measurements copied from
  a template.

**Consequences.** A new board starts from a small, readable example that belongs to the
project. Existing boards keep their content and titles; only newly seeded or newly added
templates use the authored layouts. Tests and visual baselines follow the new geometry.
The internal keys are deliberately stable, so no URL or document migration is needed.

**Limits.** The change does not rewrite objects already on a board; a board created from
an older template keeps them. The old research archive remains private. The template
editor is still a code-level authoring script, not a product screen.

## ADR-159: Pre-release boards keep no captured decoration

**Status:** accepted (2026-11-03). Amends ADR-158 for the public pre-release.

**Context.** ADR-158 removed the capture-derived decoration from the templates but kept
the renderer for boards created by an earlier build: sticker glyphs, reaction counts,
dot-voting legends and decorative panels. The public edition has no users and no boards
in the wild; the old history is private. Keeping a renderer for objects nothing can
create is dead code and a second model for content.

**Decision.**

- Remove `emoji`, `reactions`, `legendTitle`, `entries`, `decorative` and `LegendEntry`
  from the model, the painter and the read projection.
- A `stamp` is a tinted plate with an optional caption; an `unsupported` object keeps
  its lane label and the dashed fallback.
- No read migration: there are no pre-release boards to migrate.
- ADR-158's "existing boards keep their content" remains true for boards created from
  this release onward; it no longer promises compatibility with captures that predate
  the public edition.

**Consequences.** The model is smaller and the painter has no branch for content the
product cannot create. If a pre-release database is ever imported, its decoration
fields are ignored; the objects themselves remain, so no board is lost.

**Limits.** The old private archive is not a supported import source. A future import
would need a migration, not a renderer branch.

## ADR-160: A client or a failed background write does not end the sync process

**Status:** accepted (2026-11-03). Extends ADR-109.

**Context.** ADR-109 made the HTTP and upgrade handlers answer instead of throwing, but
the process could still be ended from outside. `ws` emits `error` on a socket with an
invalid frame, and neither this service nor y-websocket listened, so one frame from a
public-link visitor was an uncaught exception. A reset during the asynchronous access
check hit the same gap on the raw socket. y-websocket calls `bindState` and `writeState`
without handling a rejection, so a Postgres outage or a document whose `kanbans` entry is
not a map became an unhandled rejection; the second one repeated on every open after the
restart. An idle `pg` client that lost its server emits `error` on the pool, which had no
listener. Every room shares the process, so each of these was an outage for all boards.
A CSV of 64 KB could also expand to gigabytes of strings and end the process with a heap
failure, which no handler can catch.

**Decision.**

- **Every socket has an `error` listener from the first line of the upgrade.** A protocol
  error is counted in `remo_ws_protocol_errors_total`; `ws` then closes that socket.
- **A frame is at most 16 MiB** (`maxPayload`). The default of 100 MiB is far above any
  edit. A client beyond the limit is closed with 1009.
- **Persistence called by y-websocket goes through one boundary**, `guardPersistence`.
  A room that failed to load closes its sockets with 1011 and refuses newcomers, because
  edits to an unbound document would never reach the log. The client's reconnect retries.
- **The projection is a mirror and cannot block a room.** Values of an unexpected shape
  are skipped, and a projection failure is logged while the room still opens.
- **A failed database call on a background path is logged and retried by the next pass.**
  Pools have an `error` listener. A log batch is at most 1000 updates, because a backlog
  from an outage must stay below the Postgres parameter limit.
- **Process guards are the last line, not the mechanism.** An unhandled rejection is
  logged and counted in `remo_background_failures_total`, and the service keeps serving:
  a rejected promise has not corrupted a call stack. An uncaught exception may have, so
  the service flushes its rooms for at most five seconds and exits with status 1 for the
  supervisor to restart it.
- **CSV output stops growing at the extraction limit**, before the strings exist.
- **`/auth/*` metric labels are a fixed list**, as ADR-109's boundary rule requires for
  any caller-controlled value that reaches a long-lived structure.

**Consequences.** A bad client loses its own socket and a database outage degrades saving
without ending the process; `pending` updates stay in memory and are retried. A failure
that used to be a visible restart is now a log line and a counter, so
`remo_background_failures_total` needs an alert: any non-zero rate is a bug to fix.

**Limits.** A backup larger than 16 MiB cannot be imported in one frame until the import
is split. There is still no cap on sockets per address or board, and awareness frames are
limited only by the frame size. A document of an unexpected shape no longer harms the
server, but the browser's `snapshot()` still has to be hardened separately.

## ADR-161: An organisation role needs a seat, and a guest never decides who gets in

**Status:** accepted (2026-11-03). Amends ADR-061, ADR-071 and ADR-109.

**Context.** A review found rights that outlived or exceeded their reason. `hasOrgRole`
read `admin_roles` without the seat, so a suspended or removed admin stayed an admin and
could restore themselves. Admin routes accepted any user id, so an account could suspend
a stranger from its own workspace and end all their sessions. An invitation reactivated a
suspended seat. Human task and change-set routes read board content without a current
board decision, which the bearer API already had. An editor or a guest editor could open a
board to the whole organisation, copy it into a board they own, or erase and forge every
comment through the backup grant. `spec/IAM-v1.md` already said a guest does not change
sharing, but the code did not enforce it.

**Decision.**

- **An organisation role counts only with an active member seat.** Removing a member
  removes their roles, and the last admin cannot be removed.
- **Admin routes act on members of that organisation only.** A role can be given only to
  an active member; it no longer creates a seat.
- **Suspension is scoped to the organisation.** It closes that organisation's boards and
  the person's sockets, but no longer revokes sessions, because a session is not owned by
  one organisation. This supersedes the "session ends" behaviour tested until now.
- **An invitation cannot lift a suspension.** Only `restore` can. A suspended seat refuses
  the invitation with `ORG_SUSPENDED` and leaves it pending.
- **A guest has no `board.share`, `board.manage`, `board.transfer` or `board.delete`,**
  whatever role a grant names, and cannot be granted `coowner`.
- **`org` is a management subject, like `team`.** Creating or removing it needs
  `board.manage`. ADR-109's rule that `board.share` suffices now covers user grants only.
- **Copying a board and importing a backup need `board.manage`.** Taking a backup still
  needs `board.backup`. ADR-071's separation of those two grants stands; import is now a
  management action because it replaces the discussion, including who said what.
- **Task and change-set routes take the same board decision as everything else.** A
  creator who lost the board gets 404. An organisation admin without a board role sees
  status metadata only and may cancel, because stopping spend is their job and reading the
  board is not.
- **An integration token works only on boards of its organisation.** Before, a member
  could mint one in their personal workspace and use it elsewhere, where no admin could
  see or revoke it.
- **The list of an organisation's apps needs an active seat.**
- **The link password limit reserves the attempt before `scrypt`**, as login does.

**Consequences.** Editors lose import and copy, and guests lose sharing; the interface
hides them. Existing `org` grants and guest `coowner` grants stay in the database: the
first still applies until a manager removes it, and the second acts without its management
capabilities. A suspended person stays signed in, sees their other organisations, and
gets `ORG_SUSPENDED` here.

**Limits.** The email binding of an invitation (ADR-109) does not stop the holder of a
leaked link from registering the invited address, because remo verifies no email and sends
no mail. For an address without an account, the link is effectively a bearer secret, as
the sharing guide must say. Closing this needs email verification, a separate decision.
Agents and their tokens still outlive the owner's seat (AG-07), and a legacy unclaimed
board can still be claimed without a token.

## ADR-162: A team can be renamed, deleted and staffed

**Status:** accepted (2026-11-04). Amends ADR-100 (organisations and teams) and ADR-161.

**Context.** A team was created and listed, and a board grant could name it, but there
was no way to rename it, delete it or put anyone in it. The only membership write was the
claim path, which made the claimant a team admin. A team grant therefore named a group
nobody could staff, and a mistyped team name was permanent.

**Decision.**

- **The organisation admin owns the team lifecycle.** Rename and delete a team, and add
  or remove a member, need `org_admin`; reading the member list needs an active seat.
- **A team name is unique inside its organisation.** A rename that collides answers
  `409 TEAM_NAME_TAKEN`; the database enforces it.
- **A team is not deleted while it is an access subject.** If a board names the team or a
  grant refers to it, the delete answers `409 TEAM_IN_USE` with the counts. The manager
  moves the boards and removes the grants first; there is no silent cascade.
- **Membership is an active seat plus a team role.** Only an active `member` of the
  organisation can be added, with `member` or `admin`; removing a direct membership
  removes the team grant's effect for that person. Team grants still decide the board
  role; membership only decides who inherits it.
- **The organisation name can be changed by an org admin.** The slug stays stable, so
  existing links and rooms keep working.

**Consequences.** A team becomes a real access subject: a manager can staff it, rename
it, and remove it once it is unused. Existing teams and memberships are unchanged; the
first rename or delete is the first write to the row since creation.

**Limits.** Only an org admin manages a team; a team admin cannot yet edit its own team.
Moving a board to another team is not part of this record. Deleting an organisation, or a
team that still has boards or grants, remains a deliberate manual operation.

## ADR-163: A person can change their display name

**Status:** accepted (2026-11-04). Part of the names work in issue #41.

**Context.** `users.name` was fixed when the account was created. The only editable name
was the local cursor name, which never reaches the account row, so a person could not fix
a typo in the name their teammates see. The names plan also raised uniqueness: a display
name is not a login, and two people can legitimately share a real name.

**Decision.**

- **`PATCH /auth/me { name }` changes the display name.** It needs a session, trims the
  value, accepts 1–80 characters, writes an `auth.profile_changed` audit row and returns
  the updated user.
- **The display name is not unique.** It is how a person is shown, not an identifier.
  A unique nickname is a separate `handle` field and needs its own decision; until then
  email remains the login and the only unique account key.
- **History keeps the name written at the time.** A comment stores its author name when
  it is written; renaming the account does not rewrite old comments. Presence, new
  comments and the current session show the new name.
- **The cursor name stays local.** A guest still names this browser; a signed-in cursor is
  named by the account (ADR-149).

**Consequences.** A person can correct their name from the account menu without
re-registering. Two accounts may share a display name, so the interface must not use it as
an identity key. The account menu keeps the local cursor name for guests.

**Limits.** No unique handle, no email change, no avatar, and no bulk rewrite of the names
stored on historical comments.
