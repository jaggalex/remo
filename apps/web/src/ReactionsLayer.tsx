import { useEffect, useRef, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { placementOfCard } from "./canvasGeometry";

interface Burst {
  key: string;
  emoji: string;
  x: number;
  y: number;
}

/**
 * Live reactions (ADR-104 amendment): a transient awareness signal, not a record.
 *
 * Six emoji, no counters, no database and no backup entry. The picker is a row in the
 * facilitation menu (ADR-119, П1); this layer only turns a choice and
 * incoming awareness into bursts. A burst is placed at the sender's cursor when one is
 * available, otherwise at the centre of the view.
 */
export function ReactionsLayer({
  connection,
  presence,
  camera,
  viewport,
  widgets,
  selectedIds,
  layouts,
  request,
}: {
  connection: BoardConnection | null;
  presence: Presence[];
  camera: Camera;
  viewport: { width: number; height: number };
  widgets: Widget[];
  selectedIds: readonly string[];
  layouts: Map<string, KanbanLayout>;
  /** The last emoji picked in the menu; `at` makes a repeated pick a new burst. */
  request: { emoji: string; at: number } | null;
}) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seen = useRef(new Map<string, number>());

  useEffect(() => {
    const incoming = presence
      .filter((peer) => peer.reaction)
      .filter((peer) => (seen.current.get(peer.sessionKey) ?? 0) < peer.reaction!.at);
    if (!incoming.length) return;
    const next = incoming.map((peer) => {
      seen.current.set(peer.sessionKey, peer.reaction!.at);
      const target = peer.reaction!;
      const point =
        Number.isFinite(target.x) && Number.isFinite(target.y)
          ? { x: target.x!, y: target.y! }
          : peer.cursor;
      const x = point
        ? viewport.width / 2 + (point.x - camera.x) * camera.zoom
        : viewport.width / 2;
      const y = point
        ? viewport.height / 2 + (point.y - camera.y) * camera.zoom
        : viewport.height / 2;
      return {
        key: `${peer.sessionKey}:${peer.reaction!.at}`,
        emoji: peer.reaction!.emoji,
        x,
        y,
      };
    });
    setBursts((current) => [...current, ...next]);
    const timer = window.setTimeout(() => {
      setBursts((current) => current.filter((burst) => !next.some((n) => n.key === burst.key)));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [camera.x, camera.y, camera.zoom, presence, viewport.height, viewport.width]);

  // The person's own pick travels as awareness, so every screen bursts the same emoji.
  useEffect(() => {
    if (!request) return;
    // A reaction belongs to the selected object, not to the middle of the screen.
    const selected = selectedIds.length === 1
      ? widgets.find((widget) => widget.id === selectedIds[0])
      : undefined;
    let point: { x: number; y: number } | null = null;
    if (selected) {
      const placement =
        selected.type === "card" ? placementOfCard(layouts, selected.id) : null;
      point = placement
        ? { x: placement.x, y: placement.y }
        : { x: selected.x, y: selected.y };
    }
    connection?.awareness?.setLocalStateField("reaction", {
      emoji: request.emoji,
      at: Date.now(),
      ...(point ? { x: point.x, y: point.y } : {}),
    });
    // One effect per pick: `at` is the identity of the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return (
    <div className="reactions-layer" aria-hidden="true">
      {bursts.map((burst) => (
        <span
          key={burst.key}
          className="reaction-burst"
          style={{ left: burst.x, top: burst.y }}
        >
          {burst.emoji}
        </span>
      ))}
    </div>
  );
}
