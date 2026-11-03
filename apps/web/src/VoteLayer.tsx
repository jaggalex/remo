import { useMemo } from "react";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Button, Icon } from "@remo/ui";
import type { VoteSession } from "./api";
import { placementOfCard } from "./canvasGeometry";
import { useI18n } from "./i18n";
import { useNow } from "./useNow";
import { connectorLabelBoxes, objectBoxes, screenBox, type Box } from "./vote/chipPlacement";
import { VoteChip } from "./vote/VoteChip";
import { objectLabel } from "./vote/voteLabels";
import { sameDeadline } from "./vote/voteModel";

/**
 * Voting on the board itself (ADR-117).
 *
 * The panel manages a session; voting happens where the objects are. Every object in
 * scope carries a counter chip anchored to its bottom-right corner, and one line above
 * the board says how it is going and opens the panel. The line is the only counter above
 * the canvas: the panel speaks about the quota in words, never as a second number.
 *
 * The chip never counts votes: it renders the server aggregate and asks the app to cast
 * or withdraw one. When the clock reaches zero the controls go away at once — a vote cast
 * against an ended session is refused by the server, and the board must not offer it.
 * An ended session keeps its numbers on the objects until the results are published.
 *
 * The bar also names the mode of an open session: the results will show who voted, and a
 * participant who never opens the panel still learns it before voting (ADR-126).
 */
export function VoteLayer({
  session,
  widgets,
  layouts,
  camera,
  viewport,
  busy,
  offset,
  timerEndsAt,
  meId,
  labels,
  onVote,
  onWithdraw,
  onOpen,
}: {
  session: VoteSession | null;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  camera: Camera;
  viewport: { width: number; height: number };
  busy: boolean;
  offset: number;
  /** The board's shared timer, when it runs: a session pinned to it ends with it. */
  timerEndsAt: string | null;
  /** Whose screen this is: the leader reads "you lead" instead of their own name. */
  meId: string | null;
  /** How the board draws connector labels: the chip must not cover one. */
  labels: { fontFamily: string; stubMax: number; stubRatio: number };
  onVote: (objectId: string) => void;
  onWithdraw: (objectId: string) => void;
  onOpen: () => void;
}) {
  const { t, typeName } = useI18n();
  const live = session?.state === "open";
  const now = useNow(live, session?.endsAt ?? "");
  const clock = now + offset;
  const left = session?.endsAt ? Math.max(0, new Date(session.endsAt).getTime() - clock) : null;
  /** The floating rail owns this strip; a chip never slides under it. */
  const railReserve = useMemo(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--toolbar-width")
      .trim();
    return (Number.parseFloat(raw) || 48) + 12;
  }, []);
  const running = Boolean(session) && live && (left === null || left > 0);
  /** An ended session stays on the bar until its results are published. */
  const showResult = Boolean(session) && !running && !session?.publishedAt;
  const pinnedToTimer = sameDeadline(session?.endsAt ?? null, timerEndsAt);

  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);

  /** A session is on screen: a running one, or an ended one whose results are pending. */
  const visible = Boolean(session) && (running || showResult);

  /** A card is drawn where its kanban put it, not where it was created (ADR-113). */
  const resolve = useMemo(() => {
    return (id: string): Widget | undefined => {
      const widget = byId.get(id);
      if (!widget) return undefined;
      const card = widget.type === "card" ? placementOfCard(layouts, widget.id) : null;
      return card ? { ...widget, ...card } : widget;
    };
  }, [byId, layouts]);

  /**
   * Connector labels in world units, measured once per document rather than once per
   * camera frame: a pan must not re-measure every label on the board.
   */
  const labelWorld = useMemo(
    () =>
      visible
        ? connectorLabelBoxes({
            widgets,
            resolve,
            stubs: { max: labels.stubMax, ratio: labels.stubRatio },
            fontFamily: labels.fontFamily,
          })
        : [],
    [visible, widgets, resolve, labels.stubMax, labels.stubRatio, labels.fontFamily],
  );

  /**
   * What the chips stand on, once per frame: every object's plate and every connector
   * label, both in screen pixels. A chip never covers either (spec §10.3). Without a
   * session nothing is measured, so an idle board pays nothing for this layer.
   */
  const { plates, labelPlates } = useMemo(
    () => ({
      plates: visible ? objectBoxes(widgets, resolve, camera, viewport) : [],
      labelPlates: labelWorld.map((box) => screenBox(box, camera, viewport)),
    }),
    [visible, widgets, resolve, camera, viewport, labelWorld],
  );

  if (!session || !visible) return null;

  const countFor = (id: string) =>
    session.votes.find((row) => row.object_id === id)?.votes ?? 0;

  const labelFor = (widget: Widget | undefined, id: string) =>
    objectLabel(id, widget, {
      typeName,
      unnamed: (tail) => t("facilitation.vote.unnamed", { name: tail }),
    });

  /** An object that left the canvas has no counter to show; a half-visible one keeps it. */
  const onCanvas = (box: Box) =>
    box.x < viewport.width && box.x + box.width > 0 && box.y < viewport.height && box.y + box.height > 0;

  return (
    <>
      <Button
        variant="secondary"
        className={`vote-board-bar${running ? "" : " ended"}`}
        onClick={onOpen}
      >
        <span className="vote-board-dot" aria-hidden="true" />
        <strong>
          {running ? t("facilitation.vote.barRunning") : t("facilitation.vote.boardEnded")}
        </strong>
        {running ? (
          <>
            {left !== null && <span className="vote-board-clock">{formatClock(left)}</span>}
            {pinnedToTimer && (
              <span className="vote-board-hint">{t("facilitation.vote.withTimer")}</span>
            )}
            {/* The mode without opening the panel: the start form promised it, the
                results will show names (ADR-126). */}
            {!session.anonymous && (
              <span className="vote-board-hint">{t("facilitation.vote.openBar")}</span>
            )}
            <span>
              {t("facilitation.vote.youHave", {
                left: session.remaining,
                total: session.votesPerSubject,
              })}
            </span>
            {session.createdBy || session.createdByName ? (
              <span className="vote-board-lead">
                {session.createdBy && session.createdBy === meId
                  ? t("facilitation.vote.youLead")
                  : t("facilitation.vote.leadBy", { name: session.createdByName })}
              </span>
            ) : null}
          </>
        ) : (
          <span>{t("facilitation.vote.barUnpublished")}</span>
        )}
        <span className="vote-board-go">
          {running ? t("facilitation.vote.manage") : t("facilitation.vote.results")}
          <Icon name="chevron-right" size={14} />
        </span>
      </Button>

      {session.objectIds.map((id) => {
        const widget = byId.get(id);
        const plate = plates.find((row) => row.id === id);
        if (!widget || !plate || !onCanvas(plate.box)) return null;
        const obstacles = [
          ...labelPlates,
          ...plates.filter((row) => row.id !== id).map((row) => row.box),
        ];
        return (
          <VoteChip
            key={id}
            id={id}
            object={plate.box}
            votes={countFor(id)}
            mine={running && session.myObjectIds.includes(id)}
            running={running}
            remaining={session.remaining}
            busy={busy}
            label={labelFor(widget, id)}
            viewport={viewport}
            obstacles={obstacles}
            leftInset={railReserve}
            onVote={onVote}
            onWithdraw={onWithdraw}
          />
        );
      })}
    </>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
