/**
 * The accounts API, as the browser sees it.
 *
 * Same origin through the dev proxy (`/api` → sync service), cookies included by
 * default because the session lives in an httpOnly cookie and there is no token for
 * JavaScript to hold (ADR-062).
 */

import { ApiError, call } from "./apiCall";
import type { VoteSession } from "./vote/voteTypes";

export { ApiError, call } from "./apiCall";

export type {
  VoteBreakdown,
  VoteBreakdownGuests,
  VoteBreakdownObject,
  VoteBreakdownSummaryRow,
  VoteBreakdownVoter,
  VoteSession,
} from "./vote/voteTypes";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  handle: string;
  /** Display preferences that follow the account, not the browser (ADR-150). */
  preferences?: { theme: "system" | "light" | "dark" | null; lang: "ru" | "en" | null };
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  relation: string;
  state: string;
  /** Organisation-level capabilities; `board.create` for an active member (ADR-100). */
  capabilities?: string[];
}

export interface Access {
  allowed: boolean;
  role: string | null;
  capabilities: string[];
  sources: string[];
  reason: string;
  aclVersion?: number;
}

/** A node in a declarative app panel (ADR-098). The host draws these, never HTML. */
export interface PanelNode {
  type: "panel" | "text" | "button" | "field";
  id?: string;
  key?: string;
  titleKey?: string;
  labelKey?: string;
  action?: string;
  params?: string[];
  children?: PanelNode[];
}

/** An app installed in the organisation, as the board panel sees it. */
export interface InstalledApp {
  appId: string;
  version: number;
  state: "enabled" | "disabled";
  panel: PanelNode | null;
  capabilities: string[];
  installedAt?: string;
  updatedAt?: string;
}

export interface AppActionMessage {
  key: string;
  params?: Record<string, string>;
}

export interface Grant {
  subject_type: "user" | "team" | "org";
  subject_id: string;
  role: string;
  granted_by: string | null;
  created_at: string;
  /** Resolved by the server so the dialog can show a person, not a uuid. */
  subject_name?: string | null;
  subject_email?: string | null;
  /** How this grant was created: direct user, team or organisation. */
  source?: "direct" | "team" | "org";
}

