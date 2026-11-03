import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { guestIdentity, saveIdentity, type Identity } from "./identity";

/**
 * How the cursor name follows the account (ADR-149).
 *
 * A guest is named by this browser; a signed-in person is named by the account, so two
 * windows of one account are one participant in presence. `?user=` keeps its explicit
 * override for tests and screenshots. The guest name is kept aside for sign-out.
 */
export function useCursorIdentity({
  accountName,
  setIdentity,
}: {
  accountName: string | null | undefined;
  setIdentity: Dispatch<SetStateAction<Identity>>;
}) {
  useEffect(() => {
    const account = accountName?.trim();
    if (!account) return;
    setIdentity((current) => {
      if (current.override || current.name === account) return current;
      const next = { ...current, name: account };
      saveIdentity(next);
      return next;
    });
  }, [accountName, setIdentity]);

  /** A guest names this browser; the account name is not editable here. */
  const renameSelf = useCallback(
    (name: string) => {
      setIdentity((current) => {
        const next = { ...current, name, guestName: name };
        saveIdentity(next);
        return next;
      });
    },
    [setIdentity],
  );

  /** Signing out returns this browser to its guest name, not the account's. */
  const forgetAccountName = useCallback(() => {
    setIdentity((current) => {
      const next = guestIdentity(current);
      saveIdentity(next);
      return next;
    });
  }, [setIdentity]);

  return { renameSelf, forgetAccountName };
}
