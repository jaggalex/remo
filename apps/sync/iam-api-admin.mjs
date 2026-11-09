/**
 * Administration: admin roles, suspending and restoring members, the audit log, and
transferring a board to another owner.
 */
import { accessForBoard, fail, json, readBody } from "./iam-http.mjs";

export async function handleAdminRoutes(ctx) {
  const { request, response, url, store, method, parts, audit, requireUser, hasOrgRole, onAclChanged, onUserSuspended } = ctx;

  /** Administration reaches this organisation's people, never an arbitrary account. */
  const notMember = () => fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");

  if (parts[0] === "orgs" && parts[2] === "admin-roles" && parts[1] && method === "PUT") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can assign roles"), true;
    }
    const role = parts[4];
    if (!["org_admin", "user_admin", "security_admin"].includes(role)) {
      return fail(response, 422, "BAD_ROLE", "unknown role"), true;
    }
    const seat = await store.getOrgMembership(orgId, parts[3]);
    if (seat?.state !== "active" || seat.relation !== "member") {
      return fail(response, 422, "TARGET_NOT_MEMBER", "the person must be an active member"), true;
    }
    await store.setOrgAdmin({ orgId, userId: parts[3], role, grantedBy: me.id });
    await audit({ actorId: me.id, orgId, action: "admin.grant", subject: `${parts[3]}:${role}` });
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "admin-roles" && parts[1] && method === "DELETE") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can revoke roles"), true;
    }
    const result = await store.removeOrgRole(orgId, parts[3], parts[4]);
    if (result.lastAdmin) {
      return fail(response, 409, "LAST_ADMIN", "the organisation needs at least one admin"), true;
    }
    await audit({ actorId: me.id, orgId, action: "admin.revoke", subject: `${parts[3]}:${parts[4]}` });
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "members" && parts[1] && parts[4] === "suspend" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const userId = parts[3];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only an administrator can suspend members"), true;
    }
    if (!(await store.getOrgMembership(orgId, userId))) return notMember(), true;
    // Suspending the last admin would leave the organisation unmanageable.
    if (await store.hasOrgRole(orgId, userId, "org_admin")) {
      const admins = await store.countOrgAdmins(orgId);
      if (admins <= 1) {
        return fail(response, 409, "LAST_ADMIN", "the last admin cannot be suspended"), true;
      }
    }
    await store.suspendOrgMember(orgId, userId);
    await audit({ actorId: me.id, orgId, action: "member.suspend", subject: userId });
    await onUserSuspended?.(userId);
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "members" && parts[1] && parts[4] === "restore" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const userId = parts[3];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only an administrator can restore members"), true;
    }
    const restored = await store.restoreOrgMember(orgId, userId);
    if (!restored) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    await audit({ actorId: me.id, orgId, action: "member.restore", subject: userId });
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "members" && parts[1] && method === "DELETE" && parts[3]) {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const userId = parts[3];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only an administrator can remove members"), true;
    }
    if (!(await store.getOrgMembership(orgId, userId))) return notMember(), true;
    const owned = await store.listBoardsOwnedBy(orgId, userId);
    if (owned.length) {
      json(response, 409, {
        error: "OWNER_TRANSFER_REQUIRED",
        message: "transfer these boards before removing the person",
        boards: owned,
      });
      return true;
    }
    if ((await store.hasOrgRole(orgId, userId, "org_admin")) && (await store.countOrgAdmins(orgId)) <= 1) {
      return fail(response, 409, "LAST_ADMIN", "the last admin cannot be removed"), true;
    }
    await store.removeOrgMember(orgId, userId);
    await audit({ actorId: me.id, orgId, action: "member.remove", subject: userId });
    await onUserSuspended?.(userId);
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "audit" && parts[1] && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await hasOrgRole(orgId, me.id, ["org_admin", "security_admin"]))) {
      return fail(response, 403, "FORBIDDEN", "only security or organisation admins can read the audit"), true;
    }
    json(response, 200, { events: await store.listAudit(orgId, { limit: Number(url.searchParams.get("limit") ?? 100) }) });
    return true;
  }

  if (parts[0] === "boards" && parts[1] && parts[2] === "transfer" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const boardId = parts[1];
    const board = await store.getIamBoard(boardId);
    if (!board || !board.owner_id) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    const resolved = await accessForBoard({ store, boardId, userId: me.id });
    if (!resolved?.access.capabilities.includes("board.transfer")) {
      return fail(response, 403, "FORBIDDEN", "only the owner can transfer this board"), true;
    }
    const body = await readBody(request);
    const target = body?.userId ? await store.findUserById(String(body.userId)) : null;
    if (!target) return fail(response, 422, "USER_REQUIRED", "userId is required"), true;
    // A guest is a collaborator of one board, never an owner (spec/IAM-v1.md §3).
    const targetSeat = await store.getOrgMembership(board.org_id, target.id);
    if (!targetSeat || targetSeat.state !== "active" || targetSeat.relation !== "member") {
      return fail(response, 422, "TARGET_NOT_MEMBER", "the new owner must be in the organisation"), true;
    }
    const transferred = await store.transferBoard({
      boardId,
      fromUserId: me.id,
      toUserId: target.id,
    });
    if (!transferred) return fail(response, 409, "NOT_OWNER", "ownership changed meanwhile"), true;
    await audit({
      actorId: me.id,
      orgId: board.org_id,
      boardId,
      action: "board.transfer",
      subject: target.email,
      before: { ownerId: me.id },
      after: { ownerId: target.id },
    });
    // ADR-189: a new owner gets a clean room agent. Unfinished work stops and the
    // assignment is cleared; history and the frames already written stay.
    if (typeof store.releaseBoardAgent === "function") {
      const released = await store.releaseBoardAgent(boardId, "ownership changed");
      if (released) {
        await audit({
          actorId: me.id,
          orgId: board.org_id,
          boardId,
          action: "board.agent.assign",
          subject: "off",
          reason: "ownership changed",
        });
      }
    }
    await onAclChanged?.(boardId);
    json(response, 200, { board: transferred });
    return true;
  }

  return false;
}
