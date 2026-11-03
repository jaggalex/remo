/**
 * Board routes: access, claim, sharing, the link, the password, trash, restore, copy.
 */
import { hashPassword, hashToken, newToken, normalizeEmail, verifyPassword } from "./iam.mjs";
import { emitMetric } from "./metrics-events.mjs";
import {
  accessForBoard,
  boardIdFor,
  fail,
  json,
  linkAttempts,
  linkUnlockToken,
  publicLinkView,
  readBody,
} from "./iam-http.mjs";

export async function handleBoardRoutes(ctx) {
  const { request, response, url, store, method, parts, user, audit, requireUser, onAclChanged } = ctx;

  if (parts[0] === "boards" && parts[1]) {
    const boardId = parts[1];
    const me = user;
    const board = await store.getIamBoard(boardId);
    if (!board) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;

    // An unclaimed board is the legacy mode: whoever knows the name may read it, and
    // claiming is how that stops being true (ADR-064).
    const unclaimed = !board.owner_id;

    if (parts[2] === "claim" && method === "POST") {
      const me = requireUser();
      if (!me) return true;
      if (!unclaimed) return fail(response, 409, "ALREADY_CLAIMED", "this board has an owner"), true;
      const body = await readBody(request);
      const orgs = await store.listOrgsForUser(me.id);
      const orgId = orgs[0]?.id;
      if (!orgId) return fail(response, 409, "ORG_REQUIRED", "create an organisation first"), true;
      const teams = await store.listTeams(orgId);
      const teamId = teams[0]?.id ?? null;
      if (!teamId) return fail(response, 409, "TEAM_REQUIRED", "create a team first"), true;

      const claimed = await store.claimBoard({
        boardId,
        userId: me.id,
        orgId,
        teamId,
        tokenHash: body?.token ? hashToken(body.token) : null,
      });
      if (!claimed) {
        return fail(response, 403, "CLAIM_REJECTED", "claim token is wrong"), true;
      }
      await store.addTeamMember({ teamId, userId: me.id, role: "admin" });
      await audit({
        actorId: me.id,
        orgId,
        boardId,
        action: "board.claim",
        subject: claimed.title,
        after: { ownerId: me.id },
      });
      await onAclChanged?.(boardId);
      json(response, 200, { board: claimed });
      return true;
    }

    // Reading a claimed board needs `board.read`; an unclaimed one is open by design.
    if (unclaimed) {
      if (parts[2] === "access" && method === "GET") {
        json(response, 200, {
          access: {
            allowed: true,
            role: null,
            capabilities: ["board.read", "board.edit"],
            sources: ["unclaimed"],
            reason: "UNCLAIMED",
          },
          board: { id: board.id, title: board.title, claimed: false },
        });
        return true;
      }
      return false; // let the read API serve the projection, as before
    }

    const resolved = await accessForBoard({
      store,
      boardId,
      userId: me?.id ?? null,
      unlockToken: linkUnlockToken(request),
    });
    const access = resolved?.access ?? {
      allowed: false,
      role: null,
      capabilities: [],
      sources: [],
      reason: "NOT_FOUND",
    };

    if (parts[2] === "access" && method === "GET") {
      // A password-protected link says only that a password is required: no title, no
      // owner, nothing to help an uninvited visitor (ADR-069, B3).
      if (resolved?.passwordRequired) {
        return fail(response, 401, "PASSWORD_REQUIRED", "this link needs a password"), true;
      }
      if (resolved?.linkInactive) {
        return fail(response, 404, "LINK_INACTIVE", "this link is not active"), true;
      }
      // A public link is a valid viewer without a session, so the 401 is only for the
      // case where there is neither.
      if (!access.allowed) {
        const me2 = requireUser();
        if (!me2) return true;
        // A signed-in stranger learns nothing about a board they cannot open: no title,
        // no organisation, no visibility.
        return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      }
      json(response, 200, {
        access,
        board: {
          id: board.id,
          title: board.title,
          claimed: true,
          orgId: board.org_id,
          visibility: board.visibility,
        },
      });
      return true;
    }

    // People a card can be assigned to. A signed-in reader may see names, not emails;
    // a link visitor has no identity to assign and gets the normal 401 (ADR-106).
    if (parts[2] === "people" && method === "GET") {
      const me2 = requireUser();
      if (!me2) return true;
      if (!access.allowed) {
        return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      }
      json(response, 200, { people: await store.listBoardPeople(boardId) });
      return true;
    }

    if (parts[2] === "grants") {
      const me2 = requireUser();
      if (!me2) return true;
      const allowed = access.capabilities.includes("board.share");
      if (!allowed) {
        return fail(response, 403, "FORBIDDEN", "you cannot change sharing on this board"), true;
      }

      if (method === "GET") {
        json(response, 200, { grants: await store.listGrants(boardId), aclVersion: access.aclVersion });
        return true;
      }

      if (method === "POST") {
        const body = await readBody(request);
        const role = String(body?.role ?? "viewer");
        const subjectType = String(body?.subjectType ?? "user");
        if (!["viewer", "commenter", "editor", "coowner"].includes(role)) {
          return fail(response, 422, "BAD_ROLE", "unknown role"), true;
        }
        if (!["user", "team", "org"].includes(subjectType)) {
          return fail(response, 422, "BAD_SUBJECT", "unknown subject type"), true;
        }
        // ADR-061: a team's role is a management decision, not an editor action.
        if (subjectType === "team" && !access.capabilities.includes("board.manage")) {
          return fail(response, 403, "FORBIDDEN", "only the owner or a co-owner can change a team role"), true;
        }
        let subjectId = body?.subjectId ? String(body.subjectId) : null;
        if (!subjectId && subjectType === "user" && body?.email) {
          const target = await store.findUserByEmail(normalizeEmail(body.email));
          if (!target) {
            return fail(response, 404, "USER_NOT_FOUND", "no account with that email"), true;
          }
          subjectId = target.id;
        }
        if (!subjectId) {
          return fail(response, 422, "SUBJECT_REQUIRED", "subjectId or email is required"), true;
        }
        const existing = (await store.listGrants(boardId)).find(
          (grant) => grant.subject_type === subjectType && grant.subject_id === subjectId,
        );
        // Co-owner is a management role: creating one, promoting to it, or demoting a
        // co-owner is not a sharing action, whoever the subject is (ADR-061).
        const touchesCoowner = role === "coowner" || existing?.role === "coowner";
        if (touchesCoowner && !access.capabilities.includes("board.manage")) {
          return fail(
            response,
            403,
            "FORBIDDEN",
            "only the owner or a co-owner can grant or change a co-owner",
          ), true;
        }
        const result = await store.putGrant({
          boardId,
          subjectType,
          subjectId,
          role,
          grantedBy: me2.id,
        });
        await audit({
          actorId: me2.id,
          orgId: board.org_id,
          boardId,
          action: "grant.put",
          subject: `${subjectType}:${subjectId}`,
          after: { role },
        });
        if (existing && existing.role !== role) {
          emitMetric({
            name: "role.changed",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { from: existing.role, to: role, subjectType },
          });
        } else if (!existing) {
          emitMetric({
            name: "share.invited",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { role, subjectType },
          });
        }
        await onAclChanged?.(boardId);
        json(response, 200, result);
        return true;
      }

      if (method === "DELETE" && parts[3] && parts[4]) {
        const subjectType = parts[3];
        if (!["user", "team", "org"].includes(subjectType)) {
          return fail(response, 422, "BAD_SUBJECT", "unknown subject type"), true;
        }
        if (subjectType === "team" && !access.capabilities.includes("board.manage")) {
          return fail(response, 403, "FORBIDDEN", "only the owner or a co-owner can change a team role"), true;
        }
        const subjectId = parts[4];
        const existing = (await store.listGrants(boardId)).find(
          (grant) => grant.subject_type === subjectType && grant.subject_id === subjectId,
        );
        // Removing a co-owner demotes a manager, so it needs the same grant as adding one.
        if (existing?.role === "coowner" && !access.capabilities.includes("board.manage")) {
          return fail(
            response,
            403,
            "FORBIDDEN",
            "only the owner or a co-owner can change a co-owner",
          ), true;
        }
        const result = await store.deleteGrant({
          boardId,
          subjectType,
          subjectId,
        });
        await audit({
          actorId: me2.id,
          orgId: board.org_id,
          boardId,
          action: "grant.delete",
          subject: `${subjectType}:${subjectId}`,
        });
        await onAclChanged?.(boardId);
        // The caller needs to know access may survive through another source (AC-28).
        const after = await store.accessFacts(boardId, null);
        json(response, 200, { ...result, boardAclVersion: after?.board.aclVersion ?? null });
        return true;
      }
    }

    if (parts[2] === "link") {
      // Unlocking is the one link action that must work without a session: the person
      // with the URL has no account, and the password is the whole credential.
      if (parts[3] === "unlock" && method === "POST") {
        const body = await readBody(request);
        if (body === null) return fail(response, 400, "BAD_REQUEST", "invalid JSON"), true;
        const link = await store.getBoardLink(boardId);
        if (!link?.enabled || !link.has_password) {
          return fail(response, 409, "LINK_NOT_PROTECTED", "this link has no password"), true;
        }
        if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
          return fail(response, 410, "LINK_EXPIRED", "this link has expired"), true;
        }
        const key = `${request.socket.remoteAddress ?? "unknown"}:${boardId}`;
        const now = Date.now();
        const bucket = linkAttempts.get(key);
        if (bucket && bucket.resetAt > now && bucket.count >= 10) {
          return fail(response, 429, "RATE_LIMITED", "too many attempts; try again later"), true;
        }
        const ok = await verifyPassword(String(body.password ?? ""), link.password_hash);
        if (!ok) {
          const next = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + 15 * 60_000 };
          next.count += 1;
          linkAttempts.set(key, next);
          return fail(response, 403, "WRONG_PASSWORD", "wrong password"), true;
        }
        linkAttempts.delete(key);
        const token = newToken(24);
        await store.createLinkUnlock({
          tokenHash: hashToken(token),
          boardId,
          passwordVersion: link.password_version,
          expiresAt: new Date(Date.now() + 12 * 60 * 60_000),
        });
        json(
          response,
          200,
          { ok: true },
          { "Set-Cookie": linkUnlockCookie(token, process.env.NODE_ENV === "production") },
        );
        return true;
      }

      const me2 = requireUser();
      if (!me2) return true;
      if (!access.capabilities.includes("board.manage")) {
        return fail(response, 403, "FORBIDDEN", "only the owner or a co-owner can share a link"), true;
      }
      if (method === "GET") {
        const link = await store.getBoardLink(boardId);
        json(response, 200, {
          link: publicLinkView(link),
          visibility: board.visibility,
          // The same URL whether it was copied today or last month (ADR-069).
          url: `/?room=${encodeURIComponent(boardId)}`,
        });
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(request);
        if (body === null) return fail(response, 400, "BAD_REQUEST", "invalid JSON"), true;

        if (body.enabled === false) {
          await store.disableBoardLink(boardId);
          await audit({ actorId: me2.id, orgId: board.org_id, boardId, action: "link.disable" });
          emitMetric({
            name: "link.enabled",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { state: "off" },
          });
        } else if (body.enabled === true) {
          await store.enableBoardLink({ boardId, role: "viewer", createdBy: me2.id });
          await audit({ actorId: me2.id, orgId: board.org_id, boardId, action: "link.enable" });
          emitMetric({
            name: "link.enabled",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { state: "on" },
          });
        }

        const current = await store.getBoardLink(boardId);
        if (!current && ("password" in body || "expiresAt" in body)) {
          return fail(response, 409, "LINK_NOT_CONFIGURED", "turn the link on before adding security"), true;
        }

        if ("password" in body) {
          const value = body.password;
          if (value !== null && (typeof value !== "string" || value.length < 8)) {
            return fail(response, 422, "WEAK_PASSWORD", "the link password needs at least 8 characters"), true;
          }
          await store.setBoardLinkPassword(
            boardId,
            value === null ? null : await hashPassword(value),
          );
          await audit({
            actorId: me2.id,
            orgId: board.org_id,
            boardId,
            action: value === null ? "link.password_remove" : "link.password_set",
          });
          emitMetric({
            name: "link.security",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { password: value !== null },
          });
        }

        if ("expiresAt" in body) {
          const raw = body.expiresAt;
          let expiresAt = null;
          if (raw !== null) {
            const parsed = new Date(String(raw));
            if (Number.isNaN(parsed.getTime())) {
              return fail(response, 422, "BAD_EXPIRY", "enter a valid date and time"), true;
            }
            if (parsed.getTime() <= Date.now()) {
              return fail(response, 422, "EXPIRY_IN_PAST", "the expiry must be in the future"), true;
            }
            expiresAt = parsed;
          }
          await store.setBoardLinkExpiry(boardId, expiresAt);
          await audit({
            actorId: me2.id,
            orgId: board.org_id,
            boardId,
            action: expiresAt ? "link.expiry_set" : "link.expiry_remove",
          });
          emitMetric({
            name: "link.security",
            orgId: board.org_id,
            actorId: me2.id,
            boardId,
            props: { expires: Boolean(expiresAt) },
          });
        }

        await onAclChanged?.(boardId);
        json(response, 200, {
          link: publicLinkView(await store.getBoardLink(boardId)),
          url: `/?room=${encodeURIComponent(boardId)}`,
        });
        return true;
      }
    }
    if (parts.length === 2 && method === "DELETE") {
      const me2 = requireUser();
      if (!me2) return true;
      if (board.archived_at) {
        return fail(response, 409, "ALREADY_ARCHIVED", "this board is already in the trash"), true;
      }
      if (!access.capabilities.includes("board.delete")) {
        return fail(response, 403, "FORBIDDEN", "only the owner can delete this board"), true;
      }
      const archived = await store.archiveBoard(boardId);
      if (!archived) return fail(response, 409, "NOT_DELETED", "the board changed meanwhile"), true;
      await audit({ actorId: me2.id, orgId: board.org_id, boardId, action: "board.trash" });
      emitMetric({ name: "board.trashed", orgId: board.org_id, actorId: me2.id, boardId });
      await onAclChanged?.(boardId);
      json(response, 200, { board: { id: boardId, archivedAt: new Date().toISOString() } });
      return true;
    }

    if (parts[2] === "restore" && method === "POST") {
      const me2 = requireUser();
      if (!me2) return true;
      if (board.owner_id !== me2.id) {
        return fail(response, 403, "FORBIDDEN", "only the owner can restore this board"), true;
      }
      const restored = await store.restoreBoard(boardId);
      if (!restored) return fail(response, 409, "NOT_ARCHIVED", "this board is not in the trash"), true;
      await audit({ actorId: me2.id, orgId: board.org_id, boardId, action: "board.restore" });
      emitMetric({ name: "board.restored", orgId: board.org_id, actorId: me2.id, boardId });
      await onAclChanged?.(boardId);
      json(response, 200, { board: { id: boardId, archivedAt: null } });
      return true;
    }

    if (parts[2] === "duplicate" && method === "POST") {
      const me2 = requireUser();
      if (!me2) return true;
      if (!access.allowed || !access.capabilities.includes("board.share")) {
        return fail(response, 403, "FORBIDDEN", "only the owner or a co-owner can copy this board"), true;
      }
      const title = `${board.title || "Untitled"} (copy)`;
      const newId = boardIdFor(title);
      const copy = await store.duplicateBoard({
        sourceId: boardId,
        newId,
        title,
        ownerId: me2.id,
        copyGrants: true,
      });
      if (!copy) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      await audit({
        actorId: me2.id,
        orgId: board.org_id,
        boardId: newId,
        action: "board.duplicate",
        after: { sourceId: boardId },
      });
      emitMetric({
        name: "board.duplicated",
        orgId: board.org_id,
        actorId: me2.id,
        boardId: newId,
        props: { sourceId: boardId },
      });
      json(response, 200, { board: copy });
      return true;
    }

    if (method === "GET" && parts.length === 2) {
      if (!access.allowed) {
        return fail(response, access.reason === "AUTH_REQUIRED" ? 401 : 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      }
      json(response, 200, {
        board: { id: board.id, title: board.title, visibility: board.visibility },
        access,
      });
      return true;
    }
  }

  return false;
}
