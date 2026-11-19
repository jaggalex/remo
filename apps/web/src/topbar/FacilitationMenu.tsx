import { Button, Menu, type MenuItem } from "@remo/ui";
import { useI18n } from "../i18n";
import { REACTIONS } from "../reactions";
import { useMenuFocus } from "../useMenuFocus";

/**
 * "Facilitation ▾" — how the meeting is run: timer, voting, following along and the
 * reactions row (ADR-119, ADR-119, Ш2).
 *
 * One trigger replaces the separate voting button, the timer badge and the floating
 * emoji panel. A dot marks a running session so the state is visible without opening
 * the menu; the menu names it in words ("on · 00:17").
 */
export function FacilitationMenu({
  open,
  onOpen,
  canFacilitate,
  voteRunning,
  voteHint,
  timerRunning,
  timerHint,
  followers,
  onTimer,
  onVote,
  onFollow,
  onReact,
}: {
  open: boolean;
  onOpen: (value: boolean) => void;
  canFacilitate: boolean;
  voteRunning: boolean;
  voteHint: string;
  timerRunning: boolean;
  timerHint: string;
  followers: number;
  onTimer: () => void;
  onVote: () => void;
  onFollow: () => void;
  onReact: (emoji: string) => void;
}) {
  const { t } = useI18n();
  const anchor = useMenuFocus(open, true);
  const dot = voteRunning || timerRunning;

  const items: MenuItem[] = [
    {
      label: t("facilitation.timer.button"),
      icon: "timer",
      // A disabled row names who may do it, not just that nothing runs (§5.5).
      hint: !canFacilitate && !timerRunning ? t("facilitation.timer.readOnly") : timerHint,
      onSelect: onTimer,
    },
    {
      label: t("facilitation.vote.button"),
      icon: "vote",
      hint: !canFacilitate && !voteRunning ? t("facilitation.vote.readOnly") : voteHint,
      disabled: !canFacilitate && !voteRunning,
      onSelect: onVote,
    },
    {
      label: t("facilitation.follow.row"),
      icon: "eye",
      hint: followers ? t("follow.counter", { n: followers }) : t("facilitation.follow.none"),
      onSelect: onFollow,
    },
    { separator: true },
    { heading: t("reactions.title") },
  ];

  return (
    <span className="topbar-anchor" ref={anchor}>
      <Button
        variant="ghost"
        className={dot ? "facilitation-trigger is-live" : "facilitation-trigger"}
        iconEnd="chevron-down"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        {dot && <span className="topbar-dot" aria-hidden="true" />}
        {t("facilitation.menu")}
      </Button>
      {open && (
        <Menu label={t("facilitation.menu")} width={288} onClose={() => onOpen(false)} items={items}>
          <div className="menu-reactions" role="group" aria-label={t("reactions.title")}>
            {REACTIONS.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="menu-reaction"
                aria-label={t(reaction.key)}
                title={t(reaction.key)}
                onClick={() => {
                  onReact(reaction.emoji);
                  onOpen(false);
                }}
              >
                {reaction.emoji}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </span>
  );
}
