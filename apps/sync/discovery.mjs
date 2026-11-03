/**
 * What a person may discover outside the board they already have open.
 *
 * The directory and text search were built before accounts and answered with every
 * projected board. With organisations that is a leak: a name, a thumbnail or a snippet
 * is content too (ENT-07 in ADR-071). Discovery now uses the same rule as opening
 * a board — an active seat plus a source — with one exception for the transitional
 * mode: a legacy room with no owner is visible only to somebody who already names it in
 * the URL (ADR-064), never merely because it exists.
 */

/**
 * @param {object} store
 * @param {{ userId?: string | null, room?: string | null }} viewer
 * @returns {Promise<Array<object>>} board summaries, the current legacy room first
 */
export async function discoverableBoards(store, { userId = null, room = null } = {}) {
  const boards =
    userId && store.listReadableBoards ? await store.listReadableBoards(userId) : [];
  const seen = new Set(boards.map((board) => board.id));

  if (room && !seen.has(room) && store.getIamBoard) {
    const iam = await store.getIamBoard(room);
    if (iam && !iam.owner_id) {
      const summary = await store.getBoard(room);
      if (summary) boards.unshift({ ...summary, id: room });
    }
  }

  return boards;
}

/** The same set as ids, for scoping a search query. */
export async function discoverableBoardIds(store, viewer) {
  return (await discoverableBoards(store, viewer)).map((board) => board.id);
}
