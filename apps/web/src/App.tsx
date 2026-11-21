import { BoardApp } from "./BoardApp";
import { FakePaymentPage } from "./FakePaymentPage";
import { WorkspaceHome } from "./WorkspaceHome";
import { roomFromUrl } from "./identity";
import { readMailLinks } from "./mailLinks";
import { Contained } from "./ErrorBoundary";

/**
 * The room id selects the canvas. Invitation links start on the home route (ADR-179).
 *
 * `?room=` is a board; no room is the organisation home. Keeping the choice at the root
 * means the board never mounts on the home, and the home never opens a hidden room.
 * Mail links (`?forgot`, `?reset`, `?verify`) also belong to the home; a room still wins.
 */
export function App() {
  // The last line of defence (ADR-171): a render failure anywhere below shows a way out
  // instead of a blank page. Panels inside the room have their own, narrower boundary.
  const params = new URLSearchParams(window.location.search);
  const fakePay = params.get("fake_pay");
  const inviteToken = params.get("invite");
  const mail = readMailLinks();

  // The fake provider's redirect lands before any workspace: completing a test payment
  // must not mount a room, and a stale `?room=` in the address must not win.
  if (fakePay) {
    return (
      <Contained scope="room">
        <FakePaymentPage paymentId={fakePay} />
      </Contained>
    );
  }

  return (
    <Contained scope="room">
      {!inviteToken && roomFromUrl() ? (
        <BoardApp />
      ) : (
        <WorkspaceHome inviteToken={inviteToken} mail={mail} />
      )}
    </Contained>
  );
}
