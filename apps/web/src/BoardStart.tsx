import type { Widget } from "@remo/model";
import { BoardStateLayer } from "./BoardOverlays";

/**
 * The start-of-room states: blocked, empty, denied or unclaimed (ADR-197).
 *
 * `BoardApp` was at the 800-line limit when the first-visit path arrived. The facts and
 * the callbacks are grouped here so the app composes the room instead of repeating the
 * state layer's ten props inline.
 */
export function BoardStart({
  state,
  onCreateNote,
  onCreateShape,
  onCreateText,
  onExample,
  onSignIn,
  onRetry,
  onClaim,
}: {
  state: {
    blocked: boolean;
    widgets: readonly Widget[];
    denied: boolean;
    unclaimed: boolean;
    reason: string | null | undefined;
    signedIn: boolean;
    boardId: string;
    readOnly: boolean;
  };
  onCreateNote: () => void;
  onCreateShape: () => void;
  onCreateText: () => void;
  onExample: () => void;
  onSignIn: () => void;
  onRetry: () => void;
  onClaim: () => void;
}) {
  return (
    <BoardStateLayer
      blocked={state.blocked}
      emptyRoom={!state.denied && state.widgets.length === 0 ? state.boardId : null}
      denied={state.denied}
      unclaimed={state.unclaimed}
      reason={state.reason}
      signedIn={state.signedIn}
      boardId={state.boardId}
      readOnly={state.readOnly}
      onCreateNote={onCreateNote}
      onCreateShape={onCreateShape}
      onCreateText={onCreateText}
      onExample={onExample}
      onSignIn={onSignIn}
      onRetry={onRetry}
      onClaim={onClaim}
    />
  );
}
