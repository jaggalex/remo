// The app loads `/templates.json` (English) and `/templates.<locale>.json` from its
// public dir, while the files of record are generated at the repo root. Keep them in
// sync before dev/build.
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const [from, to] of [
  ["templates.json", "templates.json"],
  ["templates.ru.json", "templates.ru.json"],
]) {
  copyFileSync(resolve(root, "spec", from), resolve(root, "apps/web/public", to));
  console.log(`synced spec/${from} → apps/web/public/${to}`);
}
