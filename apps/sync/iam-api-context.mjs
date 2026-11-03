/**
 * The authenticated half of the IAM surface, built once per request.
 *
 * A route needs to know who is asking and what they may do; these small functions answer
 * that the same way everywhere, so a permission check cannot drift between routes.
 */
import { fail } from "./iam-http.mjs";

export function iamContext({ request, response, store, log, session, user, audit, onAclChanged, onUserSuspended }) {
  /* ------------------------------------------------------- authenticated -- */

  const requireUser = () => {
    if (!session) {
      fail(response, 401, "AUTH_REQUIRED", "sign in first");
      return null;
    }
    return user;
  };

  const membershipOf = async (orgId, userId) => store.getOrgMembership(orgId, userId);
  /** A seat with member rights: guests are not members for discovery purposes. */
  const isActiveMember = async (orgId, userId) => {
    const membership = await store.getOrgMembership(orgId, userId);
    return Boolean(membership && membership.state === "active" && membership.relation === "member");
  };
  const isOrgAdmin = (orgId, userId) => store.hasOrgRole(orgId, userId, "org_admin");
  /** Any of these organisation roles. */
  const hasOrgRole = async (orgId, userId, roles) => {
    for (const role of roles) {
      if (await store.hasOrgRole(orgId, userId, role)) return true;
    }
    return false;
  };
  const inviteUrl = (token) =>
    `${process.env.REMO_APP_ORIGIN ?? "http://localhost:5173"}/?invite=${encodeURIComponent(token)}`;

  return {
    user,
    audit,
    requireUser,
    membershipOf,
    isActiveMember,
    isOrgAdmin,
    hasOrgRole,
    inviteUrl,
    onAclChanged,
    onUserSuspended,
  };
}
