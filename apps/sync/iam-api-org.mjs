/**
 * Organisation routes: creating an org, its boards, teams and member list.
 */
import { emitMetric } from "./metrics-events.mjs";
import { orgCapabilitiesFor } from "./iam.mjs";
import { boardIdFor, fail, json, orgSlugFor, readBody } from "./iam-http.mjs";

/** A display name for an organisation or a team: one line, 1–120 characters. */
function nameProblem(value) {
  const name = String(value ?? "").trim();
  if (!name) return "a name is required";
  if (name.length > 120) return "the name must be at most 120 characters";
  return null;
}

export async function handleOrgRoutes(ctx) {
  const { request, response, url, store, method, parts, audit, requireUser, membershipOf, isActiveMember, isOrgAdmin, hasOrgRole } = ctx;

  if (url.pathname === "/orgs" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const body = await readBody(request);
    if (!body?.name) return fail(response, 422, "ORG_NAME_REQUIRED", "a name is required"), true;
    const { org } = await store.createOrgWithOwner({
      name: String(body.name),
      slug: orgSlugFor(body.name),
      userId: me.id,
      kind: "shared",
    });
    await audit({ actorId: me.id, orgId: org.id, action: "org.create", subject: org.name });
    json(response, 201, { org });
    return true;
  }

  if (url.pathname === "/orgs" && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    json(response, 200, { orgs: await store.listOrgsForUser(me.id) });
    return true;
  }

  if (parts[0] === "orgs" && parts[1] && parts.length === 2 && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    const org = await store.getOrg(parts[1]);
    const membership = org ? await membershipOf(org.id, me.id) : null;
    if (!org || !membership || membership.state === "removed") {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    // The caller's own roles travel with the organisation: the screens decide what to
    // offer from them, and the server decides again on every mutation.
    json(response, 200, {
      org,
      membership,
      roles: await store.listOrgRoles(org.id, me.id),
    });
    return true;
  }

  if (parts[0] === "orgs" && parts[1] && parts.length === 2 && method === "PATCH") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await isOrgAdmin(orgId, me.id))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can rename it"), true;
    }
    const body = await readBody(request);
    const problem = nameProblem(body?.name);
    if (problem) return fail(response, 422, "ORG_NAME_REQUIRED", problem), true;
    const org = await store.renameOrg({ orgId, name: String(body.name).trim() });
    if (!org) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    await audit({ actorId: me.id, orgId, action: "org.rename", subject: org.name });
    json(response, 200, { org });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "boards" && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const membership = await membershipOf(orgId, me.id);
    if (!membership || membership.state !== "active") {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    if (!orgCapabilitiesFor(membership).includes("board.create")) {
      return fail(
        response,
        403,
        "BOARD_CREATE_FORBIDDEN",
        "guests cannot create boards; ask an administrator",
      ), true;
    }
    const body = await readBody(request);
    const teams = await store.listTeams(orgId);
    const team = body?.teamId
      ? teams.find((candidate) => candidate.id === body.teamId)
      : teams[0];
    if (!team) return fail(response, 422, "TEAM_REQUIRED", "create a team first"), true;

    const id = boardIdFor(body?.title ?? "board");
    const board = await store.createIamBoard({
      id,
      orgId,
      teamId: team.id,
      ownerId: me.id,
      title: String(body?.title ?? "Untitled board"),
    });
    await audit({ actorId: me.id, orgId, boardId: id, action: "board.create", subject: board.title });
    emitMetric({
      name: "board.created",
      orgId,
      actorId: me.id,
      boardId: id,
      props: { teamId: team.id },
    });
    // A board created here already has an owner, so there is nothing to claim: the
    // claim path exists for rooms that predate accounts (ADR-064).
    json(response, 201, { board });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "boards" && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await isActiveMember(orgId, me.id))) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    json(response, 200, { boards: await store.listBoardsForOrg(orgId, me.id) });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "teams" && parts.length === 3 && method === "POST") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await isOrgAdmin(orgId, me.id))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can add teams"), true;
    }
    const body = await readBody(request);
    if (!body?.name) return fail(response, 422, "TEAM_NAME_REQUIRED", "a name is required"), true;
    const team = await store.createTeam({ orgId, name: String(body.name) });
    await audit({ actorId: me.id, orgId, action: "team.create", subject: team.name });
    json(response, 201, { team });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "teams" && parts.length === 3 && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await isActiveMember(orgId, me.id))) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    json(response, 200, { teams: await store.listTeams(orgId) });
    return true;
  }

  if (parts[0] === "orgs" && parts[2] === "teams" && parts[3] && parts.length === 4) {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const teamId = parts[3];
    if (!(await isOrgAdmin(orgId, me.id))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can change teams"), true;
    }
    const team = await store.getTeam(orgId, teamId);
    if (!team) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;

    if (method === "PATCH") {
      const body = await readBody(request);
      const problem = nameProblem(body?.name);
      if (problem) return fail(response, 422, "TEAM_NAME_REQUIRED", problem), true;
      try {
        const renamed = await store.renameTeam({
          orgId,
          teamId,
          name: String(body.name).trim(),
        });
        if (!renamed) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
        await audit({ actorId: me.id, orgId, action: "team.rename", subject: renamed.name });
        json(response, 200, { team: renamed });
      } catch (error) {
        if (error?.code === "23505") {
          return fail(response, 409, "TEAM_NAME_TAKEN", "a team with this name already exists"), true;
        }
        throw error;
      }
      return true;
    }

    if (method === "DELETE") {
      const usage = await store.teamUsage(teamId);
      if (usage.boards || usage.grants) {
        return json(
          response,
          409,
          {
            error: "TEAM_IN_USE",
            message: "move its boards and remove its grants first",
            boards: usage.boards,
            grants: usage.grants,
          },
        ), true;
      }
      await store.deleteTeam({ orgId, teamId });
      await audit({ actorId: me.id, orgId, action: "team.delete", subject: team.name });
      json(response, 200, { ok: true });
      return true;
    }
  }

  if (
    parts[0] === "orgs" &&
    parts[2] === "teams" &&
    parts[3] &&
    parts[4] === "members"
  ) {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    const teamId = parts[3];
    const team = await store.getTeam(orgId, teamId);
    if (!team) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;

    if (method === "GET" && parts.length === 5) {
      const membership = await membershipOf(orgId, me.id);
      if (!membership || membership.state !== "active") {
        return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      }
      json(response, 200, { members: await store.listTeamMembers(teamId) });
      return true;
    }

    if (!(await isOrgAdmin(orgId, me.id))) {
      return fail(response, 403, "FORBIDDEN", "only an organisation admin can change teams"), true;
    }

    if (method === "POST" && parts.length === 5) {
      const body = await readBody(request);
      const userId = String(body?.userId ?? "");
      const role = body?.role === "admin" ? "admin" : "member";
      const target = await membershipOf(orgId, userId);
      if (!target || target.state !== "active" || target.relation !== "member") {
        return fail(response, 422, "TARGET_NOT_MEMBER", "add an active member of this organisation"), true;
      }
      await store.addTeamMember({ teamId, userId, role });
      await audit({ actorId: me.id, orgId, action: "team.member.add", subject: userId });
      json(response, 200, { ok: true });
      return true;
    }

    if (method === "DELETE" && parts.length === 6) {
      const removed = await store.removeTeamMember({ teamId, userId: parts[5] });
      if (!removed) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
      await audit({ actorId: me.id, orgId, action: "team.member.remove", subject: parts[5] });
      json(response, 200, { ok: true });
      return true;
    }
  }

  if (parts[0] === "orgs" && parts[2] === "members" && method === "GET") {
    const me = requireUser();
    if (!me) return true;
    const orgId = parts[1];
    if (!(await isActiveMember(orgId, me.id))) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    // A guest is an external collaborator of one board, not a colleague: only an
    // administrator gets the guest list (and the addresses that come with it).
    const admin = await hasOrgRole(orgId, me.id, [
      "org_admin",
      "user_admin",
      "security_admin",
    ]);
    json(response, 200, {
      members: await store.listOrgMembers(orgId, { includeGuests: admin }),
    });
    return true;
  }

  return false;
}
