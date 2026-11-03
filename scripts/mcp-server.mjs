#!/usr/bin/env node
/**
 * A small MCP façade over the agent API.
 *
 * It deliberately exposes only what an external agent needs to prepare deterministic
 * work: the boards its owner can open, the published skills, and change sets. It does
 * not expose board text, SQL, files or arbitrary HTTP; content still travels only inside
 * a task the server executes (spec/AI-agents-architecture.md §7).
 *
 *   REMO_API_URL=https://boards.example.com/api \
 *   REMO_AGENT_TOKEN=remo_agent_… \
 *   node scripts/mcp-server.mjs
 *
 * Transport: newline-delimited JSON-RPC over stdio, as MCP clients launch it.
 */
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const API = String(process.env.REMO_API_URL ?? "http://localhost:1234").replace(/\/$/, "");
const TOKEN = process.env.REMO_AGENT_TOKEN ?? "";

async function api(path, init = {}) {
  if (!TOKEN) throw new Error("REMO_AGENT_TOKEN is not set");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `HTTP ${response.status}`);
  }
  return body;
}

const tools = [
  {
    name: "list_boards",
    description: "Boards this agent's owner can open in the agent's organisation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_skills",
    description: "Published skills in the organisation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_cards_change_set",
    description:
      "Queue a job that turns selected objects into cards. Returns a change set and its task; poll get_change_set for progress. Preview returns an estimate without writing.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        selectionIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 500,
        },
        targetKind: { type: "string", enum: ["standalone", "kanban"] },
        mode: { type: "string", enum: ["copy", "move"] },
        intent: { type: "string" },
        maxActions: { type: "integer", minimum: 1, maximum: 500 },
        preview: { type: "boolean" },
      },
      required: ["boardId", "selectionIds"],
      additionalProperties: false,
    },
  },
  {
    name: "create_connector_change_set",
    description:
      "Queue a job that joins two objects with a connector. routing is straight, elbow or curved. Preview returns an estimate without writing.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        routing: { type: "string", enum: ["straight", "elbow", "curved"] },
        intent: { type: "string" },
        maxActions: { type: "integer", minimum: 1, maximum: 500 },
        preview: { type: "boolean" },
      },
      required: ["boardId", "from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "set_connector_change_set",
    description:
      "Queue a job that changes a connector's routing or replaces its rigid waypoints. Preview returns an estimate without writing.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        connectorId: { type: "string" },
        routing: { type: "string", enum: ["straight", "elbow", "curved"] },
        waypoints: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              rigid: { type: "boolean" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
        intent: { type: "string" },
        maxActions: { type: "integer", minimum: 1, maximum: 500 },
        preview: { type: "boolean" },
      },
      required: ["boardId", "connectorId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_change_set",
    description: "Status, progress and result of a change set.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_change_set",
    description: "Execute a change set created with preview=true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_change_set",
    description: "Cancel a queued or running change set.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "resume_change_set",
    description: "Resume a failed or cancelled change set from its processed sources.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/** Tool handlers are exported for tests and keep the transport below tiny. */
export async function callTool(name, args = {}) {
  if (name === "list_boards") return api("/agent/boards");
  if (name === "list_skills") return api("/agent/skills");
  if (name === "create_cards_change_set") {
    const body = {
      boardId: String(args.boardId ?? ""),
      intent: String(args.intent ?? "Cards from a selection"),
      preview: args.preview === true,
      budget: {
        maxActions: Number(args.maxActions ?? 500),
      },
      operations: [
        {
          op: "create_cards",
          selectionIds: Array.isArray(args.selectionIds) ? args.selectionIds : [],
          target: { kind: args.targetKind === "kanban" ? "kanban" : "standalone" },
          mode: args.mode === "move" ? "move" : "copy",
        },
      ],
    };
    return api("/agent/change-sets", { method: "POST", body: JSON.stringify(body) });
  }
  if (name === "create_connector_change_set") {
    return api("/agent/change-sets", {
      method: "POST",
      body: JSON.stringify({
        boardId: String(args.boardId ?? ""),
        intent: String(args.intent ?? "Connector between two objects"),
        preview: args.preview === true,
        budget: { maxActions: Number(args.maxActions ?? 500) },
        operations: [
          {
            op: "create_connector",
            from: String(args.from ?? ""),
            to: String(args.to ?? ""),
            ...(args.routing ? { routing: args.routing } : {}),
          },
        ],
      }),
    });
  }
  if (name === "set_connector_change_set") {
    const operation = Array.isArray(args.waypoints)
      ? {
          op: "set_connector_waypoints",
          connectorId: String(args.connectorId ?? ""),
          ...(args.routing ? { routing: args.routing } : {}),
          waypoints: args.waypoints,
        }
      : {
          op: "set_connector_routing",
          connectorId: String(args.connectorId ?? ""),
          routing: String(args.routing ?? "elbow"),
        };
    return api("/agent/change-sets", {
      method: "POST",
      body: JSON.stringify({
        boardId: String(args.boardId ?? ""),
        intent: String(args.intent ?? "Change a connector"),
        preview: args.preview === true,
        budget: { maxActions: Number(args.maxActions ?? 500) },
        operations: [operation],
      }),
    });
  }
  if (name === "get_change_set") {
    return api(`/agent/change-sets/${encodeURIComponent(String(args.id ?? ""))}`);
  }
  if (name === "execute_change_set") {
    return api(`/agent/change-sets/${encodeURIComponent(String(args.id ?? ""))}/execute`, {
      method: "POST",
    });
  }
  if (name === "cancel_change_set") {
    return api(`/agent/change-sets/${encodeURIComponent(String(args.id ?? ""))}/cancel`, {
      method: "POST",
    });
  }
  if (name === "resume_change_set") {
    return api(`/agent/change-sets/${encodeURIComponent(String(args.id ?? ""))}/resume`, {
      method: "POST",
    });
  }
  throw new Error(`unknown tool: ${name}`);
}

export async function handleRequest(message, { callToolImpl = callTool } = {}) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "invalid request" } };
  }
  const { id = null, method, params } = message;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "remo", version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const result = await callToolImpl(name, args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        },
      };
    }
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
      );
      return;
    }
    const response = await handleRequest(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
