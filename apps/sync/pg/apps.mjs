/**
 * Installed first-party apps (ADR-098). The manifest column is a copy of the registry at
 * install time, so a later registry change reaches a tenant only through an explicit
 * install/upgrade — not by surprise.
 */
export const appMethods = {
  async listOrgApps(orgId) {
    const { rows } = await this.pool.query(
      `select app_id, version, manifest, state, installed_by, installed_at, updated_at
         from org_apps where org_id = $1 order by app_id`,
      [orgId],
    );
    return rows;
  },

  async getOrgApp(orgId, appId) {
    const { rows } = await this.pool.query(
      `select app_id, version, manifest, state, installed_by, installed_at, updated_at
         from org_apps where org_id = $1 and app_id = $2`,
      [orgId, appId],
    );
    return rows[0] ?? null;
  },

  async installOrgApp({ orgId, appId, version, manifest, installedBy = null }) {
    const { rows } = await this.pool.query(
      `insert into org_apps (org_id, app_id, version, manifest, state, installed_by)
       values ($1, $2, $3, $4::jsonb, 'enabled', $5)
       on conflict (org_id, app_id) do update set
         version = excluded.version,
         manifest = excluded.manifest,
         state = 'enabled',
         updated_at = now()
       returning app_id, version, manifest, state, installed_by, installed_at, updated_at`,
      [orgId, appId, version, JSON.stringify(manifest), installedBy],
    );
    return rows[0];
  },

  async setOrgAppState({ orgId, appId, enabled }) {
    const { rows } = await this.pool.query(
      `update org_apps
          set state = $3, updated_at = now()
        where org_id = $1 and app_id = $2
        returning app_id, version, manifest, state, installed_by, installed_at, updated_at`,
      [orgId, appId, enabled ? "enabled" : "disabled"],
    );
    return rows[0] ?? null;
  },

  async removeOrgApp({ orgId, appId }) {
    const { rowCount } = await this.pool.query(
      "delete from org_apps where org_id = $1 and app_id = $2",
      [orgId, appId],
    );
    return rowCount > 0;
  },
};
