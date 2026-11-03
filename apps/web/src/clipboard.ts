import type { BoardFragment } from "@remo/doc";

/**
 * Clipboard transport.
 *
 * The payload is our own JSON in `text/plain`, so a fragment can travel between
 * tabs, boards and machines without a custom MIME type. A plain-text paste that is
 * not ours becomes a sticky note, which is what the source product does.
 *
 * On plain HTTP (a LAN address, where `navigator.clipboard` is unavailable) writing
 * still works through the selection fallback; reading cannot, so paste falls back
 * to the in-memory fragment of this tab.
 */
const KIND = "remo/fragment";
const VERSION = 1;

export function encodeFragment(fragment: BoardFragment): string {
  return JSON.stringify({ kind: KIND, version: VERSION, fragment });
}

export function decodeFragment(text: string): BoardFragment | null {
  try {
    const parsed = JSON.parse(text) as {
      kind?: string;
      version?: number;
      fragment?: BoardFragment;
    };
    if (parsed.kind !== KIND || parsed.version !== VERSION) return null;
    const fragment = parsed.fragment;
    if (!fragment || fragment.version !== 1 || !Array.isArray(fragment.widgets)) return null;
    return fragment;
  } catch {
    return null;
  }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission can be refused; the fallback below still serves the same tab.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Text currently on the system clipboard, or null when the browser will not say. */
export async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    // Denied or unavailable (plain HTTP): the caller uses its in-memory fragment.
  }
  return null;
}
