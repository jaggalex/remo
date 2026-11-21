/**
 * EN strings — the support entry, the isolated widget and the opt-in context
 * (ADR-250, `spec/support.md` §2).
 *
 * The waiting text is not here: the server sends it from `REMO_SUPPORT_HOURS`, because it
 * is an operational statement about this installation rather than interface copy.
 */
export const enSupport = {
  "support.menu": "Help and support",
  "support.title": "Help and support",
  "support.close": "Close support",
  "support.frameTitle": "Support chat",
  "support.loading": "Opening the support chat…",
  "support.error": "Support is unavailable right now. Try again in a minute.",
  /** The crash screen: a report with the error already in hand. */
  "support.reportBug": "Report a problem",
  /** The help centre header. Shown only to a signed-in person. */
  "support.write": "Write to support",
  /** Beside a plan limit: the person's question is about money, not about the screen. */
  "support.planQuestion": "Questions about your plan?",
  "support.technical": "Attach technical information",
  "support.technicalHint":
    "Version, browser, the last errors, and this room's id with your role. The room's name and content are not sent.",
  "support.technicalGranted": "Shared with the support chat only. It never reaches remo's servers.",
};
