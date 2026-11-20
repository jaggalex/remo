/**
 * The numbers behind the storage bar (ADR-249 §7, `spec/images.md` §9.8).
 *
 * Pure, so the thresholds are tested without a browser. The screen prints what the server
 * counted; these helpers only turn two numbers into a share, a tone and a readable size.
 */

/** Binary steps: a plan's 2 GiB reads as "2 GB", not "2.1 GB". */
const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/**
 * How full the storage is, as a fraction capped at 1.
 *
 * `null` is "no limit", the same spelling the catalogue and the server use; then there is
 * no bar to fill. An over-quota organisation (a downgrade keeps its files, §7) shows a full
 * bar rather than 130 %.
 */
export function storageShare(usedBytes: number, limitBytes: number | null): number {
  if (limitBytes === null || limitBytes <= 0) return 0;
  const used = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;
  return Math.min(1, used / limitBytes);
}

/**
 * The bar's tone: `accent` under 80 %, `warning` up to 100 %, `danger` at the ceiling
 * (§9.8). The tone is a role, not a colour; the stylesheet names the token.
 */
export function storageTone(share: number): "accent" | "warning" | "danger" {
  if (share >= 1) return "danger";
  if (share >= 0.8) return "warning";
  return "accent";
}

/**
 * A size a person reads: "1.3 GB", "12 KB", "0 bytes".
 *
 * `Intl` supplies the unit and the locale's own abbreviations (ГБ in Russian), so no
 * translation table is needed and no literal suffix can drift from the language.
 */
export function formatStorageBytes(bytes: number, lang: "en" | "ru"): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (unit < UNITS.length - 1 && safe >= 1024 ** (unit + 1)) unit += 1;
  const value = safe / 1024 ** unit;
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    style: "unit",
    unit: UNITS[unit],
    // `Intl` abbreviates above a byte and writes the plural of "byte" below it, in both
    // languages, so no suffix is spelled out here.
    unitDisplay: unit === 0 ? "long" : "short",
    // One decimal only while it says something: "1.3 GB" but "120 MB".
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  }).format(value);
}
