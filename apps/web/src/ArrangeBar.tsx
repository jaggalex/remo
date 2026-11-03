import { Button, IconButton, Menu, Popover } from "@remo/ui";
import type { AlignEdge, DistributeAxis } from "@remo/doc";
import { useI18n } from "./i18n";
import { useMenuFocus } from "./useMenuFocus";
import { usePopover } from "./usePopover";
import { ObjectBar } from "./object-panel/ObjectBar";
import { ColorGridSection, ColorWindow } from "./object-panel/ColorWindow";
import { colorName, isTransparent } from "./object-panel/colorWindowData";
import { PanelWindow } from "./object-panel/PanelWindow";

export interface ArrangeBarTarget {
  /** Where the bar itself goes, already clamped to the canvas. */
  placement: { left: number; top: number };
  /** How many things will move; a group counts once. */
  units: number;
  /** How many objects are selected — the number "Delete" names. */
  objects: number;
  /** At least two movable units: only then do align and distribute apply. */
  canArrange: boolean;
  /** The selection in types, for "4 objects · 3 notes, 1 shape". */
  types: Array<{ type: string; count: number }>;
  /** The one colour role every selected object has, or null when they share none. */
  colour: { role: "fill" | "line"; value: string; mixed: boolean } | null;
}

export interface ArrangeBarActions {
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
  group: () => void;
  ungroup: () => void;
  /** Delete from "More" — the same path as the Delete key, confirmation included. */
  remove: () => void;
  /** Two or more roots can become one group (the command registry's predicate). */
  canGroup: boolean;
  /** Something in the selection already belongs to a group. */
  canUngroup: boolean;
  /** Open the tidy preview for the selection (ADR-143). */
  tidy: () => void;
  /** Narrow the selection to one type; `null` restores the selection before narrowing. */
  selectType: (type: string | null) => void;
  /** Write the shared role to every selected object: one transaction, one undo step. */
  setColour: (color: string) => void;
}

const ALIGN = [
  { edge: "left", key: "arrange.left" },
  { edge: "centerX", key: "arrange.centerX" },
  { edge: "right", key: "arrange.right" },
  { edge: "top", key: "arrange.top" },
  { edge: "middle", key: "arrange.middle" },
  { edge: "bottom", key: "arrange.bottom" },
] as const satisfies ReadonlyArray<{ edge: AlignEdge; key: string }>;

const DISTRIBUTE = [
  { axis: "horizontal", key: "arrange.distributeH" },
  { axis: "vertical", key: "arrange.distributeV" },
] as const satisfies ReadonlyArray<{ axis: DistributeAxis; key: string }>;

/**
 * The arrange bar.
 *
 * Appears above a multi-selection: what is selected in words and by type (with a menu
 * that narrows to one type), the one colour role every selected object shares — "≠ Mixed"
 * when they disagree — the six alignments and two distributions behind one "Align"
 * popover, grouping, and "More", where Delete lives after a separator with the count
 * (ADR-120, ADR-124).
 *
 * Buttons, popover and menu come from `@remo/ui`. Icons rather than words for the eight
 * arrangements: eight labels would be wider than the selection, and the tooltips say the
 * rest (ADR-036).
 */
