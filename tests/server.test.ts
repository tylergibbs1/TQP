import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { TQP } from "../src/server";
import { TQPClient } from "../src/client";
import type { TQPResponse } from "../src/types";

function createTestServer() {
  const server = new TQP({
    name: "test",
    description: "Test server",
  });

  server.type("User", {
    id: { type: "string" },
    login: { type: "string" },
    name: { type: "string" },
    avatar: { type: "string" },
  });

  server.type("Issue", {
    id: { type: "string" },
    number: { type: "int" },
    title: { type: "string" },
    body: { type: "string", cost: "high" },
    state: { type: "string", enum: ["open", "closed"] },
    labels: { type: "list:string" },
    author: { type: "User" },
  });

  server.type("Repo", {
    id: { type: "string" },
    name: { type: "string" },
    full_name: { type: "string" },
    stars: { type: "int" },
    owner: { type: "User" },
    issues: { type: "list:Issue", cost: "high" },
    readme: { type: "string", cost: "high" },
  });

  server.action("get_repo", {
    description: "Get a repository",
    input: {
      owner: { type: "string", required: true },
      name: { type: "string", required: true },
    },
    returns: "Repo",
    safe: true,
    handler: async ({ owner, name }) => ({
      id: "123",
      name: name as string,
      full_name: `${owner}/${name}`,
      stars: 50000,
      owner: {
        id: "1",
        login: owner as string,
        name: "Test Owner",
        avatar: "https://example.com/avatar.png",
      },
      issues: [
        {
          id: "i1",
          number: 1,
          title: "Bug report",
          body: "Long description of the bug...",
          state: "open",
          labels: ["bug"],
          author: { id: "2", login: "reporter", name: "Reporter", avatar: "" },
        },
      ],
      readme: "# Test Repo\n\nThis is a readme with lots of content...",
    }),
  });

  server.action("create_issue", {
    description: "Create an issue",
    input: {
      repo_id: { type: "string", required: true },
      title: { type: "string", required: true },
      body: { type: "string" },
      labels: { type: "list:string" },
    },
    returns: "Issue",
    safe: false,
    dry_run: true,
    handler: async ({ repo_id, title, body, labels }, ctx) => ({
      id: "new_1",
      number: 42,
      title: title as string,
      body: (body as string) ?? "",
      state: "open",
      labels: (labels as string[]) ?? [],
      author: { id: "1", login: "agent", name: "Agent", avatar: "" },
    }),
  });

  server.action("delete_repo", {
    description: "Delete a repository",
    input: {
      repo_id: { type: "string", required: true },
    },
    returns: "bool",
    destructive: true,
    confirm: true,
    dry_run: true,
    handler: async () => true,
  });

  server.action("list_issues", {
    description: "List issues",
    input: {
      repo_id: { type: "string", required: true },
      state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
      limit: { type: "int", default: 30 },
    },
    returns: "list:Issue",
    safe: true,
    handler: async () => [
      {
        id: "i1",
        number: 1,
        title: "First issue",
        body: "Body 1",
        state: "open",
        labels: ["bug"],
        author: { id: "1", login: "user1", name: "User 1", avatar: "" },
      },
      {
        id: "i2",
        number: 2,
        title: "Second issue",
        body: "Body 2",
        state: "closed",
        labels: ["feature"],
        author: { id: "2", login: "user2", name: "User 2", avatar: "" },
      },
    ],
  });

  return server;
}

// --- Unit tests (using handle() directly) ---

