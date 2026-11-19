/**
 * What the voting API returns (ADR-074, ADR-117, ADR-126).
 *
 * The tally is an aggregate. Names exist in exactly one shape: `breakdown`, and the
 * server sends it only for a session that has ended and was not anonymous. Nothing here
 * carries a subject id — a voter is a name or `null` (an account that no longer exists,
 * which the client shows as a neutral word).
 *
 * Kept beside the vote screens rather than in `api.ts`: the shape is a product rule, and
 * the rule is easier to read next to the panel that renders it.
 */

/** One account's votes on one object. `name` is null when the account is gone. */
export interface VoteBreakdownVoter {
  name: string | null;
  votes: number;
}

/** Link visitors on one object, or in the session: counted, never named (ADR-088). */
export interface VoteBreakdownGuests {
  voters: number;
  votes: number;
}

/** Who gave votes to one object, in an open session that has ended. */
export interface VoteBreakdownObject {
  object_id: string;
  voters: VoteBreakdownVoter[];
  guests: VoteBreakdownGuests;
}

/** One person across the session: what they spent and how widely. */
export interface VoteBreakdownSummaryRow {
  name: string | null;
  total: number;
  objects: number;
}

export interface VoteBreakdown {
  objects: VoteBreakdownObject[];
  summary: VoteBreakdownSummaryRow[];
  guests: VoteBreakdownGuests;
}

export interface VoteSession {
  id: string;
  boardId: string;
  createdBy: string | null;
  createdByName: string;
  objectIds: string[];
  votesPerSubject: number;
  anonymous: boolean;
  state: "open" | "ended";
  endsAt: string | null;
  endedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Aggregate only: object id and its total. Never who voted (ADR-074). */
  votes: Array<{ object_id: string; votes: number }>;
  voters: number;
  /**
   * Who voted, per object and per person. Absent while the session runs and absent for
   * an anonymous session — an empty value would read as "nobody voted" (ADR-126).
   */
  breakdown?: VoteBreakdown;
  myVotes: number;
  myObjectIds: string[];
  remaining: number;
  serverNow: string;
}
