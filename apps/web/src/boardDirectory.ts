import { call } from "./apiCall";

/**
 * The board-directory read model and its two writes (ADR-168).
 *
 * Kept beside the accounts API rather than inside the already large `api.ts` object:
 * the home is the only caller, and the tile fields are a read model, not account data.
 */
export interface BoardTile {
  id: string;
  orgId: string;
  title: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  visibility: string;
  archivedAt: string | null;
  teamId: string | null;
  teamName: string | null;
  createdByName: string | null;
  createdByHandle: string | null;
  canDelete: boolean;
  canDuplicate: boolean;
  widgets: number;
  grants: number;
}

export interface BoardDirectoryPage {
  boards: BoardTile[];
  total: number;
  page: number;
  pageSize: number;
}

export function boardDirectory(params: {
  org: string;
  q?: string;
  sort?: "updated" | "created" | "name" | "author";
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
  trash?: boolean;
}): Promise<BoardDirectoryPage> {
  const query = new URLSearchParams({ org: params.org });
  if (params.q) query.set("q", params.q);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.trash) query.set("trash", "1");
  return call<BoardDirectoryPage>(`/boards?${query.toString()}`);
}

export function setBoardIcon(boardId: string, icon: string): Promise<{ board: { id: string; icon: string } }> {
  return call<{ board: { id: string; icon: string } }>(
    `/boards/${encodeURIComponent(boardId)}/icon`,
    { method: "PATCH", body: { icon } },
  );
}
