/**
 * Voting sessions and rows (ADR-074).
 *
 * The quota is checked in the transaction that inserts the vote; the tally is an
 * aggregate that never names a voter. `voteBreakdown` is the one exception, and the
 * caller decides who may see it: names of accounts, counted link visitors, never a
 * subject id (ADR-126).
 */
export const voteMethods = {
async createVoteSession({
  boardId,
  orgId,
  createdBy,
  createdByName,
  objectIds,
  votesPerSubject,
  anonymous,
  minutes,
  endsAt = null,
}) {
  // The end time is one value: either an explicit deadline pinned to the board timer
  // (ADR-115) or a duration counted from now. Both land in `ends_at`.
  const { rows } = await this.pool.query(
    `insert into vote_sessions
       (board_id, org_id, created_by, created_by_name, object_ids,
        votes_per_subject, anonymous, ends_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7,
             coalesce($9::timestamptz,
                      case when $8::int is null then null
                           else now() + make_interval(mins => $8::int) end))
     returning *`,
    [
      boardId,
      orgId,
      createdBy ?? null,
      createdByName ?? "",
      JSON.stringify(objectIds),
      votesPerSubject,
      anonymous,
      minutes ?? null,
      endsAt,
    ],
  );
  return rows[0];
},

async getVoteSession(id) {
  const { rows } = await this.pool.query("select * from vote_sessions where id = $1", [id]);
  return rows[0] ?? null;
},

async listBoardVoteSessions(boardId, limit = 12) {
  const { rows } = await this.pool.query(
    `select * from vote_sessions where board_id = $1 order by created_at desc limit $2`,
    [boardId, limit],
  );
  return rows;
},

async voteTally(sessionId) {
  const [{ rows: objects }, { rows: voters }] = await Promise.all([
    this.pool.query(
      `select object_id, sum(weight)::int as votes
         from votes where session_id = $1
        group by object_id
        order by votes desc, object_id asc`,
      [sessionId],
    ),
    this.pool.query(
      "select count(distinct subject_id)::int as voters from votes where session_id = $1",
      [sessionId],
    ),
  ]);
  return { objects, voters: voters[0]?.voters ?? 0 };
},

/**
 * Who voted, for the results of an open session (ADR-126).
 *
 * Two views over the same rows: per object, the accounts and how many votes each gave,
 * and per person, the total and the number of objects it went to. A link visitor is a
 * `visitor:<random>` subject with no name to show, so guests are counted, never listed.
 * A deleted account keeps its votes and loses its name — `null`, so the client can say
 * a neutral word instead of inventing one.
 *
 * Nothing in the result carries a subject id.
 */
async voteBreakdown(sessionId) {
  const [{ rows: named }, { rows: guestObjects }, { rows: guestTotals }] = await Promise.all([
    this.pool.query(
      `select v.object_id, v.subject_id, sum(v.weight)::int as votes, u.name
         from votes v
         left join users u on v.subject_id = 'user:' || u.id::text
        where v.session_id = $1 and v.subject_id like 'user:%'
        group by v.object_id, v.subject_id, u.name
        order by v.object_id, votes desc, u.name nulls last, v.subject_id`,
      [sessionId],
    ),
    this.pool.query(
      `select object_id,
              count(distinct subject_id)::int as voters,
              sum(weight)::int as votes
         from votes
        where session_id = $1 and subject_id like 'visitor:%'
        group by object_id
        order by object_id`,
      [sessionId],
    ),
    this.pool.query(
      `select count(distinct subject_id)::int as voters,
              coalesce(sum(weight), 0)::int as votes
         from votes
        where session_id = $1 and subject_id like 'visitor:%'`,
      [sessionId],
    ),
  ]);

  const objects = new Map();
  const objectOf = (objectId) => {
    const entry = objects.get(objectId) ?? {
      object_id: objectId,
      voters: [],
      guests: { voters: 0, votes: 0 },
    };
    objects.set(objectId, entry);
    return entry;
  };
  // Keyed by subject while building, so two people with one name stay two people; the
  // key never leaves this function.
  const people = new Map();
  for (const row of named) {
    objectOf(row.object_id).voters.push({ name: row.name ?? null, votes: row.votes });
    const person = people.get(row.subject_id) ?? { name: row.name ?? null, total: 0, objects: 0 };
    person.total += row.votes;
    person.objects += 1;
    people.set(row.subject_id, person);
  }
  for (const row of guestObjects) {
    objectOf(row.object_id).guests = { voters: row.voters, votes: row.votes };
  }

  return {
    objects: [...objects.values()],
    summary: [...people.values()].sort(
      (left, right) =>
        right.total - left.total ||
        // A person we can name goes before "a participant": the unknown is the exception.
        (left.name === null ? 1 : 0) - (right.name === null ? 1 : 0) ||
        (left.name ?? "").localeCompare(right.name ?? ""),
    ),
    guests: { voters: guestTotals[0]?.voters ?? 0, votes: guestTotals[0]?.votes ?? 0 },
  };
},

async myVotedObjects(sessionId, subjectId) {
  const { rows } = await this.pool.query(
    "select object_id from votes where session_id = $1 and subject_id = $2 order by object_id",
    [sessionId, subjectId],
  );
  return rows.map((row) => row.object_id);
},

async voteWeightFor(sessionId, subjectId) {
  const { rows } = await this.pool.query(
    "select coalesce(sum(weight), 0)::int as used from votes where session_id = $1 and subject_id = $2",
    [sessionId, subjectId],
  );
  return rows[0]?.used ?? 0;
},

async castVote({ sessionId, subjectId, objectId }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select state, ends_at, votes_per_subject, object_ids
         from vote_sessions where id = $1 for update`,
      [sessionId],
    );
    const session = rows[0];
    if (!session) {
      const error = new Error("vote session not found");
      error.code = "VOTE_SESSION_NOT_FOUND";
      throw error;
    }
    if (session.state !== "open" || (session.ends_at && new Date(session.ends_at) <= new Date())) {
      const error = new Error("vote session is closed");
      error.code = "VOTE_SESSION_CLOSED";
      throw error;
    }
    const snapshot = Array.isArray(session.object_ids) ? session.object_ids : [];
    if (!snapshot.includes(objectId)) {
      const error = new Error("object is not part of this session");
      error.code = "VOTE_OBJECT_NOT_IN_SESSION";
      throw error;
    }
    const { rows: usedRows } = await client.query(
      "select coalesce(sum(weight), 0)::int as used from votes where session_id = $1 and subject_id = $2",
      [sessionId, subjectId],
    );
    const used = usedRows[0]?.used ?? 0;
    if (used >= session.votes_per_subject) {
      const error = new Error("vote budget exhausted");
      error.code = "VOTE_BUDGET_EXHAUSTED";
      throw error;
    }
    await client.query(
      `insert into votes (session_id, subject_id, object_id, weight)
       values ($1, $2, $3, 1)
       on conflict (session_id, subject_id, object_id) do nothing`,
      [sessionId, subjectId, objectId],
    );
    await client.query("commit");
    return { used: used + 1, quota: session.votes_per_subject };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async withdrawVote({ sessionId, subjectId, objectId }) {
  const { rowCount } = await this.pool.query(
    "delete from votes where session_id = $1 and subject_id = $2 and object_id = $3",
    [sessionId, subjectId, objectId],
  );
  return rowCount > 0;
},

async extendVoteSession(id, minutes) {
  const { rows } = await this.pool.query(
    `update vote_sessions
        set ends_at = greatest(coalesce(ends_at, now()), now()) + make_interval(mins => $2::int)
      where id = $1 and state = 'open'
      returning *`,
    [id, minutes],
  );
  return rows[0] ?? null;
},

async endVoteSession(id, endedBy) {
  const { rows } = await this.pool.query(
    `update vote_sessions
        set state = 'ended', ended_at = now(), ended_by = $2
      where id = $1 and state = 'open'
      returning *`,
    [id, endedBy ?? null],
  );
  return rows[0] ?? null;
},

async markVotePublished(id) {
  const { rows } = await this.pool.query(
    `update vote_sessions set published_at = coalesce(published_at, now())
      where id = $1 returning *`,
    [id],
  );
  return rows[0] ?? null;
}
};