describe("TQP Server", () => {
  const server = createTestServer();

  describe("built-in actions", () => {
    test("tqp.manifest returns the manifest", async () => {
      const res = await server.handle({ action: "tqp.manifest" });
      expect(res.error).toBeUndefined();
      const manifest = res.data as any;
      expect(manifest.name).toBe("test");
      expect(manifest.types.Repo).toBeDefined();
      expect(manifest.actions.get_repo).toBeDefined();
    });

    test("tqp.describe returns a single type", async () => {
      const res = await server.handle({ action: "tqp.describe", input: { type: "Repo" } });
      expect(res.error).toBeUndefined();
      const data = res.data as any;
      expect(data.name).toBe("Repo");
      expect(data.fields.name.type).toBe("string");
    });

    test("tqp.describe returns error for unknown type", async () => {
      const res = await server.handle({ action: "tqp.describe", input: { type: "Nonexistent" } });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });

    test("tqp.health returns ok", async () => {
      const res = await server.handle({ action: "tqp.health" });
      const data = res.data as any;
      expect(data.status).toBe("ok");
      expect(data.version).toBe("0.1.0");
    });
  });

  describe("field selection", () => {
    test("returns all fields when no fields selector", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
      });
      const data = res.data as any;
      expect(data.id).toBe("123");
      expect(data.name).toBe("react");
      expect(data.full_name).toBe("facebook/react");
      expect(data.stars).toBe(50000);
      expect(data.owner).toBeDefined();
      expect(data.readme).toBeDefined();
    });

    test("returns only selected scalar fields", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: { name: true, stars: true },
      });
      const data = res.data as any;
      expect(data.name).toBe("react");
      expect(data.stars).toBe(50000);
      expect(data.id).toBeUndefined();
      expect(data.full_name).toBeUndefined();
      expect(data.owner).toBeUndefined();
      expect(data.readme).toBeUndefined();
    });

    test("returns nested selected fields", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: {
          name: true,
          owner: { login: true },
        },
      });
      const data = res.data as any;
      expect(data.name).toBe("react");
      expect(data.owner.login).toBe("facebook");
      expect(data.owner.id).toBeUndefined();
      expect(data.owner.name).toBeUndefined();
    });

    test("filters nested list items", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: {
          issues: {
            title: true,
            author: { login: true },
          },
        },
      });
      const data = res.data as any;
      expect(data.issues).toHaveLength(1);
      expect(data.issues[0].title).toBe("Bug report");
      expect(data.issues[0].author.login).toBe("reporter");
      expect(data.issues[0].body).toBeUndefined();
      expect(data.issues[0].number).toBeUndefined();
    });

    test("filters list-returning actions", async () => {
      const res = await server.handle({
        action: "list_issues",
        input: { repo_id: "123" },
        fields: { title: true, state: true },
      });
      const data = res.data as any;
      expect(data).toHaveLength(2);
      expect(data[0].title).toBe("First issue");
      expect(data[0].state).toBe("open");
      expect(data[0].body).toBeUndefined();
      expect(data[0].id).toBeUndefined();
    });
  });

  describe("input validation", () => {
    test("rejects missing required fields", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
      expect(res.error!.message).toContain("name");
    });

    test("rejects wrong type", async () => {
      const res = await server.handle({
        action: "list_issues",
        input: { repo_id: "123", limit: "not a number" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
      expect(res.error!.message).toContain("integer");
    });

    test("rejects invalid enum value", async () => {
      const res = await server.handle({
        action: "list_issues",
        input: { repo_id: "123", state: "invalid" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });

    test("rejects unknown input fields", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react", extra: "field" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
      expect(res.error!.message).toContain("extra");
    });

    test("applies defaults", async () => {
      const res = await server.handle({
        action: "list_issues",
        input: { repo_id: "123" },
      });
      expect(res.error).toBeUndefined();
      expect(res.data).toBeDefined();
    });
  });

  describe("hardening", () => {
    test("rejects path traversal in inputs", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "../etc", name: "passwd" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
      expect(res.error!.message).toContain("path traversal");
    });

    test("rejects control characters", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "test\x00evil", name: "repo" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });

    test("rejects query params in resource IDs", async () => {
      const res = await server.handle({
        action: "list_issues",
        input: { repo_id: "123?admin=true" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });
  });

  describe("safety metadata", () => {
    test("unknown action returns error", async () => {
      const res = await server.handle({ action: "nonexistent" });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_ACTION");
    });

    test("confirm-required action rejects without confirmation", async () => {
      const res = await server.handle({
        action: "delete_repo",
        input: { repo_id: "123" },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("REQUIRES_CONFIRMATION");
    });

    test("confirm-required action succeeds with confirmation", async () => {
      const res = await server.handle({
        action: "delete_repo",
        input: { repo_id: "123" },
        confirmed: true,
      });
      expect(res.error).toBeUndefined();
      expect(res.data).toBe(true);
    });

    test("dry_run on unsupported action returns error", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        dry_run: true,
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("DRY_RUN_NOT_SUPPORTED");
    });

    test("dry_run on supported action succeeds", async () => {
      const res = await server.handle({
        action: "create_issue",
        input: { repo_id: "123", title: "Test" },
        dry_run: true,
      });
      expect(res.error).toBeUndefined();
      expect(res.meta?.dry_run).toBe(true);
    });
  });

  describe("field validation", () => {
    test("rejects invalid field name", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: { nonexistent: true },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_FIELD");
      expect(res.error!.field).toBe("nonexistent");
      expect(res.error!.type).toBe("Repo");
    });

    test("rejects invalid nested field name", async () => {
      const res = await server.handle({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: { owner: { nonexistent: true } },
      });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_FIELD");
      expect(res.error!.type).toBe("User");
    });
  });

  describe("request envelope validation", () => {
    test("rejects non-object request", async () => {
      const res = await server.handle("not an object");
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });

    test("rejects missing action", async () => {
      const res = await server.handle({ input: {} });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe("INVALID_INPUT");
    });

    test("preserves request id in response", async () => {
      const res = await server.handle({
        action: "tqp.health",
        id: "test_123",
      });
      expect(res.id).toBe("test_123");
    });
  });
});

// --- HTTP integration tests ---

describe("TQP HTTP Transport", () => {
  const server = createTestServer();
  const port = 39182; // Random high port for testing
  const baseUrl = `http://localhost:${port}`;

  beforeAll(() => {
    server.listen({ transport: "http", port, hostname: "127.0.0.1" });
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /tqp/manifest returns manifest", async () => {
    const res = await fetch(`${baseUrl}/tqp/manifest`);
    expect(res.status).toBe(200);
    const body = await res.json() as TQPResponse;
    expect((body.data as any).name).toBe("test");
  });

  test("GET /tqp/health returns health", async () => {
    const res = await fetch(`${baseUrl}/tqp/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as TQPResponse;
    expect((body.data as any).status).toBe("ok");
  });

  test("POST /tqp executes action with field selection", async () => {
    const res = await fetch(`${baseUrl}/tqp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_repo",
        input: { owner: "facebook", name: "react" },
        fields: { name: true, stars: true },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as TQPResponse;
    expect((body.data as any).name).toBe("react");
    expect((body.data as any).stars).toBe(50000);
    expect((body.data as any).id).toBeUndefined();
  });

  test("POST /tqp returns 400 for validation errors", async () => {
    const res = await fetch(`${baseUrl}/tqp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_repo",
        input: { owner: "facebook" },
      }),
    });
    expect(res.status).toBe(400);
  });

  test("TQPClient works with HTTP server", async () => {
    const client = new TQPClient(baseUrl);

    const manifest = await client.getManifest();
    expect(manifest.name).toBe("test");

    const health = await client.health();
    expect(health.status).toBe("ok");

    const repo = await client.call("get_repo", {
      input: { owner: "facebook", name: "react" },
      fields: { name: true, owner: { login: true } },
    });
    expect((repo.data as any).name).toBe("react");
    expect((repo.data as any).owner.login).toBe("facebook");
    expect((repo.data as any).id).toBeUndefined();
  });
});
