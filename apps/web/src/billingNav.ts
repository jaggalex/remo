/**
 * "Open the billing tab" as one message between screens that do not own each other.
 *
 * A `402` can arrive in the export dialog, the room header or the create-room dialog,
 * while the organisation screen lives in another branch of the tree. The event carries
 * the organisation it is about; the listener (`BoardPanels`, the home) opens the one
 * `OrganisationDialog` that already exists, rather than mounting a second billing screen.
 */
type Listener = (orgId: string | null) => void;

const listeners = new Set<Listener>();

export function requestBillingTab(orgId: string | null): void {
  for (const listener of listeners) listener(orgId);
}

export function onBillingTabRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
