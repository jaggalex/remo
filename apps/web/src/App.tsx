import { BoardApp } from "./BoardApp";
import { WorkspaceHome } from "./WorkspaceHome";
import { roomFromUrl } from "./identity";

/**
 * Two screens, one address contract (ADR-168).
 *
 * `?room=` is a board; no room is the organisation home. Keeping the choice at the root
 * means the board never mounts on the home, and the home never opens a hidden room.
 */
export function App() {
  return roomFromUrl() ? <BoardApp /> : <WorkspaceHome />;
}
