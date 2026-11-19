import { describe, expect, it } from "vitest";
import { handleRequest } from "../../scripts/mcp-server.mjs";

describe("MCP façade", () => {
  it("initializes and lists tools", async () => {
    const init = await handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });
    expect(init.result.serverInfo.name).toBe("remo");
    expect(init.result.capabilities.tools).toBeTruthy();

    const list = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = list.result.tools.map((tool) => tool.name);
    expect(names).toContain("list_boards");
    expect(names).toContain("create_cards_change_set");
    expect(names).toContain("create_connector_change_set");
    expect(names).toContain("set_connector_change_set");
    expect(names).toContain("cancel_change_set");
  });

  it("wraps tool results and errors in MCP content", async () => {
    const ok = await handleRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_boards", arguments: {} } },
      { callToolImpl: async () => ({ boards: [] }) },
    );
    expect(ok.result.isError).toBe(false);
    expect(ok.result.content[0].text).toContain('"boards"');

    const failed = await handleRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "x", arguments: {} } },
      {
        callToolImpl: async () => {
          throw new Error("no token");
        },
      },
    );
    expect(failed.result.isError).toBe(true);
    expect(failed.result.content[0].text).toContain("no token");
  });

  it("rejects an unknown method", async () => {
    const response = await handleRequest({ jsonrpc: "2.0", id: 5, method: "nope" });
    expect(response.error.code).toBe(-32601);
  });
});
