/**
 * Who you are in the room.
 *
 * A guest is a display name plus a colour, kept in localStorage so it survives a
 * reload. A signed-in person is named by the account instead; the guest name is kept
 * aside and returns on sign-out (ADR-149). `?user=Name` names one tab explicitly so a
 * test or a screenshot can show two people without a second account.
 */
export interface Identity {
  name: string;
  color: string;
  /** The name this browser uses when nobody is signed in. */
  guestName?: string;
  /** `?user=` chose this tab's name, even for a signed-in account. */
  override?: boolean;
}

const COLORS = [
  "#2d9bf0",
  "#8fd14f",
  "#ff9f4c",
  "#9510ac",
  "#f24726",
  "#00b8a9",
  "#e598b2",
];

const STORAGE_KEY = "remo.identity";

function randomName(): string {
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `Guest ${suffix}`;
}

export function loadIdentity(): Identity {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("user");

  let stored: Identity | null = null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Identity;
  } catch {
    stored = null;
  }

  // `stored.name` from before this record was always the guest name.
  const guestName = stored?.guestName ?? stored?.name ?? randomName();
  const identity: Identity = {
    name: fromQuery ?? guestName,
    guestName,
    color: stored?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]!,
    override: Boolean(fromQuery),
  };

  saveIdentity(identity);
  return identity;
}

/** Browse without carrying a test override or an account name into the next reload. */
export function guestIdentity(identity: Identity): Identity {
  return { ...identity, name: identity.guestName ?? randomName(), override: false };
}

export function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* private mode — identity simply does not persist */
  }
}

/** The room in the address, or null on the organisation home (ADR-168). */
export function roomFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("room");
}

/** Room name, overridable with `?room=` for parallel experiments. */
export function currentRoom(fallback = "board-main"): string {
  return roomFromUrl() ?? fallback;
}

/**
 * Where the sync service lives.
 *
 * Default is the app's own origin: the dev server proxies `/sync` (websockets
 * included) to the sync service, so a teammate on another machine needs exactly one
 * port forwarded and CORS never applies. `VITE_SYNC_URL` overrides it for setups
 * where the service is reached directly.
 */
export function syncUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  if (configured) return configured;

  const secure = window.location.protocol === "https:";
  const host = window.location.host || "localhost:1234";
  return `${secure ? "wss:" : "ws:"}//${host}/sync`;
}
