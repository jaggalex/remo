import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./apiCall";
import { billingApi, type OrgBilling } from "./apiBilling";

/**
 * Does this organisation have a plan screen, and what does it say? (ADR-247 §8.)
 *
 * `REMO_BILLING=off` makes the whole billing family answer `404`; the tab must then not
 * exist. Any other failure keeps the tab — the panel reports it — because a broken read
 * is not the same fact as a feature that is switched off.
 */
export function useOrgBilling(orgId: string | null, open: boolean) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [seed, setSeed] = useState<OrgBilling | null>(null);

  useEffect(() => {
    setAvailable(null);
    setSeed(null);
    if (!open || !orgId) return;
    let alive = true;
    billingApi
      .org(orgId)
      .then((summary) => {
        if (!alive) return;
        setSeed(summary);
        setAvailable(true);
      })
      .catch((failure: unknown) => {
        if (!alive) return;
        setAvailable(!(failure instanceof ApiError && failure.status === 404));
      });
    return () => {
      alive = false;
    };
  }, [open, orgId]);

  const unavailable = useCallback(() => {
    setSeed(null);
    setAvailable(false);
  }, []);

  return { available, seed, unavailable };
}
