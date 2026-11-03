/**
 * Voting sessions (ADR-074).
 *
 * A vote is a row with a quota checked inside the transaction, not a counter in a
 * browser. The tally is an aggregate, so anonymity is a property of the record and not
 * of a rendering choice. A link visitor may vote under a signed per-browser token; the
 * subject is `visitor:<random>`, never a name.
 *
 * ADR-126 amends the aggregate rule for one case only: when an open session has ended,
 * the results also carry who voted, as account names. An anonymous session never does,
 * a running session never does, and no response carries a subject id either way.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readJsonBody } from "./http-body.mjs";

const VISITOR_COOKIE = "remo_visitor";
const MAX_OBJECTS = 500;
const MAX_QUOTA = 100;
const MAX_MINUTES = 1440;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function fail(response, status, error, message) {
  json(response, status, { error, message });
}

function secret() {
  // A stable secret survives restarts; without one the visitor identity is per-process,
  // which resets a visitor's quota on restart but never invents a person.
  return process.env.REMO_VISITOR_SECRET || process.env.REMO_KEK || "remo-dev-visitor";
}

function sign(id) {
  return createHmac("sha256", secret()).update(id).digest("hex").slice(0, 32);
}

function parseCookies(request) {
  const header = String(request.headers.cookie ?? "");
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/** A verified visitor id, or a fresh one with the cookie that carries it back. */
function visitorIdentity(request) {
  const raw = parseCookies(request)[VISITOR_COOKIE];
  if (raw) {
    const [id, signature] = raw.split(".");
    if (id && signature) {
      const expected = sign(id);
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      if (left.length === right.length && timingSafeEqual(left, right)) {
        return { id, cookie: null };
      }
    }
  }
  const id = randomBytes(16).toString("hex");
  return {
    id,
    cookie: `${VISITOR_COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  };
}

/**
 * An open session whose end time has passed is **ended**, not "open with zero left"
 * (ADR-075 for the timer, ADR-115 for votes). The row keeps `state = 'open'` until
 * something writes, because the deadline is the record and a derived state needs no
 * writer; every reader sees the same answer.
 */
function expired(session, now = Date.now()) {
  return (
    session.state === "open" &&
    Boolean(session.ends_at) &&
    new Date(session.ends_at).getTime() <= now
  );
}

function sessionDto(session, extra = {}) {
  const over = expired(session);
  return {
    id: session.id,
    boardId: session.board_id,
    createdBy: session.created_by,
    createdByName: session.created_by_name,
    objectIds: session.object_ids,
    votesPerSubject: session.votes_per_subject,
    anonymous: session.anonymous,
    state: over ? "ended" : session.state,
    endsAt: session.ends_at,
    endedAt: over ? session.ends_at : session.ended_at,
    publishedAt: session.published_at,
    createdAt: session.created_at,
    ...extra,
  };
}

const ERROR_STATUS = {
  VOTE_SESSION_NOT_FOUND: [404, "RESOURCE_NOT_AVAILABLE"],
  VOTE_SESSION_CLOSED: [409, "VOTE_SESSION_CLOSED"],
  VOTE_BUDGET_EXHAUSTED: [409, "vote_budget_exhausted"],
  VOTE_OBJECT_NOT_IN_SESSION: [422, "VOTE_OBJECT_NOT_IN_SESSION"],
};

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   url: URL,
 *   store: any,
 *   resolveAccess: (boardId: string) => Promise<any>,
 *   onVotesChanged?: (boardId: string) => void,
 *   log?: Console,
 * }} input
 */
export async function handleVotes({
  request,
  response,
  url,
  store,
  resolveAccess,
  onVotesChanged,
  log = console,
}) {
  /** Tell the room to reload the session; a failure to notify never fails the vote. */
  const nudge = (boardId) => {
    try {
      onVotesChanged?.(boardId);
    } catch (error) {
      log.error?.("[votes] notify failed:", error.message);
    }
  };
  const parts = url.pathname.split("/").filter(Boolean);
  const boardRoute = parts[0] === "boards" && parts[2] === "vote-sessions";
  const sessionRoute = parts[0] === "vote-sessions" && Boolean(parts[1]);
  if (!boardRoute && !sessionRoute) return false;
  if (!store.createVoteSession) return false;

  const method = request.method ?? "GET";

  /* --------------------------------------------------------------- access -- */

  let requestSessionId = null;
  const accessFor = async (boardId) => {
    const context = await resolveAccess(boardId);
    requestSessionId = context?.session?.sessionId ?? null;
    if (!context?.resolved?.access?.allowed) return null;
    return context;
  };
  const audit = (event) =>
    store
      .recordAudit?.({ actorType: "user", sessionId: requestSessionId, ...event })
      .catch((error) => log.error?.("[votes] audit failed:", error.message));

  const dto = async (session, context, subject) => {
    // Names appear only once a session is over — a live count must not be a way to
    // pressure an individual voter — and only when the session was not anonymous.
    // An expired-by-clock session is ended, so it qualifies too (ADR-126).
    const ended = session.state === "ended" || expired(session);
    const shown = ended && session.anonymous === false;
    const [{ objects, voters }, used, mine, breakdown] = await Promise.all([
      store.voteTally(session.id),
      subject ? store.voteWeightFor(session.id, subject) : Promise.resolve(0),
      subject ? store.myVotedObjects(session.id, subject) : Promise.resolve([]),
      shown ? store.voteBreakdown(session.id) : Promise.resolve(null),
    ]);
    return sessionDto(session, {
      votes: objects,
      voters,
      // Absent, not empty: "no names in this mode" is a property of the response, so a
      // client cannot mistake an anonymous session for an open one with nobody in it.
      ...(breakdown ? { breakdown } : {}),
      myVotes: used,
      myObjectIds: mine,
      remaining: Math.max(0, session.votes_per_subject - used),
      // Clients compute the countdown from this pair, so a wrong local clock does not
      // make two people see different seconds.
      serverNow: new Date().toISOString(),
    });
  };

  const subjectFor = async (context, { create = false } = {}) => {
    const user = context.session?.user;
    if (user) return { subject: `user:${user.id}`, cookie: null, kind: "user" };
    if (!create) {
      const raw = parseCookies(request)[VISITOR_COOKIE];
      if (!raw) return { subject: null, cookie: null, kind: "none" };
      const [id] = raw.split(".");
      return { subject: id ? `visitor:${id}` : null, cookie: null, kind: "visitor" };
    }
    const visitor = visitorIdentity(request);
    return { subject: `visitor:${visitor.id}`, cookie: visitor.cookie, kind: "visitor" };
  };

  /* --------------------------------------------------------- board routes -- */

  if (boardRoute) {
    const boardId = decodeURIComponent(parts[1]);
    const context = await accessFor(boardId);
    if (!context) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "board not found");
      return true;
    }
    const actorId = context.session?.user?.id ?? null;
    const orgId = context.iam?.org_id ?? context.board.orgId ?? null;
    const facilitate = context.resolved.access.capabilities.includes("board.facilitate");
    const subject = await subjectFor(context);

    if (method === "GET") {
      const sessions = await store.listBoardVoteSessions(boardId, 12);
      const result = [];
      for (const session of sessions) {
        result.push(await dto(session, context, subject.subject));
      }
      json(response, 200, { sessions: result });
      return true;
    }

    if (method === "POST") {
      if (!facilitate) {
        fail(response, 403, "FORBIDDEN", "only an editor can start a voting session");
        return true;
      }
      const body = await readJsonBody(request);
      if (!body) {
        fail(response, 400, "BAD_JSON", "expected a JSON body");
        return true;
      }
      const objectIds = Array.isArray(body.objectIds)
        ? [...new Set(body.objectIds.filter((id) => typeof id === "string" && id))]
        : [];
      if (!objectIds.length || objectIds.length > MAX_OBJECTS) {
        fail(response, 422, "BAD_SCOPE", `select between 1 and ${MAX_OBJECTS} objects`);
        return true;
      }
      const votesPerSubject = Number(body.votesPerSubject ?? 3);
      if (!Number.isInteger(votesPerSubject) || votesPerSubject < 1 || votesPerSubject > MAX_QUOTA) {
        fail(response, 422, "BAD_QUOTA", `votes per person must be 1–${MAX_QUOTA}`);
        return true;
      }
      const minutes =
        body.minutes === undefined || body.minutes === null ? null : Number(body.minutes);
      if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES)) {
        fail(response, 422, "BAD_DURATION", `duration must be 1–${MAX_MINUTES} minutes`);
        return true;
      }
      // A board may pin the vote to its shared timer: then the facilitator sets the
      // clock once, and votes stop exactly when the timer says so (ADR-115).
      let endsAt = null;
      if (body.endsAt !== undefined && body.endsAt !== null) {
        const parsed = new Date(body.endsAt);
        if (Number.isNaN(parsed.getTime())) {
          fail(response, 422, "BAD_DURATION", "endsAt must be a date");
          return true;
        }
        if (parsed.getTime() <= Date.now() || parsed.getTime() > Date.now() + MAX_MINUTES * 60_000) {
          fail(response, 422, "BAD_DURATION", `endsAt must be within ${MAX_MINUTES} minutes`);
          return true;
        }
        endsAt = parsed.toISOString();
      }
      const open = (await store.listBoardVoteSessions(boardId, 5)).find(
        (session) => session.state === "open" && !expired(session),
      );
      if (open) {
        fail(response, 409, "VOTE_SESSION_OPEN", "end the open session before starting another");
        return true;
      }
      const session = await store.createVoteSession({
        boardId,
        orgId,
        createdBy: actorId,
        createdByName: context.session?.user?.name ?? "",
        objectIds,
        votesPerSubject,
        anonymous: body.anonymous !== false,
        minutes: minutes === null ? null : Math.round(minutes),
        endsAt,
      });
      await audit({
        actorId,
        orgId,
        boardId,
        action: "vote.session.start",
        subject: session.id,
        after: { objects: objectIds.length, votesPerSubject, anonymous: session.anonymous },
      });
      nudge(boardId);
      json(response, 201, { session: await dto(session, context, subject.subject) });
      return true;
    }

    fail(response, 405, "METHOD_NOT_ALLOWED", "unsupported method");
    return true;
  }

  /* ------------------------------------------------------- session routes -- */

  const sessionId = decodeURIComponent(parts[1]);
  const session = await store.getVoteSession(sessionId);
  if (!session) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "voting session not found");
    return true;
  }
  const context = await accessFor(session.board_id);
  if (!context) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "voting session not found");
    return true;
  }
  const actorId = context.session?.user?.id ?? null;
  const orgId = context.iam?.org_id ?? context.board.orgId ?? null;
  const facilitate = context.resolved.access.capabilities.includes("board.facilitate");
  const action = parts[2] ?? "";

  if (action === "" && method === "GET") {
    const subject = await subjectFor(context);
    json(response, 200, { session: await dto(session, context, subject.subject) });
    return true;
  }

  if (action === "votes" && method === "POST" && parts.length === 3) {
    const body = await readJsonBody(request);
    const objectId = String(body?.objectId ?? "");
    if (!objectId) {
      fail(response, 422, "OBJECT_REQUIRED", "choose an object");
      return true;
    }
    const identity = await subjectFor(context, { create: true });
    try {
      await store.castVote({ sessionId, subjectId: identity.subject, objectId });
    } catch (error) {
      const [status, code] = ERROR_STATUS[error.code] ?? [500, error.code ?? "VOTE_FAILED"];
      if (error.code === "VOTE_BUDGET_EXHAUSTED") {
        await audit({
          actorId,
          orgId,
          boardId: session.board_id,
          action: "vote.denied",
          subject: identity.subject,
          reason: "vote_budget_exhausted",
        });
      }
      fail(response, status, code, error.message);
      return true;
    }
    if (identity.cookie) response.setHeader("Set-Cookie", identity.cookie);
    nudge(session.board_id);
    const fresh = await store.getVoteSession(sessionId);
    json(response, 200, { session: await dto(fresh, context, identity.subject) });
    return true;
  }

  if (action === "votes" && method === "DELETE" && parts.length === 4) {
    if (session.state !== "open" || expired(session)) {
      fail(response, 409, "VOTE_SESSION_CLOSED", "vote session is closed");
      return true;
    }
    const identity = await subjectFor(context);
    if (!identity.subject) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no vote to withdraw");
      return true;
    }
    const objectId = decodeURIComponent(parts[3]);
    const removed = await store.withdrawVote({
      sessionId,
      subjectId: identity.subject,
      objectId,
    });
    if (!removed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no vote to withdraw");
      return true;
    }
    nudge(session.board_id);
    const fresh = await store.getVoteSession(sessionId);
    json(response, 200, { session: await dto(fresh, context, identity.subject) });
    return true;
  }

  if ((action === "extend" || action === "end") && method === "POST") {
    if (!facilitate) {
      fail(response, 403, "FORBIDDEN", "only an editor can change a voting session");
      return true;
    }
    if (action === "extend") {
      if (expired(session)) {
        fail(response, 409, "VOTE_SESSION_CLOSED", "the session is already closed");
        return true;
      }
      const body = await readJsonBody(request);
      const minutes = Number(body?.minutes ?? 1);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
        fail(response, 422, "BAD_DURATION", `extension must be 1–${MAX_MINUTES} minutes`);
        return true;
      }
      const updated = await store.extendVoteSession(sessionId, Math.round(minutes));
      if (!updated) {
        fail(response, 409, "VOTE_SESSION_CLOSED", "the session is already closed");
        return true;
      }
      await audit({
        actorId,
        orgId,
        boardId: session.board_id,
        action: "vote.session.extend",
        subject: sessionId,
        after: { minutes: Math.round(minutes) },
      });
      nudge(session.board_id);
      const subject = await subjectFor(context);
      json(response, 200, { session: await dto(updated, context, subject.subject) });
      return true;
    }
    const ended = await store.endVoteSession(sessionId, actorId);
    if (!ended) {
      fail(response, 409, "VOTE_SESSION_CLOSED", "the session is already closed");
      return true;
    }
    await audit({
      actorId,
      orgId,
      boardId: session.board_id,
      action: "vote.session.end",
      subject: sessionId,
      after: { voters: (await store.voteTally(sessionId)).voters },
    });
    nudge(session.board_id);
    const subject = await subjectFor(context);
    json(response, 200, { session: await dto(ended, context, subject.subject) });
    return true;
  }

  if (action === "publish" && method === "POST") {
    if (!facilitate) {
      fail(response, 403, "FORBIDDEN", "only an editor can publish results");
      return true;
    }
    if (session.state === "open" && !expired(session)) {
      fail(response, 409, "VOTE_SESSION_OPEN", "end the session before publishing");
      return true;
    }
    const marked = await store.markVotePublished(sessionId);
    // The published card is written by the client from `results`, which stays the raw
    // aggregate in both modes: a board travels further than its results panel (export,
    // share link, copies), so no names land on it (ADR-126).
    const tally = await store.voteTally(sessionId);
    await audit({
      actorId,
      orgId,
      boardId: session.board_id,
      action: "vote.publish",
      subject: sessionId,
      after: { objects: tally.objects.length },
    });
    nudge(session.board_id);
    const subject = await subjectFor(context);
    json(response, 200, {
      session: await dto(marked, context, subject.subject),
      results: tally,
    });
    return true;
  }

  fail(response, 404, "RESOURCE_NOT_AVAILABLE", "unsupported voting route");
  return true;
}
