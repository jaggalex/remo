// The app loads /templates.json from its public dir, while the file of record is
// generated at the repo root. Keep them in sync before dev/build.
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(resolve(root, "spec/templates.json"), resolve(root, "apps/web/public/templates.json"));
console.log("synced spec/templates.json → apps/web/public/templates.json");
