import { describe, test, expect } from "bun:test";
import { generateAgentPrompt } from "../src/prompt";
import type { Manifest } from "../src/types";

describe("Agent Prompt Generator", () => {
  const manifest: Manifest = {
    tqp: "0.1.0",
    name: "test-api",
    description: "A test API for agents",
    types: {
      User: {
        description: "A user account",
        fields: {
          id: { type: "string" },
          name: { type: "string" },
          bio: { type: "string", cost: "high", description: "User biography" },
        },
      },
    },
    actions: {
      get_user: {
        description: "Fetch a user by ID",
        input: { id: { type: "string", required: true } },
        returns: "User",
        safe: true,
      },
      delete_user: {
        description: "Permanently delete a user",
        input: { id: { type: "string", required: true } },
        returns: "bool",
        destructive: true,
        confirm: true,
        dry_run: true,
      },
    },
  };

  test("includes server name and description", () => {
    const prompt = generateAgentPrompt(manifest);
    expect(prompt).toContain("test-api");
    expect(prompt).toContain("A test API for agents");
  });

  test("includes data model with fields table", () => {
    const prompt = generateAgentPrompt(manifest);
    expect(prompt).toContain("### User");
    expect(prompt).toContain("A user account");
    expect(prompt).toContain("| name | string |");
    expect(prompt).toContain("| bio | string | high |");
  });

  test("includes actions with safety flags", () => {
    const prompt = generateAgentPrompt(manifest);
    expect(prompt).toContain("### get_user");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("### delete_user");
    expect(prompt).toContain("DESTRUCTIVE");
    expect(prompt).toContain("requires confirmation");
    expect(prompt).toContain("supports dry-run");
  });

  test("includes usage instructions", () => {
    const prompt = generateAgentPrompt(manifest);
    expect(prompt).toContain("## How to Query");
    expect(prompt).toContain('"fields"');
    expect(prompt).toContain("cost: high");
  });

  test("includes input details", () => {
    const prompt = generateAgentPrompt(manifest);
    expect(prompt).toContain("`id`: string (required)");
  });
});
