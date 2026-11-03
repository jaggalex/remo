import type { TemplateKey } from "@remo/model";
import type { TranslationKey } from "./i18n";

/**
 * The one place a template key becomes a translated name (ADR-158).
 *
 * Both the creation dialog and the board's More menu read this map, so a template
 * cannot be called one thing in one surface and another thing in the other.
 */
export const TEMPLATE_LABEL_KEY: Record<TemplateKey, TranslationKey> = {
  "user-story-map-basic": "newBoard.template.storyMap",
  "product-roadmap-basic": "newBoard.template.roadmap",
  "product-roadmap-basic-prefilled": "newBoard.template.roadmapPrefilled",
  "kanban-framework": "newBoard.template.kanban",
};
