import { Button, Checkbox, IconButton } from "@remo/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ABOUT } from "./about";
import { call } from "./apiCall";
import {
  supportConfig,
  supportIdentity,
  type SupportConfig,
  type SupportIdentity,
} from "./apiSupport";
import { clearClientErrors, recentClientErrors, type ClientError } from "./clientErrorBuffer";
import { roomFromUrl } from "./identity";
import { useI18n } from "./i18n";

/**
 * The support widget in an isolated frame (ADR-250, `spec/support.md` §2.2–§2.4).
 *
 * The operator's page never runs on the remo origin: it is a sandboxed iframe from one
 * configured origin, and everything the person chooses to share travels by `postMessage`
 * with that exact `targetOrigin`. Nothing here posts to `*`, so a page that replaced the
 * widget cannot receive it.
 *
 * There are three messages, and only three:
 *
 *   { type: "remo:support:identity",  identity }   the signed identity, on every load
 *   { type: "remo:support:technical", technical }  opt-in context, or null to withdraw
 *   { type: "remo:support:reset" }                 forget this person on sign-out
 *
 * `link` is not this component: the entry opens the operator's page in a new tab.
 */

/**
 * What the person agrees to attach. Names, room titles and room content are never part
 * of it — an operator who needs the room content asks, in the chat, like a person.
 */
export interface SupportTechnical {
  /** `version+build`, the same string `/support/identity` reports. */
  app: string;
  browser: string;
  os: string;
  lang: string;
  viewport: { width: number; height: number };
  /** The room id and this person's role in it; no title, no members, no content. */
  room: { id: string; role: string | null } | null;
  /** What `SyncLine` shows, so "it did not save" arrives with the answer. */
  connection: string;
  errors: readonly ClientError[];
}

/** A short "Chrome 141", not a user-agent dump the operator has to read. */
function browserName(userAgent: string): string {
  const families: Array<[string, RegExp]> = [
    ["Edge", /Edg\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Firefox", /Firefox\/(\d+)/],
    ["Chrome", /Chrome\/(\d+)/],
    ["Safari", /Version\/(\d+)[^)]*Safari/],
  ];
  for (const [name, pattern] of families) {
    const match = userAgent.match(pattern);
    if (match) return `${name} ${match[1]}`;
  }
  return "other";
}

function osName(userAgent: string): string {
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return "other";
}

/**
 * The connection as the header draws it. `SyncLine` is the one place that decides, so the
 * panel reads the state it rendered instead of inventing a second answer.
 */
function connectionState(): string {
  const node = document.querySelector(".save-state");
  const drawn = node?.getAttribute("data-state");
  if (drawn) return drawn;
  return navigator.onLine === false ? "offline" : "online";
}

/** The role in the open room, from the server's access answer — the same `effective()`. */
async function roomRole(room: string): Promise<string | null> {
  try {
    const answer = await call<{ access: { role: string | null } }>(
      `/boards/${encodeURIComponent(room)}/access`,
    );
    return answer.access.role ?? null;
  } catch {
    // A guest, a link visitor or a room that no longer exists: the id alone is still true.
    return null;
  }
}

async function technicalSnapshot(lang: string): Promise<SupportTechnical> {
  const room = roomFromUrl();
  return {
    app: `${ABOUT.version}+${ABOUT.build}`,
    browser: browserName(navigator.userAgent),
    os: osName(navigator.userAgent),
    lang,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    room: room ? { id: room, role: await roomRole(room) } : null,
    connection: connectionState(),
    errors: recentClientErrors(),
  };
}

/** The line above the chat: what is shared, and that the box starts empty (§2.4). */
function TechnicalToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="support-consent">
      <Checkbox
        label={t("support.technical")}
        hint={t("support.technicalHint")}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {checked && <span className="support-consent-note">{t("support.technicalGranted")}</span>}
    </div>
  );
}

