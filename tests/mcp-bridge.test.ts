import { describe, test, expect } from "bun:test";
import { TQP } from "../src/server";
import { MCPBridge } from "../src/mcp-bridge";

function createTestSetup() {
  const server = new TQP({ name: "test", description: "Test" });

  server.type("User", {
    id: { type: "string" },
    login: { type: "string" },
    name: { type: "string" },
  });

  server.type("Item", {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string", cost: "high" },
    author: { type: "User" },
  });

  server.action("get_item", {
    description: "Get an item",
    input: { id: { type: "string", required: true } },
    returns: "Item",
    safe: true,
    handler: async ({ id }) => ({
      id: id as string,
      title: "Test Item",
      body: "Long body content...",
      author: { id: "1", login: "alice", name: "Alice" },
    }),
  });

  server.action("delete_item", {
    description: "Delete an item",
    input: { id: { type: "string", required: true } },
    returns: "bool",
    destructive: true,
    confirm: true,
    handler: async () => true,
  });

  return new MCPBridge(server);
}

describe("MCP Bridge", () => {
  const bridge = createTestSetup();

  test("initialize returns server info", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    expect((res.result as any).serverInfo.name).toBe("test");
    expect((res.result as any).capabilities.tools).toBeDefined();
  });

  test("tools/list returns TQP actions as MCP tools", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const tools = (res.result as any).tools;
    expect(tools).toHaveLength(2);

    const getItem = tools.find((t: any) => t.name === "get_item");
    expect(getItem).toBeDefined();
    expect(getItem.inputSchema.properties.id).toBeDefined();
    expect(getItem.inputSchema.properties._fields).toBeDefined();
    expect(getItem.inputSchema.required).toContain("id");
  });

  test("destructive actions show in description", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });
    const tools = (res.result as any).tools;
    const deleteItem = tools.find((t: any) => t.name === "delete_item");
    expect(deleteItem.description).toContain("DESTRUCTIVE");
    expect(deleteItem.description).toContain("REQUIRES CONFIRMATION");
  });

  test("tools/call executes action and returns result", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_item",
        arguments: { id: "123" },
      },
    });
    const content = (res.result as any).content[0];
    expect(content.type).toBe("text");
    const data = JSON.parse(content.text);
    expect(data.id).toBe("123");
    expect(data.title).toBe("Test Item");
    expect(data.body).toBe("Long body content...");
    expect(data.author.login).toBe("alice");
  });

  test("tools/call with _fields applies field selection", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_item",
        arguments: {
          id: "123",
          _fields: { title: true, author: { login: true } },
        },
      },
    });
    const content = (res.result as any).content[0];
    const data = JSON.parse(content.text);
    expect(data.title).toBe("Test Item");
    expect(data.author.login).toBe("alice");
    expect(data.body).toBeUndefined();
    expect(data.id).toBeUndefined();
    expect(data.author.name).toBeUndefined();
  });

  test("tools/call with invalid action returns error", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "nonexistent",
        arguments: {},
      },
    });
    const content = (res.result as any).content[0];
    expect((res.result as any).isError).toBe(true);
    expect(content.text).toContain("INVALID_ACTION");
  });

  test("unknown method returns error", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "unknown/method",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  test("ping returns empty result", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "ping",
    });
    expect(res.result).toBeDefined();
  });

  test("confirm-required actions auto-confirm via bridge", async () => {
    const res = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "delete_item",
        arguments: { id: "123" },
      },
    });
    const content = (res.result as any).content[0];
    expect((res.result as any).isError).toBeUndefined();
    expect(JSON.parse(content.text)).toBe(true);
  });
});