export function ArrangeBar({
  target,
  actions,
}: {
  target: ArrangeBarTarget | null;
  actions: ArrangeBarActions;
}) {
  const { t, count, typeCount } = useI18n();
  // A different selection closes whatever was open for the previous one.
  const { open, setOpen, ref } = usePopover<"types" | "align" | "colour" | "more">(
    target ? `${target.objects}:${target.units}` : undefined,
  );
  // The DS menu expects something focused inside it, and focus comes back to its button
  // on close, so Escape does not drop a keyboard user at the top of the page.
  const typesRef = useMenuFocus(open, "types");
  const moreRef = useMenuFocus(open, "more");

  if (!target) return null;

  const summary = `${count("objects", target.objects)} · ${target.types
    .map((entry) => typeCount(entry.type, entry.count))
    .join(", ")}`;
  const colourRole = target.colour
    ? target.colour.role === "line"
      ? t("line.colour")
      : t("object.fill")
    : "";
  const colourRoleKind = target.colour?.role === "fill" ? "fill" : "stroke";
  const colourValue = target.colour
    ? target.colour.mixed
      ? t("color.mixed")
      : t(colorName(target.colour.value, { role: colourRoleKind }).key)
    : "";

  return (
    <ObjectBar
      ref={ref}
      placement={target.placement}
      label={t("canvas.selected", { count: target.objects })}
      className="arrange-bar"
    >
      {/* What is selected, and a way to keep just one type of it (ADR-120 §4.2). */}
      <span className="sb-anchor" ref={typesRef}>
        <Button
          variant="ghost"
          size="compact"
          iconEnd="chevron-down"
          aria-label={`${t("arrange.types")}: ${summary}`}
          aria-haspopup="menu"
          aria-expanded={open === "types"}
          onClick={() => setOpen(open === "types" ? null : "types")}
        >
          {summary}
        </Button>
        {open === "types" && (
          <PanelWindow>
            <Menu
              label={t("arrange.types")}
              width={240}
              onClose={() => setOpen(null)}
              items={[
                ...target.types.map((entry) => ({
                  label: typeCount(entry.type, entry.count),
                  onSelect: () => {
                    actions.selectType(entry.type);
                    setOpen(null);
                  },
                })),
                { separator: true as const },
                {
                  label: t("arrange.all"),
                  onSelect: () => {
                    actions.selectType(null);
                    setOpen(null);
                  },
                },
              ]}
            />
          </PanelWindow>
        )}
      </span>

      {target.colour && (
        <span className="sb-anchor">
          <Button
            variant="ghost"
            size="compact"
            className="sb-colour sb-multi-colour"
            iconEnd="chevron-down"
            aria-label={`${colourRole}: ${colourValue}`}
            aria-haspopup="dialog"
            aria-expanded={open === "colour"}
            selected={open === "colour"}
            onClick={() => setOpen(open === "colour" ? null : "colour")}
          >
            <span className="sb-role-label">{colourRole}</span>
            <span
              className={
                target.colour.mixed
                  ? "sb-multi-swatch is-mixed"
                  : isTransparent(target.colour.value)
                    ? "sb-multi-swatch checkerboard"
                    : "sb-multi-swatch"
              }
              style={
                target.colour.mixed || isTransparent(target.colour.value)
                  ? undefined
                  : { background: target.colour.value }
              }
              aria-hidden="true"
            >
              {target.colour.mixed ? "≠" : null}
            </span>
          </Button>
          {open === "colour" && (
            <ColorWindow title={colourRole} onClose={() => setOpen(null)}>
              <ColorGridSection
                ariaLabel={colourRole}
                levels={target.colour.role === "fill" ? [100, 300] : [600]}
                value={target.colour.value}
                mixed={target.colour.mixed}
                role={colourRoleKind}
                onPick={actions.setColour}
                showKeys
              />
            </ColorWindow>
          )}
        </span>
      )}

      <span className="sb-divider" aria-hidden="true" />

      <span className="sb-anchor">
        <Button
          variant="secondary"
          size="compact"
          iconEnd="chevron-down"
          aria-label={t("arrange.title")}
          aria-haspopup="dialog"
          aria-expanded={open === "align"}
          disabled={!target.canArrange}
          onClick={() => setOpen(open === "align" ? null : "align")}
        >
          {t("arrange.title")}
        </Button>
        {open === "align" && (
          <PanelWindow>
            <Popover
              title={t("arrange.title")}
              width={240}
              onClose={() => setOpen(null)}
            >
              <div className="arrange-grid" role="group" aria-label={t("arrange.alignment")}>
                {ALIGN.map(({ edge, key }) => (
                  <Button
                    key={edge}
                    variant="ghost"
                    size="compact"
                    className="arrange-button"
                    aria-label={t(key)}
                    title={t(key)}
                    onClick={() => actions.align(edge)}
                  >
                    <AlignGlyph edge={edge} />
                  </Button>
                ))}
              </div>
              <div className="arrange-grid" role="group" aria-label={t("arrange.distribution")}>
                {DISTRIBUTE.map(({ axis, key }) => (
                  <Button
                    key={axis}
                    variant="ghost"
                    size="compact"
                    className="arrange-button"
                    aria-label={t(key)}
                    title={t(key)}
                    disabled={target.units < 3}
                    onClick={() => actions.distribute(axis)}
                  >
                    <DistributeGlyph axis={axis} />
                  </Button>
                ))}
              </div>
            </Popover>
          </PanelWindow>
        )}
      </span>

      <Button variant="ghost" size="compact" onClick={actions.tidy}>
        {t("tidy.action")}
      </Button>

      {actions.canGroup && (
        <Button variant="ghost" size="compact" onClick={actions.group}>
          {t("menu.group")}
        </Button>
      )}
      {actions.canUngroup && (
        <Button variant="ghost" size="compact" onClick={actions.ungroup}>
          {t("menu.ungroup")}
        </Button>
      )}

      <span className="sb-divider" aria-hidden="true" />

      {/* Delete lives here and nowhere else on the bar, after a separator (ADR-120). */}
      <span className="sb-more" ref={moreRef}>
        <IconButton
          icon="more"
          size="compact"
          label={t("arrange.more")}
          aria-expanded={open === "more"}
          selected={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        />
        {open === "more" && (
          <PanelWindow>
            <Menu
              label={t("arrange.more")}
              onClose={() => setOpen(null)}
              items={[
                { separator: true },
                {
                  label: t("menu.delete"),
                  icon: "trash",
                  hint: count("objects", target.objects),
                  danger: true,
                  onSelect: () => {
                    actions.remove();
                    setOpen(null);
                  },
                },
              ]}
            />
          </PanelWindow>
        )}
      </span>
    </ObjectBar>
  );
}

function AlignGlyph({ edge }: { edge: AlignEdge }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {edge === "left" && (
        <>
          <line x1="3" y1="2" x2="3" y2="14" />
          <rect x="5" y="3.5" width="8" height="3" />
          <rect x="5" y="9.5" width="5" height="3" />
        </>
      )}
      {edge === "centerX" && (
        <>
          <line x1="8" y1="2" x2="8" y2="14" />
          <rect x="3" y="3.5" width="10" height="3" />
          <rect x="5" y="9.5" width="6" height="3" />
        </>
      )}
      {edge === "right" && (
        <>
          <line x1="13" y1="2" x2="13" y2="14" />
          <rect x="3" y="3.5" width="8" height="3" />
          <rect x="6" y="9.5" width="5" height="3" />
        </>
      )}
      {edge === "top" && (
        <>
          <line x1="2" y1="3" x2="14" y2="3" />
          <rect x="3.5" y="5" width="3" height="8" />
          <rect x="9.5" y="5" width="3" height="5" />
        </>
      )}
      {edge === "middle" && (
        <>
          <line x1="2" y1="8" x2="14" y2="8" />
          <rect x="3.5" y="3" width="3" height="10" />
          <rect x="9.5" y="5" width="3" height="6" />
        </>
      )}
      {edge === "bottom" && (
        <>
          <line x1="2" y1="13" x2="14" y2="13" />
          <rect x="3.5" y="3" width="3" height="8" />
          <rect x="9.5" y="6" width="3" height="5" />
        </>
      )}
    </svg>
  );
}

function DistributeGlyph({ axis }: { axis: DistributeAxis }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {axis === "horizontal" ? (
        <>
          <rect x="2" y="5" width="2" height="6" />
          <rect x="7" y="3" width="2" height="10" />
          <rect x="12" y="5" width="2" height="6" />
        </>
      ) : (
        <>
          <rect x="5" y="2" width="6" height="2" />
          <rect x="3" y="7" width="10" height="2" />
          <rect x="5" y="12" width="6" height="2" />
        </>
      )}
    </svg>
  );
}
