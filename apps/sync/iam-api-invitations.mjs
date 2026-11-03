/**
 * Invitations: creating one for a board or an organisation, and accepting it.
 */
import { hashToken, isEmail, newToken, normalizeEmail } from "./iam.mjs";
import { accessForBoard, fail, json, readBody } from "./iam-http.mjs";

export async function handleInvitations(ctx) {
  const { request, response, url, store, method, parts, audit, requireUser, hasOrgRole, inviteUrl, onAclChanged } = ctx;

  if (parts[0] === "orgs" && parts[2] === "invitations" && parts[1]) {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];

    if (method === "GET") {
      if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
        return fail(response, 403, "FORBIDDEN", "only an administrator can list invitations"), true;
      }
      json(response, 200, { invitations: await store.listInvitations(orgId) });
      return true;
    }

    if (method === "POST" && parts.length === 3) {
      if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
        return fail(response, 403, "FORBIDDEN", "only an administrator can invite members"), true;
      }
      const body = await readBody(request);
      const email = normalizeEmail(body?.email);
      if (!isEmail(email)) return fail(response, 422, "BAD_EMAIL", "enter a valid email"), true;
      const existing = await store.findUserByEmail(email);
      if (existing && (await store.hasActiveMembership(orgId, existing.id))) {
        return fail(response, 409, "ALREADY_MEMBER", "this person is already in the organisation"), true;
      }
      const token = newToken(24);
      const invitation = await store.createInvitation({
        orgId,
        targetType: "org",
        targetId: null,
        email,
        subjectKind: "member",
        role: "member",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 86400000),
        createdBy: me.id,
      });
      await audit({ actorId: me.id, orgId, action: "invitation.create", subject: email });
      // No mail service yet: the inviter copies the link and sends it themselves.
      json(response, 201, { invitation, url: inviteUrl(token) });
      return true;
    }

    if (method === "DELETE" && parts.length === 4) {
      if (!(await hasOrgRole(orgId, me.id, ["org_admin", "user_admin"]))) {
        return fail(response, 403, "FORBIDDEN", "only an administrator can revoke invitations"), true;
      }
      const revoked = await store.revokeInvitation(orgId, parts[3]);
      if (!revoked) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      await audit({ actorId: me.id, orgId, action: "invitation.revoke", subject: parts[3] });
      json(response, 200, { ok: true });
      return true;
    }
  }

  if (url.pathname === "/invitations/accept" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const body = await readBody(request);
    if (!body?.token) return fail(response, 422, "TOKEN_REQUIRED", "token is required"), true;
    const result = await store.acceptInvitation({
      tokenHash: hashToken(String(body.token)),
      userId: me.id,
      email: me.email,
    });
    if (!result) return fail(response, 410, "INVITATION_INVALID", "this invitation is no longer valid"), true;
    if (result.expired) return fail(response, 410, "INVITATION_EXPIRED", "this invitation has expired"), true;
    // The store refuses inside the transaction, so a mismatch leaves no membership,
    // no grant and a still-pending invitation.
    if (result.mismatch) {
      return fail(response, 422, "EMAIL_MISMATCH", "sign in with the invited email"), true;
    }
    await audit({
      actorId: me.id,
      orgId: result.invitation.org_id,
      boardId: result.invitation.target_type === "board" ? result.invitation.target_id : null,
      action: "invitation.accept",
      subject: result.invitation.email,
    });
    if (result.invitation.target_type === "board" && result.invitation.target_id) {
      await onAclChanged?.(result.invitation.target_id);
    }
    json(response, 200, {
      orgId: result.invitation.org_id,
      boardId: result.invitation.target_type === "board" ? result.invitation.target_id : null,
    });
    return true;
  }

  if (parts[0] === "boards" && parts[1] && parts[2] === "invitations" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const boardId = parts[1];
    const board = await store.getIamBoard(boardId);
    if (!board || !board.owner_id) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    const resolved = await accessForBoard({ store, boardId, userId: me.id });
    if (!resolved?.access.capabilities.includes("board.share")) {
      return fail(response, 403, "FORBIDDEN", "you cannot invite to this board"), true;
    }
    const body = await readBody(request);
    const email = normalizeEmail(body?.email);
    const role = String(body?.role ?? "viewer");
    if (!isEmail(email)) return fail(response, 422, "BAD_EMAIL", "enter a valid email"), true;
    if (!["viewer", "commenter", "editor"].includes(role)) {
      return fail(response, 422, "BAD_ROLE", "guests cannot be co-owners"), true;
    }
    const existing = await store.findUserByEmail(email);
    if (existing && (await store.hasActiveMembership(board.org_id, existing.id))) {
      // The person has an account here: a grant is the right instrument, not an invite.
      return fail(response, 409, "USER_EXISTS", "add them by grant instead"), true;
    }
    const token = newToken(24);
    const invitation = await store.createInvitation({
      orgId: board.org_id,
      targetType: "board",
      targetId: boardId,
      email,
      subjectKind: "guest",
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      createdBy: me.id,
    });
    await audit({ actorId: me.id, orgId: board.org_id, boardId, action: "guest.invite", subject: email });
    json(response, 201, { invitation, url: inviteUrl(token) });
    return true;
  }

  return false;
}
