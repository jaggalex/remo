/**
 * @remo/ui — the REMO design system. Import the stylesheet once at the app root
 * (`import "@remo/ui/styles.css"`), wrap the tree in <UiStringsProvider> with the
 * product's i18n adapter, then use the components. See README.md.
 */
export * from "./components";
export { ICONS, ICONS_16, ICON_FILLS, ICON_FILLS_16, ICON_NAMES, type IconName } from "./icons";
export { UiStringsProvider, useUiStrings, type UiKey, type UiCountKey, type UiStrings } from "./i18n";
export { CANVAS_TOKENS, readCanvasTokens, type CanvasToken, type CanvasTokens } from "./canvasTokens";
