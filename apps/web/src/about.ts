/** One place for the public identity of the build. */
export const ABOUT = {
  name: "remo",
  version: __REMO_VERSION__,
  build: __REMO_BUILD__,
  commit: __REMO_COMMIT__,
  author: "Alexander Kostylev",
  license: "AGPL-3.0-only",
  year: 2026,
  source: "https://github.com/jaggalex/remo",
  homepage: "https://remo.letii.ru",
} as const;

/** What the menus show: `remo 0.2.0 · build 1247`. */
export const ABOUT_LABEL =
  ABOUT.build === "dev" ? `${ABOUT.name} ${ABOUT.version}` : `${ABOUT.name} ${ABOUT.version} · ${ABOUT.build}`;
