import { describe, test, expect } from "bun:test";
import { TQP } from "../src/server";

describe("Token Estimation", () => {
  const server = new TQP({ name: "test", description: "test" });
  server.type("Item", {
    id: { type: "string" },
    name: { type: "string" },
    data: { type: "string", cost: "high" },
  });
  server.action("get_item", {
    description: "Get item",
    input: { id: { type: "string", required: true } },
    returns: "Item",
    safe: true,
    handler: async ({ id }) => ({
      id: id as string,
      name: "Test",
      data: "x".repeat(1000),
    }),
  });

  test("response includes token estimate", async () => {
    const res = await server.handle({
      action: "get_item",
      input: { id: "1" },
      fields: { name: true },
    });
    expect(res.meta).toBeDefined();
    expect(res.meta!.cost_tokens_estimate).toBeGreaterThan(0);
  });

  test("fewer tokens with field selection", async () => {
    const full = await server.handle({
      action: "get_item",
      input: { id: "1" },
    });
    const filtered = await server.handle({
      action: "get_item",
      input: { id: "1" },
      fields: { name: true },
    });
    expect(filtered.meta!.cost_tokens_estimate!).toBeLessThan(full.meta!.cost_tokens_estimate!);
  });
});
