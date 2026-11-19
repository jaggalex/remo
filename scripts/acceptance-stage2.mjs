#!/usr/bin/env node
/**
 * Stage 2 manual-acceptance seed (dev only).
 *
 * Creates two accounts, a board with a direct grant and a team grant, and a second
 * board for the public-link checks. It talks to the running sync HTTP API, so it uses
 * the same routes the UI uses and does not bypass access rules.
 *
 * Usage:
 *   node scripts/acceptance-stage2.mjs
 *   REMO_API=http://localhost:1234 node scripts/acceptance-stage2.mjs
 *
 * The script is intentionally not idempotent: every run gets fresh accounts and
 * boards, so a previous acceptance run cannot change the result.
 */

const BASE = process.env.REMO_API ?? "http://localhost:1234";
const password = process.env.REMO_ACCEPTANCE_PASSWORD ?? "stage2-password-123";
const stamp = Date.now().toString(36);
const ownerEmail = `stage2-owner-${stamp}@example.com`;
const memberEmail = `stage2-member-${stamp}@example.com`;

async function api(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  const setCookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { data: text ? JSON.parse(text) : null, cookie: setCookie };
}

const owner = await api("/auth/register", {
  method: "POST",
  body: { email: ownerEmail, password, name: "Stage 2 Owner" },
});
const ownerCookie = owner.cookie;
const orgId = owner.data.org.id;
const teamId = owner.data.team.id;

const rolesBoard = (
  await api(`/orgs/${orgId}/boards`, {
    method: "POST",
    cookie: ownerCookie,
    body: { title: "Acceptance roles" },
  })
).data.board;

const linkBoard = (
  await api(`/orgs/${orgId}/boards`, {
    method: "POST",
    cookie: ownerCookie,
    body: { title: "Acceptance link" },
  })
).data.board;

const member = await api("/auth/register", {
  method: "POST",
  body: { email: memberEmail, password, name: "Stage 2 Member" },
});
const memberCookie = member.cookie;
const memberId = member.data.user.id;

// A full member seat is required before a team grant can apply. The invitation is the
// same flow the organisation screen uses; accepting it also joins the first team.
const invitation = (
  await api(`/orgs/${orgId}/invitations`, {
    method: "POST",
    cookie: ownerCookie,
    body: { email: memberEmail },
  })
).data;
const token = new URL(invitation.url).searchParams.get("invite");
await api("/invitations/accept", {
  method: "POST",
  cookie: memberCookie,
  body: { token },
});

// Direct viewer + team editor: the member sees both rows and the resulting role is
// editor. An editor may share (spec/IAM-v1.md §3) but may not change a team role.
await api(`/boards/${rolesBoard.id}/grants`, {
  method: "POST",
  cookie: ownerCookie,
  body: { subjectType: "user", subjectId: memberId, role: "viewer" },
});
await api(`/boards/${rolesBoard.id}/grants`, {
  method: "POST",
  cookie: ownerCookie,
  body: { subjectType: "team", subjectId: teamId, role: "editor" },
});

const memberAccess = (await api(`/boards/${rolesBoard.id}/access`, { cookie: memberCookie })).data;

console.log(`
Stage 2 acceptance setup is ready.

Owner:
  email:    ${ownerEmail}
  password: ${password}
  board with two grants: ${rolesBoard.id}
  board for link/trash:  ${linkBoard.id}
  team id (for the server 403 check): ${teamId}

Member (resulting role: ${memberAccess.access.role}; sources: ${memberAccess.access.sources.join(", ")}):
  email:    ${memberEmail}
  password: ${password}
  board with two grants: ${rolesBoard.id}

Open in the app (sync + web must be running):
  http://localhost:5173/?room=${rolesBoard.id}
  http://localhost:5173/?room=${linkBoard.id}

Expected on the roles board: the member sees two rows (direct viewer, team editor),
one resulting editor role, a role selector only on the direct row, and no remove action
on the team row.

Copy check: use "Copy" on the roles board (it has two participant grants). The link
board has no participants, so its copy correctly starts with none.
`);
