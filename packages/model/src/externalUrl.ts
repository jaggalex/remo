/**
 * The one rule for an external link (ADR-103, ADR-171).
 *
 * It lives in the model rather than in the document package because two layers need
 * it: the command that writes a link, and the reader that repairs whatever another
 * client wrote (`readWidget`). A link that only the writer checks is not checked at all
 * — any editor can put a raw value into the shared document without the command.
 */

const MAX_URL = 2048;

/** A safe external URL, or null. Only http, https and mailto; no credentials. */
export function safeExternalUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > MAX_URL || /[\u0000-\u001f\u007f]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (url.protocol !== "mailto:" && !url.hostname) return null;
  return url.toString();
}
