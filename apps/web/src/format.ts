/** Small display helpers shared by the header and the organisation screen. */

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** A precise moment without the noise of seconds: "12 Mar, 14:05". */
export function formatMoment(value: string, lang: "en" | "ru"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
