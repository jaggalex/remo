/**
 * What a person may discover outside the board they already have open.
 *
 * The directory and text search were built before accounts and answered with every
 * projected board. With organisations that is a leak: a name, a thumbnail or a snippet
 * is content too (ENT-07 in ADR-071). Discovery uses the same rule as opening a board —
 * an active seat plus a source. There is no exception for a legacy room: an unowned room
 * is closed (ADR-174), and listing it would only offer a door that answers 403.
 */

/**
 * @param {object} store
 * @param {{ userId?: string | null, room?: string | null }} viewer
 * @returns {Promise<Array<object>>} board summaries this viewer may open
 */
export async function discoverableBoards(store, { userId = null } = {}) {
  return userId && store.listReadableBoards ? await store.listReadableBoards(userId) : [];
}

/** The same set as ids, for scoping a search query. */
export async function discoverableBoardIds(store, viewer) {
  return (await discoverableBoards(store, viewer)).map((board) => board.id);
}
