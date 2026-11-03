/**
 * Organisation routes: agents, the org policy, skills and publishing a skill.
 */
import { fail, json, readBody } from "./iam-api.mjs";
import { RISKS, SKILL_HANDLERS, SKILL_TOOLS, integer } from "./agent-api-shared.mjs";

export async function handleOrgRoutes(ctx) {
  const { request, response, parts, method, store, me, audit, isMember, isOrgAdmin } = ctx;

  if (parts[0] === "orgs" && parts[2] === "agents") {
    const orgId = parts[1];
    if (!(await isMember(orgId))) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      const all = await store.listAgents(orgId);
      const admin = await isOrgAdmin(orgId);
      json(response, 200, { agents: admin ? all : all.filter((agent) => agent.owner_id === me.id) });
      return true;
    }
    if (method === "POST") {
      const policy = await store.getOrgPolicy(orgId);
      if (!policy.agentsEnabled) {
        fail(response, 403, "AGENTS_DISABLED", "agents are disabled in this organisation");
        return true;
      }
      const body = await readBody(request);
      const name = String(body?.name ?? "").trim().slice(0, 60);
      if (!name) {
        fail(response, 422, "NAME_REQUIRED", "give the agent a name");
        return true;
      }
      const credentialId = body?.credentialId ? String(body.credentialId) : null;
      if (credentialId) {
        const row = await store.getAiCredential(credentialId);
        const allowed =
          row &&
          ((row.scope === "user" && row.scope_id === me.id) ||
            (row.scope === "org" && row.scope_id === orgId));
        if (!allowed) {
          fail(response, 422, "BAD_CREDENTIAL", "choose a key that belongs to you or this organisation");
          return true;
        }
      }
      const agent = await store.createAgent({
        orgId,
        ownerId: me.id,
        name,
        createdBy: me.id,
        credentialId,
        model: body?.model ? String(body.model).trim().slice(0, 120) : null,
      });
      await audit({ orgId, action: "agent.create", subject: agent.name, agentId: agent.id });
      json(response, 201, { agent });
      return true;
    }
  }

  if (parts[0] === "orgs" && parts[2] === "agent-policy") {
    const orgId = parts[1];
    if (!(await isMember(orgId))) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      const policy = await store.getOrgPolicy(orgId);
      json(response, 200, { agentsEnabled: policy.agentsEnabled });
      return true;
    }
    if (method === "PUT") {
      if (!(await isOrgAdmin(orgId))) {
        fail(response, 403, "FORBIDDEN", "only an organisation admin can change this");
        return true;
      }
      const body = await readBody(request);
      const enabled = body?.agentsEnabled === true;
      await store.setOrgAgentsEnabled(orgId, enabled);
      if (!enabled) await store.cancelQueuedAgentTasksForOrg(orgId);
      await audit({ orgId, action: "agent.policy.update", subject: enabled ? "on" : "off" });
      json(response, 200, { agentsEnabled: enabled });
      return true;
    }
  }

  if (parts[0] === "orgs" && parts[2] === "skills") {
    const orgId = parts[1];
    if (!(await isMember(orgId))) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      json(response, 200, { skills: await store.listAgentSkills(orgId) });
      return true;
    }
    if (method === "POST") {
      if (!(await isOrgAdmin(orgId))) {
        fail(response, 403, "FORBIDDEN", "only an organisation admin can publish skills");
        return true;
      }
      const body = await readBody(request);
      const slug = String(body?.slug ?? "").trim().toLowerCase();
      const name = String(body?.name ?? "").trim().slice(0, 80);
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug) || !name) {
        fail(response, 422, "BAD_SKILL", "slug and name are required");
        return true;
      }
      const handler = String(body?.handler ?? "");
      if (!SKILL_HANDLERS.has(handler)) {
        fail(response, 422, "SKILL_NOT_SUPPORTED", "no runtime implements this handler");
        return true;
      }
      const risk = RISKS.has(body?.risk) ? body.risk : "propose";
      const required = Array.isArray(body?.requiredCapabilities)
        ? body.requiredCapabilities.filter((cap) => ["board.read", "board.edit"].includes(cap))
        : ["board.read"];
      const tools = Array.isArray(body?.tools)
        ? body.tools.filter((tool) => SKILL_TOOLS.has(tool))
        : ["read_board"];
      const skill = await store.createAgentSkill({
        orgId,
        slug,
        version: integer(body?.version, 1, 999, 1),
        name,
        description: String(body?.description ?? "").slice(0, 500),
        requiredCapabilities: required,
        tools,
        risk,
        handler,
        createdBy: me.id,
      });
      await audit({ orgId, action: "skill.create", subject: `${slug}@${skill.version}` });
      json(response, 201, { skill });
      return true;
    }
  }

  if (parts[0] === "skills" && parts[1] && parts[2] === "publish" && method === "POST") {
    const skill = await store.getAgentSkill(parts[1]);
    if (!skill || !skill.org_id) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (!(await isOrgAdmin(skill.org_id))) {
      fail(response, 403, "FORBIDDEN", "only an organisation admin can publish skills");
      return true;
    }
    const published = await store.publishAgentSkill(skill.id, me.id);
    if (!published) {
      fail(response, 409, "SKILL_NOT_DRAFT", "this skill is already published");
      return true;
    }
    await audit({
      orgId: skill.org_id,
      action: "skill.publish",
      subject: `${skill.slug}@${skill.version}`,
    });
    json(response, 200, { skill: published });
    return true;
  }

  return false;
}
