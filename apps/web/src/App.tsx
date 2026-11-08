import { BoardApp } from "./BoardApp";
import { WorkspaceHome } from "./WorkspaceHome";
import { roomFromUrl } from "./identity";
import { Contained } from "./ErrorBoundary";

/**
 * The room id selects the canvas. Invitation links start on the home route (ADR-179).
 *
 * `?room=` is a board; no room is the organisation home. Keeping the choice at the root
 * means the board never mounts on the home, and the home never opens a hidden room.
 */
export function App() {
  // The last line of defence (ADR-171): a render failure anywhere below shows a way out
  // instead of a blank page. Panels inside the room have their own, narrower boundary.
  const inviteToken = new URLSearchParams(window.location.search).get("invite");
  return (
    <Contained scope="room">
      {!inviteToken && roomFromUrl() ? <BoardApp /> : <WorkspaceHome inviteToken={inviteToken} />}
    </Contained>
  );
}
