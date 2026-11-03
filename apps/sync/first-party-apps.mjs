/**
 * The first-party app registry (ADR-098).
 *
 * This file is the allowlist: an organisation installs an app by id, and the server writes
 * *this* manifest into `org_apps`. A client can never send a schema, a label or an action.
 *
 * Two rules make the panel safe to render:
 *  - the node vocabulary is closed (`panel`, `text`, `button`, `field`);
 *  - every visible string is an i18n key, never a literal, so the host owns wording,
 *    language and escaping. `apps.test.mjs` enforces both over every manifest here.
 */

/** Node types the host knows how to draw. Anything else is a manifest bug. */
export const PANEL_NODES = new Set(["panel", "text", "button", "field"]);

/** The one action `app.hello` offers: greet the person who pressed the button. */
const hello = {
  id: "app.hello",
  version: 1,
  nameKey: "apps.hello.name",
  descriptionKey: "apps.hello.description",
  capabilities: ["board.read"],
  panel: {
    type: "panel",
    titleKey: "apps.hello.name",
    children: [
      {
        type: "text",
        id: "greeting",
        key: "apps.hello.greeting",
        params: ["username"],
      },
      {
        type: "button",
        id: "say",
        labelKey: "apps.hello.say",
        action: "app.hello",
      },
    ],
  },
  actions: {
    "app.hello": {
      capabilities: ["board.read"],
      run({ user }) {
        return {
          message: {
            key: "apps.hello.greeting",
            params: { username: user?.name ?? "" },
          },
        };
      },
    },
  },
};

export const FIRST_PARTY_APPS = { "app.hello": hello };

export function getFirstPartyApp(appId) {
  return FIRST_PARTY_APPS[appId] ?? null;
}

export function firstPartyAppList() {
  return Object.values(FIRST_PARTY_APPS).map((app) => ({
    id: app.id,
    version: app.version,
    nameKey: app.nameKey,
    descriptionKey: app.descriptionKey,
  }));
}

/**
 * Structural check for a manifest. Used by the registry's own test: a manifest that names
 * an unknown node or carries a literal label must fail in CI, not in a browser.
 */
export function validateManifest(app) {
  const problems = [];
  const checkNode = (node) => {
    if (!PANEL_NODES.has(node?.type)) problems.push(`${app.id}: unknown node ${node?.type}`);
    for (const field of ["key", "titleKey", "labelKey"]) {
      if (field in node && typeof node[field] !== "string") {
        problems.push(`${app.id}: ${node.type}.${field} must be an i18n key`);
      }
    }
    if (node?.type === "text" && !node.key) problems.push(`${app.id}: text without a key`);
    if (node?.type === "button") {
      if (!node.labelKey) problems.push(`${app.id}: button without a labelKey`);
      if (!node.action) problems.push(`${app.id}: button without an action`);
    }
    for (const child of node?.children ?? []) checkNode(child);
  };
  if (!app.nameKey || !app.descriptionKey) problems.push(`${app.id}: missing name/description key`);
  checkNode(app.panel);
  for (const [id, action] of Object.entries(app.actions ?? {})) {
    if (typeof action.run !== "function") problems.push(`${app.id}: action ${id} cannot run`);
  }
  const declared = new Set(Object.keys(app.actions ?? {}));
  const checkActions = (node) => {
    if (node?.type === "button" && !declared.has(node.action)) {
      problems.push(`${app.id}: button points at undeclared action ${node.action}`);
    }
    for (const child of node?.children ?? []) checkActions(child);
  };
  checkActions(app.panel);
  return problems;
}
