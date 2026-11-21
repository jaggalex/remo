import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox } from "@remo/ui";
import { billingApi } from "./apiBilling";
import { ApiError } from "./apiCall";
import { boardDirectory, type BoardTile } from "./boardDirectory";
import { useI18n } from "./i18n";

/**
 * "Active rooms": which rooms a plan keeps editable when the organisation holds more
 * rooms than the plan allows (ADR-247 §2.5, `spec/billing.md` §2.5, §8.1).
 *
 * The choice is a `PUT` of the active set; every other room becomes read-only, keeps its
 * content and still exports. The section appears for an owner whose organisation is over
 * the limit and behind a button otherwise — choosing is an act, not a permanent form.
 *
 * The room names come from the existing directory read model (`GET /boards?org=`), not a
 * second billing route: the owner already has that list on the home screen.
 */

/** The directory route caps a page at 60; a room list rarely needs more than one. */
const PAGE_SIZE = 60;
const MAX_PAGES = 20;

async function allRooms(orgSlug: string): Promise<BoardTile[]> {
  const first = await boardDirectory({
    org: orgSlug,
    sort: "updated",
    dir: "desc",
    page: 1,
    limit: PAGE_SIZE,
  });
  const rooms = [...first.boards];
  const pages = Math.min(Math.ceil(first.total / first.pageSize), MAX_PAGES);
  for (let page = 2; page <= pages; page += 1) {
    const next = await boardDirectory({
      org: orgSlug,
      sort: "updated",
      dir: "desc",
      page,
      limit: PAGE_SIZE,
    });
    rooms.push(...next.boards);
  }
  return rooms;
}

export function BillingRooms({
  orgId,
  orgSlug,
  limitsRooms,
  usageRooms,
  frozenRooms,
  isOrgAdmin,
  onSaved,
}: {
  orgId: string;
  /** The directory is addressed by slug; `null` until the organisation loads. */
  orgSlug: string | null;
  /** `null` is "no limit": there is nothing to choose. */
  limitsRooms: number | null;
  usageRooms: number;
  /** The server's explicit list; empty until the chooser has been used once. */
  frozenRooms: string[];
  isOrgAdmin: boolean;
  /** Re-read `GET /orgs/:id/billing` so the summary shows the saved state. */
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<BoardTile[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // A new organisation mounts a new section (`key={orgId}` in the panel): no state from
  // the previous organisation survives, including an open form.
  const over = limitsRooms !== null && usageRooms > limitsRooms;

  // Over the limit the owner is shown the choice; a plan without a room ceiling has none.
  useEffect(() => {
    if (limitsRooms === null) setOpen(false);
    else if (over && isOrgAdmin) setOpen(true);
  }, [isOrgAdmin, limitsRooms, over]);

  // Identity of the frozen list, not its array: every `read()` returns a new array with
  // the same contents, and that must not reload the list or reset the owner's ticks.
  const frozenKey = frozenRooms.join("|");
  const frozenSet = useMemo(
    () => new Set(frozenKey ? frozenKey.split("|") : []),
    [frozenKey],
  );

  useEffect(() => {
    if (!open || !orgSlug) return;
    let alive = true;
    setRooms(null);
    setListError(null);
    setSaveError(null);
    allRooms(orgSlug)
      .then((list) => {
        if (!alive) return;
        setRooms(list);
        // The server freezes the oldest rooms; its default set is the newest N. An
        // explicit frozen list wins once one exists.
        const active =
          frozenSet.size > 0
            ? list.filter((room) => !frozenSet.has(room.id)).map((room) => room.id)
            : list
                .slice(0, limitsRooms ?? list.length)
                .map((room) => room.id);
        setSelected(active);
      })
      .catch((failure: unknown) => {
        if (!alive) return;
        setListError(
          failure instanceof Error ? failure.message : t("billing.rooms.loadFailed"),
        );
      });
    return () => {
      alive = false;
    };
  }, [frozenSet, limitsRooms, open, orgSlug, t]);

  const toggle = useCallback((roomId: string, checked: boolean) => {
    setSaved(false);
    setSaveError(null);
    setSelected((current) =>
      checked ? [...current, roomId] : current.filter((id) => id !== roomId),
    );
  }, []);

  const save = useCallback(async () => {
    if (saving || limitsRooms === null) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await billingApi.setFrozenRooms(orgId, selected);
      setSaved(true);
      await onSaved();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      const status = failure instanceof ApiError ? failure.status : 0;
      setSaveError(
        t(
          code === "BAD_BOARD_LIST"
            ? "billing.rooms.badList"
            : code === "FORBIDDEN"
              ? "billing.rooms.forbidden"
              : status === 404
                ? "billing.rooms.gone"
                : "billing.failed",
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [limitsRooms, onSaved, orgId, saving, selected, t]);

  if (limitsRooms === null) return null;

  // A member cannot choose; over the limit they are told who can (§3.2).
  if (!isOrgAdmin) {
    return over ? (
      <p className="billing-warning">{t("billing.rooms.askOwner")}</p>
    ) : null;
  }

  const atLimit = selected.length >= limitsRooms;

  return (
    <section className="billing-rooms">
      <div className="billing-rooms-head">
        <h3>{t("billing.rooms.title")}</h3>
        {!open && (
          <Button size="compact" onClick={() => setOpen(true)}>
            {t(over ? "billing.rooms.choose" : "billing.rooms.change")}
          </Button>
        )}
      </div>
      <p className="muted">{t("billing.rooms.hint", { max: limitsRooms })}</p>

      {open && (
        <>
          {listError && <p className="auth-error">{listError}</p>}
          {saveError && (
            <p className="auth-error" role="alert">
              {saveError}
            </p>
          )}
          {rooms === null && !listError && <p className="muted">{t("billing.loading")}</p>}
          {rooms !== null && rooms.length === 0 && (
            <p className="muted">{t("billing.rooms.empty")}</p>
          )}

          {rooms !== null && rooms.length > 0 && (
            <>
              <ul className="billing-rooms-list">
                {rooms.map((room) => {
                  const checked = selected.includes(room.id);
                  return (
                    <li key={room.id}>
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atLimit}
                        label={room.title}
                        onChange={(event) => toggle(room.id, event.target.checked)}
                      />
                    </li>
                  );
                })}
              </ul>

              <p className="billing-rooms-count">
                {t("billing.rooms.counter", {
                  selected: selected.length,
                  max: limitsRooms,
                })}
              </p>
              {selected.length < limitsRooms && (
                <p className="billing-warning">
                  {t("billing.rooms.fewer", {
                    selected: selected.length,
                    max: limitsRooms,
                  })}
                </p>
              )}

              <div className="billing-actions">
                {/* Fewer than the ceiling is a deliberate choice (headroom), so the
                    warning above names the consequence instead of disabling Save; the
                    checkboxes themselves stop the selection at the limit. */}
                <Button
                  variant="primary"
                  disabled={saving || selected.length === 0}
                  onClick={() => void save()}
                >
                  {saving ? t("billing.rooms.saving") : t("billing.rooms.save")}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {t("billing.close")}
                </Button>
                {saved && (
                  <span className="billing-rooms-saved" role="status">
                    {t("billing.rooms.saved")}
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
