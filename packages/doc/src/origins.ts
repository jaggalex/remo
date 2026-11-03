/**
 * Transaction origins.
 *
 * Yjs tells listeners who made a change; the document uses that to keep the undo stack
 * to this person's own gestures. The constants live in their own module so feature
 * modules can name them without importing the document class (ADR-053).
 */
export const LOCAL_ORIGIN = "local-ui";
/** Bulk import is not a user gesture, so it stays out of the undo stack. */
export const IMPORT_ORIGIN = "import";