export function SupportPanel({
  open,
  config,
  identity,
  failed,
  initialTechnical = false,
  resetSignal = 0,
  onClose,
}: {
  open: boolean;
  config: SupportConfig;
  identity: SupportIdentity | null;
  failed: boolean;
  /** The error screen offers the box already ticked: the person came here because of it. */
  initialTechnical?: boolean;
  /** Changes on sign-out; the frame is told to forget the person before it goes away. */
  resetSignal?: number;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const origin = config.origin ?? "";
  // `open` decides; `mounted` keeps the frame alive for one message after it closes.
  const [mounted, setMounted] = useState(open);
  const [technical, setTechnical] = useState(initialTechnical);
  const [loaded, setLoaded] = useState(false);
  const resetPending = useRef(false);
  const snapshot = useRef<SupportTechnical | null>(null);

  const post = useCallback(
    (message: unknown) => {
      if (!origin || !frame.current?.contentWindow) return;
      frame.current.contentWindow.postMessage(message, origin);
    },
    [origin],
  );

  const postIdentity = useCallback(() => {
    if (!identity) return;
    post({ type: "remo:support:identity", identity });
  }, [identity, post]);

  // The page may finish loading before the identity arrives, and the identity may arrive
  // before the page. Both paths post, and only to the configured origin.
  useEffect(() => {
    if (!open || !identity || !origin) return;
    postIdentity();
  }, [identity, open, origin, postIdentity]);

  // A new open starts from the entry point's default: off everywhere except the crash
  // screen, and a frame that has to load again before it can hear anything.
  useEffect(() => {
    if (!open) return;
    setTechnical(initialTechnical);
    setLoaded(false);
    snapshot.current = null;
  }, [initialTechnical, open]);

  /**
   * The consent, delivered when it can be. A message posted before the page loaded lands
   * in the initial `about:blank`, so the frame's `onLoad` is the signal to send.
   */
  useEffect(() => {
    if (!open || !loaded || !technical) return;
    let alive = true;
    void (async () => {
      const built = snapshot.current ?? (await technicalSnapshot(lang));
      snapshot.current = built;
      if (!alive || !technical) return;
      post({ type: "remo:support:technical", technical: built });
    })();
    return () => {
      alive = false;
    };
  }, [open, loaded, technical, lang, post]);

  // Declared before the close effect: on a sign-out both run in one commit, and the frame
  // must hear `reset` while it is still mounted.
  useEffect(() => {
    if (!resetSignal) return;
    resetPending.current = true;
    post({ type: "remo:support:reset" });
  }, [resetSignal, post]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (!resetPending.current) {
      setMounted(false);
      return;
    }
    // `postMessage` is queued: remove the frame in this task and the message dies with it.
    const timer = setTimeout(() => {
      resetPending.current = false;
      setMounted(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  const toggleTechnical = (checked: boolean) => {
    setTechnical(checked);
    // Answering "no" is also an answer: the widget drops what it was given.
    if (!checked && loaded) post({ type: "remo:support:technical", technical: null });
  };

  const onFrameLoad = () => {
    setLoaded(true);
    postIdentity();
  };

  if (!mounted || config.provider !== "chatwoot" || !origin) return null;

  return (
    <aside className="support-panel" aria-label={t("support.title")}>
      <header className="support-panel-head">
        <div className="support-panel-titles">
          <strong>{t("support.title")}</strong>
          <span className="support-panel-hours">{config.hours[lang]}</span>
        </div>
        <IconButton icon="close" size="compact" label={t("support.close")} onClick={onClose} />
      </header>
      <TechnicalToggle
        checked={technical}
        disabled={!identity}
        onChange={toggleTechnical}
      />
      <div className="support-panel-body">
        <iframe
          ref={frame}
          className="support-panel-frame"
          title={t("support.frameTitle")}
          src={`${origin}/widget.html?lang=${lang}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          allow="clipboard-write"
          onLoad={onFrameLoad}
        />
        {!identity && (
          <p className="support-panel-status">
            {failed ? t("support.error") : t("support.loading")}
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * The one way an entry point opens support (§2.4).
 *
 * A menu item, a help page link, a plan notice and the crash screen all ask the same
 * question — "is there support here, and what does opening it mean" — so they ask this
 * hook instead of repeating the switch. `link` opens the operator's page in a new tab;
 * `chatwoot` mounts the isolated frame and signs the person in.
 */
export interface SupportSurface {
  /** A provider answered. `false` while the answer is unknown, and in `none`. */
  available: boolean;
  /** The panel, or null; render it once, next to the entry. */
  panel: ReactNode;
  /** Open the surface; `technical` pre-ticks the consent box. */
  launch: (options?: { technical?: boolean }) => void;
  /** Sign-out: tell the widget to forget this person, then close. */
  signOut: () => void;
}

export function useSupportSurface({
  active = true,
  requireSession = false,
}: {
  /** A menu learns its entries when it opens; a page asks once it renders. */
  active?: boolean;
  /** The help centre is public: the entry needs a session (§2.4). */
  requireSession?: boolean;
} = {}): SupportSurface {
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<SupportIdentity | null>(null);
  const [failed, setFailed] = useState(false);
  const [initialTechnical, setInitialTechnical] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const configRef = useRef<SupportConfig | null>(null);
  const identityRef = useRef<SupportIdentity | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void (async () => {
      const resolved = await supportConfig().catch(() => null);
      if (!alive || !resolved || resolved.provider === "none") return;
      if (requireSession) {
        const signedIn = await call("/auth/me").then(
          () => true,
          () => false,
        );
        if (!alive || !signedIn) return;
      }
      configRef.current = resolved;
      setConfig(resolved);
    })();
    return () => {
      alive = false;
    };
  }, [active, requireSession]);

  const launch = useCallback((options?: { technical?: boolean }) => {
    const current = configRef.current;
    if (!current) return;
    if (current.provider === "link") {
      if (current.url) window.open(current.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (current.provider !== "chatwoot") return;
    setInitialTechnical(options?.technical === true);
    setOpen(true);
    if (identityRef.current) {
      // Reopening the panel reuses the identity it already has; the new frame asks for it.
      setIdentity(identityRef.current);
      setFailed(false);
      return;
    }
    setIdentity(null);
    setFailed(false);
    supportIdentity().then(
      (result) => {
        identityRef.current = result;
        setIdentity(result);
        setFailed(false);
      },
      () => {
        // The panel says it is unavailable; a refused sign-in is not a product failure.
        setFailed(true);
      },
    );
  }, []);

  const signOut = useCallback(() => {
    // The panel stays mounted for the `reset` message; `config` stays, the identity does
    // not: the next person in this browser starts as a stranger, with an empty buffer.
    setOpen(false);
    setResetSignal((value) => value + 1);
    identityRef.current = null;
    setIdentity(null);
    clearClientErrors();
  }, []);

  return {
    available: config?.provider === "chatwoot" || config?.provider === "link",
    panel:
      config && config.provider === "chatwoot" ? (
        <SupportPanel
          open={open}
          config={config}
          identity={identity}
          failed={failed}
          initialTechnical={initialTechnical}
          resetSignal={resetSignal}
          onClose={() => setOpen(false)}
        />
      ) : null,
    launch,
    signOut,
  };
}

/**
 * The entry as a button: the plan notice, the help centre and the crash screen.
 *
 * It renders nothing until a provider answers, so a `none` installation gains no pixels
 * (spec §9.1). The menu draws its own row, because a menu row is not a button.
 */
export function SupportEntryButton({
  active = true,
  requireSession = false,
  technical = false,
  variant = "secondary",
  className,
  children,
}: {
  active?: boolean;
  requireSession?: boolean;
  /** The crash screen opens the panel with the consent box already ticked. */
  technical?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  const support = useSupportSurface({ active, requireSession });
  return (
    <>
      {support.available && (
        <Button
          size="compact"
          variant={variant}
          className={className}
          onClick={() => support.launch({ technical })}
        >
          {children}
        </Button>
      )}
      {support.panel}
    </>
  );
}