/** The administrator roles a person may hold in an organisation (ADR-061). */
export const ORG_ROLES = ["org_admin", "user_admin", "security_admin"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export interface OrgMember {
  id: string;
  email: string;
  name: string;
  relation: "member" | "guest";
  state: "active" | "suspended" | "invited";
  roles: OrgRole[];
}

export interface OrgInvitation {
  id: string;
  email: string;
  subject_kind: "member" | "guest";
  role: string;
  state: string;
  expires_at: string;
  created_at: string;
}

export interface Agent {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  state: "active" | "disabled";
  owner_name?: string;
  owner_email?: string;
  active_tokens?: number;
  created_at: string;
  disabled_at?: string | null;
}

export interface AgentToken {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface AgentTask {
  id: string;
  agent_id: string;
  agent_name?: string;
  board_id: string;
  intent: string;
  skill_slug: string | null;
  status: "queued" | "running" | "awaiting_approval" | "applied" | "failed" | "cancelled";
  budget: Record<string, number>;
  usage: Record<string, number>;
  progress?: { done?: number; total?: number; chunks?: number };
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentSchedule {
  id: string;
  agent_id: string;
  agent_name?: string;
  board_id: string;
  intent: string;
  skill_slug: string;
  interval_seconds: number;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
}

export interface AgentSkill {
  id: string;
  org_id: string | null;
  slug: string;
  version: number;
  name: string;
  description: string;
  risk: string;
  required_capabilities: string[];
  state: string;
}

export interface AiCredential {
  id: string;
  scope: "user" | "org";
  scopeId: string;
  provider: string;
  label: string;
  baseUrl: string;
  model: string | null;
  fingerprint: string;
  isDefault: boolean;
  state: string;
  createdAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
}

export interface AiPolicy {
  keyMode: "either" | "org" | "personal";
  providers: string[];
  models: string[];
}

export interface AiRun {
  id: string;
  seq: number;
  status: string;
  provider: string | null;
  model: string | null;
  skill: string | null;
  skill_version: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  key_fingerprint: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  hash: string;
}

export interface AiChainCheck {
  ok: boolean;
  brokenAt: number | null;
  reason: string | null;
  checked: number;
  lastHash?: string;
  anchor: { seq: number; hash: string; destination: string; created_at: string } | null;
}

export interface ChangeSet {
  id: string;
  board_id: string;
  agent_id: string;
  agent_name?: string;
  status: "draft" | "queued" | "running" | "applied" | "failed" | "cancelled" | "stale";
  estimate: { cards?: number; skipped?: Array<{ sourceId: string; reason: string }> };
  progress: { done?: number; total?: number; chunks?: number };
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface BoardAgents {
  enabled: boolean;
  orgEnabled: boolean;
  agents: Agent[];
  tasks: AgentTask[];
  schedules: AgentSchedule[];
  skills: AgentSkill[];
}

export interface AuditEvent {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  board_id: string | null;
  board_title: string | null;
  action: string;
  subject: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

export const api = {
  me: () =>
    call<{ user: SessionUser; orgs: OrgSummary[]; csrfToken?: string | null }>("/auth/me"),
  register: (body: { email: string; password: string; name: string }) =>
    call<{ user: SessionUser; org: { id: string }; team: { id: string } }>("/auth/register", {
      method: "POST",
      body,
    }),
  login: (body: { email: string; password: string }) =>
    call<{ user: SessionUser }>("/auth/login", { method: "POST", body }),
  renameAccount: (body: { name?: string; handle?: string }) =>
    call<{ user: SessionUser }>("/auth/me", { method: "PATCH", body }),
  updatePreferences: (body: { theme: string | null; lang: string | null }) =>
    call<{ preferences: NonNullable<SessionUser["preferences"]> }>("/auth/preferences", { method: "PATCH", body }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  access: (boardId: string) =>
    call<{
      access: Access;
      board?: { id: string; title: string; claimed: boolean; orgId?: string; visibility?: string };
    }>(`/boards/${encodeURIComponent(boardId)}/access`),
  boardPeople: (boardId: string) =>
    call<{ people: Array<{ id: string; name: string }> }>(
      `/boards/${encodeURIComponent(boardId)}/people`,
    ),
  unlockLink: (boardId: string, password: string) =>
    call<{ ok: true }>(`/boards/${encodeURIComponent(boardId)}/link/unlock`, {
      method: "POST",
      body: { password },
    }),

  /* -------------------------------------------------------- facilitation -- */
  boardVoteSessions: (boardId: string) =>
    call<{ sessions: VoteSession[] }>(
      `/boards/${encodeURIComponent(boardId)}/vote-sessions`,
    ),
  createVoteSession: (
    boardId: string,
    body: {
      objectIds: string[];
      votesPerSubject: number;
      minutes: number | null;
      anonymous: boolean;
      /** Pin the session to the board timer; wins over `minutes` (ADR-115). */
      endsAt?: string;
    },
  ) =>
    call<{ session: VoteSession }>(
      `/boards/${encodeURIComponent(boardId)}/vote-sessions`,
      { method: "POST", body },
    ),
  voteSession: (id: string) =>
    call<{ session: VoteSession }>(`/vote-sessions/${encodeURIComponent(id)}`),
  castVote: (id: string, objectId: string) =>
    call<{ session: VoteSession }>(
      `/vote-sessions/${encodeURIComponent(id)}/votes`,
      { method: "POST", body: { objectId } },
    ),
  withdrawVote: (id: string, objectId: string) =>
    call<{ session: VoteSession }>(
      `/vote-sessions/${encodeURIComponent(id)}/votes/${encodeURIComponent(objectId)}`,
      { method: "DELETE" },
    ),
  extendVoteSession: (id: string, minutes: number) =>
    call<{ session: VoteSession }>(
      `/vote-sessions/${encodeURIComponent(id)}/extend`,
      { method: "POST", body: { minutes } },
    ),
  endVoteSession: (id: string) =>
    call<{ session: VoteSession }>(
      `/vote-sessions/${encodeURIComponent(id)}/end`,
      { method: "POST" },
    ),
  publishVoteSession: (id: string) =>
    call<{
      session: VoteSession;
      results: { objects: Array<{ object_id: string; votes: number }>; voters: number };
    }>(`/vote-sessions/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  /* ---------------------------------------------------------------- apps -- */
  apps: (orgId: string) =>
    call<{ apps: InstalledApp[] }>(`/orgs/${encodeURIComponent(orgId)}/apps`),
  installApp: (orgId: string, appId: string) =>
    call<{ app: InstalledApp }>(`/orgs/${encodeURIComponent(orgId)}/apps`, {
      method: "POST",
      body: { appId },
    }),
  setAppState: (orgId: string, appId: string, enabled: boolean) =>
    call<{ app: InstalledApp }>(
      `/orgs/${encodeURIComponent(orgId)}/apps/${encodeURIComponent(appId)}`,
      { method: "PATCH", body: { enabled } },
    ),
  removeApp: (orgId: string, appId: string) =>
    call<{ ok: true }>(`/orgs/${encodeURIComponent(orgId)}/apps/${encodeURIComponent(appId)}`, {
      method: "DELETE",
    }),
  invokeApp: (
    orgId: string,
    appId: string,
    body: { boardId: string; action: string },
  ) =>
    call<{ appId: string; action: string; result: { message?: AppActionMessage } }>(
      `/orgs/${encodeURIComponent(orgId)}/apps/${encodeURIComponent(appId)}/invoke`,
      { method: "POST", body },
    ),

  /* ------------------------------------------------------------ commands -- */
  runCommand: (
    boardId: string,
    body: { command: string; input: unknown; ifVersion?: string },
    idempotencyKey: string,
  ) =>
    call<{ result: Record<string, unknown>; version: string; replayed?: boolean }>(
      `/boards/${encodeURIComponent(boardId)}/commands`,
      { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } },
    ),

  /* ------------------------------------------------------------- export -- */
  createExportJob: (
    boardId: string,
    body: { scope: "selection" | "frame" | "board"; format: "png" | "pdf"; objectCount: number },
  ) =>
    call<{ jobId: string }>(`/boards/${encodeURIComponent(boardId)}/export-jobs`, {
      method: "POST",
      body,
    }),
  completeExportJob: (boardId: string, jobId: string, bytes: number) =>
    call<{ ok: true }>(
      `/boards/${encodeURIComponent(boardId)}/export-jobs/${encodeURIComponent(jobId)}/complete`,
      { method: "POST", body: { bytes } },
    ),
  downloadBackup: async (boardId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/backup`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const text = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        /* a proxy may answer with HTML; the status is still meaningful */
      }
      throw new ApiError(
        response.status,
        String(payload.error ?? "REQUEST_FAILED"),
        String(payload.message ?? "request failed"),
        payload,
      );
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "board.remo-backup.json";
    return { blob: await response.blob(), filename };
  },
  claim: (boardId: string, token?: string) =>
    call<{ board: { id: string; title: string } }>(
      `/boards/${encodeURIComponent(boardId)}/claim`,
      { method: "POST", body: token ? { token } : {} },
    ),
  deleteBoard: (boardId: string) =>
    call<{ board: { id: string; archivedAt: string } }>(
      `/boards/${encodeURIComponent(boardId)}`,
      { method: "DELETE" },
    ),
  restoreBoard: (boardId: string) =>
    call<{ board: { id: string; archivedAt: null } }>(
      `/boards/${encodeURIComponent(boardId)}/restore`,
      { method: "POST" },
    ),
  duplicateBoard: (boardId: string) =>
    call<{ board: { id: string; title: string } }>(
      `/boards/${encodeURIComponent(boardId)}/duplicate`,
      { method: "POST" },
    ),
  grants: (boardId: string) =>
    call<{ grants: Grant[]; aclVersion: number }>(
      `/boards/${encodeURIComponent(boardId)}/grants`,
    ),
  setGrant: (boardId: string, body: { subjectType: "user" | "team" | "org"; subjectId: string; role: string }) =>
    call<{ aclVersion: number }>(`/boards/${encodeURIComponent(boardId)}/grants`, {
      method: "POST",
      body,
    }),
  addGrant: (boardId: string, body: { email?: string; subjectId?: string; role: string }) =>
    call<{ aclVersion: number }>(`/boards/${encodeURIComponent(boardId)}/grants`, {
      method: "POST",
      body: { subjectType: "user", ...body },
    }),
  removeGrant: (boardId: string, subjectType: string, subjectId: string) =>
    call<{ aclVersion: number }>(
      `/boards/${encodeURIComponent(boardId)}/grants/${subjectType}/${encodeURIComponent(subjectId)}`,
      { method: "DELETE" },
    ),
  inviteGuest: (boardId: string, body: { email: string; role: string }) =>
    call<{ invitation: { id: string; email: string }; url: string }>(
      `/boards/${encodeURIComponent(boardId)}/invitations`,
      { method: "POST", body },
    ),
  acceptInvitation: (token: string) =>
    call<{ orgId: string; boardId: string | null }>("/invitations/accept", { method: "POST", body: { token } }),

  /* ------------------------------------------------------- organisation -- */
  orgs: () => call<{ orgs: OrgSummary[] }>("/orgs"),
  createOrg: (name: string) =>
    call<{ org: { id: string; name: string; slug: string } }>("/orgs", { method: "POST", body: { name } }),
  createTeam: (orgId: string, name: string) =>
    call<{ team: { id: string; name: string } }>(`/orgs/${encodeURIComponent(orgId)}/teams`, { method: "POST", body: { name } }),
  teams: (orgId: string) =>
    call<{ teams: Array<{ id: string; name: string }> }>(`/orgs/${orgId}/teams`),
  renameOrg: (orgId: string, name: string) =>
    call<{ org: { id: string; name: string; slug: string } }>(`/orgs/${encodeURIComponent(orgId)}`, {
      method: "PATCH",
      body: { name },
    }),
  renameTeam: (orgId: string, teamId: string, name: string) =>
    call<{ team: { id: string; name: string } }>(
      `/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}`,
      { method: "PATCH", body: { name } },
    ),
  deleteTeam: (orgId: string, teamId: string) =>
    call<{ ok: true }>(`/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}`, {
      method: "DELETE",
    }),
  teamMembers: (orgId: string, teamId: string) =>
    call<{ members: Array<{ id: string; name: string; email: string; role: "admin" | "member" }> }>(
      `/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}/members`,
    ),
  addTeamMember: (orgId: string, teamId: string, userId: string, role: "admin" | "member") =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}/members`,
      { method: "POST", body: { userId, role } },
    ),
  removeTeamMember: (orgId: string, teamId: string, userId: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  createBoard: (orgId: string, body: { title: string; teamId?: string }) =>
    call<{ board: { id: string; title: string } }>(`/orgs/${orgId}/boards`, { method: "POST", body }),
  org: (orgId: string) =>
    call<{
      org: { id: string; name: string; slug: string };
      membership: { relation: string; state: string };
      roles: OrgRole[];
    }>(`/orgs/${encodeURIComponent(orgId)}`),
  members: (orgId: string) =>
    call<{ members: OrgMember[] }>(`/orgs/${encodeURIComponent(orgId)}/members`),
  invitations: (orgId: string) =>
    call<{ invitations: OrgInvitation[] }>(`/orgs/${encodeURIComponent(orgId)}/invitations`),
  inviteMember: (orgId: string, email: string) =>
    call<{ invitation: OrgInvitation; url: string }>(
      `/orgs/${encodeURIComponent(orgId)}/invitations`,
      { method: "POST", body: { email } },
    ),
  revokeInvitation: (orgId: string, id: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  setAdminRole: (orgId: string, userId: string, role: OrgRole) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/admin-roles/${encodeURIComponent(userId)}/${role}`,
      { method: "PUT" },
    ),
  removeAdminRole: (orgId: string, userId: string, role: OrgRole) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/admin-roles/${encodeURIComponent(userId)}/${role}`,
      { method: "DELETE" },
    ),
  suspendMember: (orgId: string, userId: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/suspend`,
      { method: "POST" },
    ),
  restoreMember: (orgId: string, userId: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/restore`,
      { method: "POST" },
    ),
  removeMember: (orgId: string, userId: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  /* --------------------------------------------------------------- agents -- */

  aiRuns: (orgId: string) =>
    call<{ runs: AiRun[]; anchor: AiChainCheck["anchor"] }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/runs`,
    ),
  verifyAiRuns: (orgId: string) =>
    call<AiChainCheck>(`/orgs/${encodeURIComponent(orgId)}/ai/runs/verify`),
  aiPolicy: (orgId: string) =>
    call<{ policy: AiPolicy }>(`/orgs/${encodeURIComponent(orgId)}/ai/policy`),
  setAiPolicy: (orgId: string, policy: AiPolicy) =>
    call<{ policy: AiPolicy }>(`/orgs/${encodeURIComponent(orgId)}/ai/policy`, {
      method: "PUT",
      body: policy,
    }),
  userCredentials: () =>
    call<{ credentials: AiCredential[] }>("/users/me/ai/credentials"),
  createUserCredential: (body: {
    provider: string;
    secret: string;
    label?: string;
    model?: string;
    baseUrl?: string;
  }) =>
    call<{ credential: AiCredential }>("/users/me/ai/credentials", {
      method: "POST",
      body,
    }),
  deleteUserCredential: (id: string) =>
    call<{ ok: true }>(`/users/me/ai/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  rotateUserCredential: (id: string, secret: string) =>
    call<{ credential: AiCredential }>(
      `/users/me/ai/credentials/${encodeURIComponent(id)}/rotate`,
      { method: "POST", body: { secret } },
    ),
  defaultUserCredential: (id: string) =>
    call<{ ok: true }>(`/users/me/ai/credentials/${encodeURIComponent(id)}/default`, {
      method: "POST",
    }),
  testUserCredential: (id: string) =>
    call<{ ok: true }>(`/users/me/ai/credentials/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  orgCredentials: (orgId: string) =>
    call<{ credentials: AiCredential[] }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/credentials`,
    ),
  createOrgCredential: (
    orgId: string,
    body: { provider: string; secret: string; label?: string; model?: string; baseUrl?: string },
  ) =>
    call<{ credential: AiCredential }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/credentials`,
      { method: "POST", body },
    ),
  deleteOrgCredential: (orgId: string, id: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  testOrgCredential: (orgId: string, id: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/credentials/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  orgCredentialDefault: (orgId: string, id: string) =>
    call<{ ok: true }>(
      `/orgs/${encodeURIComponent(orgId)}/ai/credentials/${encodeURIComponent(id)}/default`,
      { method: "POST" },
    ),
  agentPolicy: (orgId: string) =>
    call<{ agentsEnabled: boolean }>(`/orgs/${encodeURIComponent(orgId)}/agent-policy`),
  setAgentPolicy: (orgId: string, agentsEnabled: boolean) =>
    call<{ agentsEnabled: boolean }>(`/orgs/${encodeURIComponent(orgId)}/agent-policy`, {
      method: "PUT",
      body: { agentsEnabled },
    }),
  agents: (orgId: string) =>
    call<{ agents: Agent[] }>(`/orgs/${encodeURIComponent(orgId)}/agents`),
  createAgent: (orgId: string, name: string) =>
    call<{ agent: Agent }>(`/orgs/${encodeURIComponent(orgId)}/agents`, {
      method: "POST",
      body: { name },
    }),
  updateAgent: (agentId: string, body: { name?: string; state?: "active" | "disabled" }) =>
    call<{ agent: Agent }>(`/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body,
    }),
  agentTokens: (agentId: string) =>
    call<{ tokens: AgentToken[] }>(`/agents/${encodeURIComponent(agentId)}/tokens`),
  createAgentToken: (agentId: string, body: { label?: string; expiresInDays?: number }) =>
    call<{ secret: string; token: AgentToken }>(
      `/agents/${encodeURIComponent(agentId)}/tokens`,
      { method: "POST", body },
    ),
  revokeAgentToken: (agentId: string, tokenId: string) =>
    call<{ ok: true }>(
      `/agents/${encodeURIComponent(agentId)}/tokens/${encodeURIComponent(tokenId)}`,
      { method: "DELETE" },
    ),
  skills: (orgId: string) =>
    call<{ skills: AgentSkill[] }>(`/orgs/${encodeURIComponent(orgId)}/skills`),
  boardAgents: (boardId: string) =>
    call<BoardAgents>(`/boards/${encodeURIComponent(boardId)}/agents`),
  setBoardAgents: (boardId: string, enabled: boolean) =>
    call<{ enabled: boolean }>(`/boards/${encodeURIComponent(boardId)}/agents`, {
      method: "PUT",
      body: { enabled },
    }),
  createAgentTask: (
    boardId: string,
    body: {
      agentId: string;
      intent: string;
      skillSlug?: string;
      origin?: { x: number; y: number };
      budget?: { maxTokens?: number; maxCostUsd?: number; maxActions?: number };
      selectionIds?: string[];
      /** Tidy only: the reading the engine lays out (ADR-143). */
      strategy?: "auto" | "grid" | "prefix" | "type" | "meaning";
      target?: { kind: "standalone" | "kanban"; kanbanId?: string; columnId?: string };
      mode?: "copy" | "move";
      /** Extra brief text; the file is UTF-8 text, never the original bytes (ADR-142). */
      text?: string;
      file?: { name: string; content: string };
    },
    idempotencyKey: string,
  ) =>
    call<{ task: AgentTask & { input?: { file?: { truncated?: boolean } } } }>(
      `/boards/${encodeURIComponent(boardId)}/agent-tasks`,
      { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } },
    ),
  createChangeSet: (
    boardId: string,
    body: {
      agentId: string;
      intent: string;
      operations: Array<{
        op: "create_cards";
        selectionIds: string[];
        target?: { kind: "standalone" | "kanban"; kanbanId?: string; columnId?: string };
        mode?: "copy" | "move";
      }>;
      budget?: { maxTokens?: number; maxCostUsd?: number; maxActions?: number };
      origin?: { x: number; y: number };
      preview?: boolean;
    },
    idempotencyKey: string,
  ) =>
    call<{ changeSet: ChangeSet; task: AgentTask | null; replayed?: boolean }>(
      `/boards/${encodeURIComponent(boardId)}/agent-change-sets`,
      { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } },
    ),
  boardChangeSets: (boardId: string) =>
    call<{ changeSets: ChangeSet[] }>(
      `/boards/${encodeURIComponent(boardId)}/agent-change-sets`,
    ),
  changeSet: (id: string) =>
    call<{ changeSet: ChangeSet; task: AgentTask | null }>(
      `/change-sets/${encodeURIComponent(id)}`,
    ),
  executeChangeSet: (id: string) =>
    call<{ changeSet: ChangeSet; task: AgentTask }>(
      `/change-sets/${encodeURIComponent(id)}/execute`,
      { method: "POST" },
    ),
  cancelChangeSet: (id: string) =>
    call<{ ok: true }>(`/change-sets/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  resumeChangeSet: (id: string) =>
    call<{ changeSet: ChangeSet; task: AgentTask }>(
      `/change-sets/${encodeURIComponent(id)}/resume`,
      { method: "POST" },
    ),
  boardAgentTasks: (boardId: string) =>
    call<{ tasks: AgentTask[] }>(`/boards/${encodeURIComponent(boardId)}/agent-tasks`),
  cancelAgentTask: (taskId: string) =>
    call<{ ok: true }>(`/agent-tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
    }),
  createAgentSchedule: (
    boardId: string,
    body: {
      agentId: string;
      intent: string;
      intervalSeconds: number;
      origin?: { x: number; y: number };
      budget?: { maxTokens?: number; maxCostUsd?: number; maxActions?: number };
    },
  ) =>
    call<{ schedule: AgentSchedule }>(
      `/boards/${encodeURIComponent(boardId)}/agent-schedules`,
      { method: "POST", body },
    ),
  boardAgentSchedules: (boardId: string) =>
    call<{ schedules: AgentSchedule[] }>(
      `/boards/${encodeURIComponent(boardId)}/agent-schedules`,
    ),
  deleteAgentSchedule: (scheduleId: string) =>
    call<{ ok: true }>(`/agent-schedules/${encodeURIComponent(scheduleId)}`, {
      method: "DELETE",
    }),

  audit: (orgId: string) =>
    call<{ events: AuditEvent[] }>(`/orgs/${encodeURIComponent(orgId)}/audit`),
  transferBoard: (boardId: string, userId: string) =>
    call<{ board: { id: string; title: string } }>(
      `/boards/${encodeURIComponent(boardId)}/transfer`,
      { method: "POST", body: { userId } },
    ),

  link: (boardId: string) =>
    call<{
      link: {
        enabled: boolean;
        role: string;
        hasPassword: boolean;
        expiresAt: string | null;
        expired: boolean;
        version: number;
      };
      visibility: string;
      url: string;
    }>(`/boards/${encodeURIComponent(boardId)}/link`),
  setLink: (
    boardId: string,
    body: { enabled?: boolean; password?: string | null; expiresAt?: string | null },
  ) =>
    call<{
      link: {
        enabled: boolean;
        role: string;
        hasPassword: boolean;
        expiresAt: string | null;
        expired: boolean;
        version: number;
      };
      url: string;
    }>(`/boards/${encodeURIComponent(boardId)}/link`, { method: "PUT", body }),
};
