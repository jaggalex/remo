/**
 * Billing reads and utilisation counters (ADR-247, `spec/billing.md` §2.2–2.3).
 *
 * Every method here expects an established tenant: `orgs`, `org_memberships`,
 * `boards` and every `subscriptions` row are protected by RLS (ADR-178), and without the
 * setting a read silently returns no rows — which would look like "no subscription" and
 * quietly downgrade a paying organisation to Free. Call them inside
 * `store.withTenant(orgId, …)`; `entitlementsFor` and the org-scoped billing routes do.
 */

export const billingMethods = {
  /** The kind decides Free-ness: a personal organisation cannot buy a plan (§2.2). */
  async billingOrg(orgId) {
    const { rows } = await this.pool.query("select id, kind from orgs where id = $1", [orgId]);
    return rows[0] ?? null;
  },

  /**
   * The one live subscription, or null. `subscriptions_live_idx` makes at most one row
   * match; the order is belt and braces for a database whose index is not in place yet.
   */
  async liveSubscription(orgId) {
    const { rows } = await this.pool.query(
      `select *
         from subscriptions
        where org_id = $1
          and status in ('trialing', 'active', 'past_due', 'suspended')
        order by created_at desc
        limit 1`,
      [orgId],
    );
    return rows[0] ?? null;
  },

  /**
   * Seats in use (§2.3): an active member, or a guest who holds editor or a higher role
   * in at least one room of the organisation. Viewers, commenters and public-link
   * visitors are free.
   *
   * A guest can only reach a role through a user grant — an org grant explicitly excludes
   * guests and a guest has no team seat (`effective()` in `iam.mjs`) — so one join is the
   * whole rule. Expired grants are excluded the same way the access path excludes them.
   */
  async seatUsage(orgId) {
    const { rows } = await this.pool.query(
      `select count(*)::int as seats
         from (
           select m.user_id
             from org_memberships m
            where m.org_id = $1
              and m.relation = 'member'
              and m.state = 'active'
           union
           select m.user_id
             from org_memberships m
             join board_grants g
               on g.subject_type = 'user' and g.subject_id = m.user_id
             join boards b on b.id = g.board_id
            where m.org_id = $1
              and m.relation = 'guest'
              and b.org_id = $1
              and g.role in ('editor', 'coowner')
              and (g.expires_at is null or g.expires_at > now())
         ) occupied`,
      [orgId],
    );
    return rows[0]?.seats ?? 0;
  },

  /**
   * The `rooms` limit counts active rooms: the trash keeps a room out of it (§2.2).
   *
   * Not `roomCount(orgId)`: the store already exposes `roomCount` as the number of open
   * in-memory rooms, and `server.mjs` publishes it as a metric.
   */
  async activeRoomCount(orgId) {
    const { rows } = await this.pool.query(
      `select count(*)::int as rooms
         from boards
        where org_id = $1 and archived_at is null`,
      [orgId],
    );
    return rows[0]?.rooms ?? 0;
  },
};
