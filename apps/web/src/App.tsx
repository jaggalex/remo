import { BoardApp } from "./BoardApp";
import { WorkspaceHome } from "./WorkspaceHome";
import { roomFromUrl } from "./identity";
import { Contained } from "./ErrorBoundary";

/**
 * Two screens, one address contract (ADR-168).
 *
 * `?room=` is a board; no room is the organisation home. Keeping the choice at the root
 * means the board never mounts on the home, and the home never opens a hidden room.
 */
export function App() {
  // The last line of defence (ADR-171): a render failure anywhere below shows a way out
  // instead of a blank page. Panels inside the room have their own, narrower boundary.
  return <Contained scope="room">{roomFromUrl() ? <BoardApp /> : <WorkspaceHome />}</Contained>;
}
