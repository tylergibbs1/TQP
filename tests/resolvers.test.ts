import { describe, test, expect } from "bun:test";
import { TQP } from "../src/server";

describe("Lazy Resolvers", () => {
  function createServer() {
    const server = new TQP({ name: "test", description: "Resolver test" });

    server.type("User", {
      id: { type: "string" },
      login: { type: "string" },
    });

    server.type("Repo", {
      id: { type: "string" },
      name: { type: "string" },
      readme: { type: "string", cost: "high" },
      contributors: { type: "list:User", cost: "high" },
    });

    let readmeResolved = false;
    let contributorsResolved = false;

    server.action("get_repo", {
      description: "Get repo",
      input: {
        owner: { type: "string", required: true },
        name: { type: "string", required: true },
      },
      returns: "Repo",
      safe: true,
      handler: async ({ owner, name }) => ({
        id: "1",
        name: name as string,
        readme: "",
        contributors: [],
      }),
      resolve: {
        readme: async () => {
          readmeResolved = true;
          return "# Resolved README\n\nThis was lazily loaded.";
        },
        contributors: async () => {
          contributorsResolved = true;
          return [
            { id: "1", login: "alice" },
            { id: "2", login: "bob" },
          ];
        },
      },
    });

    return { server, wasReadmeResolved: () => readmeResolved, wasContributorsResolved: () => contributorsResolved };
  }

  test("resolvers only run when fields are requested", async () => {
    const { server, wasReadmeResolved, wasContributorsResolved } = createServer();

    // Request without high-cost fields
    await server.handle({
      action: "get_repo",
      input: { owner: "test", name: "repo" },
      fields: { name: true },
    });

    expect(wasReadmeResolved()).toBe(false);
    expect(wasContributorsResolved()).toBe(false);
  });

  test("resolver runs when its field is requested", async () => {
    const { server, wasReadmeResolved, wasContributorsResolved } = createServer();

    const res = await server.handle({
      action: "get_repo",
      input: { owner: "test", name: "repo" },
      fields: { name: true, readme: true },
    });

    expect(wasReadmeResolved()).toBe(true);
    expect(wasContributorsResolved()).toBe(false);
    const data = res.data as any;
    expect(data.name).toBe("repo");
    expect(data.readme).toContain("Resolved README");
    expect(data.contributors).toBeUndefined();
  });

  test("nested field selection on resolved list", async () => {
    const { server } = createServer();

    const res = await server.handle({
      action: "get_repo",
      input: { owner: "test", name: "repo" },
      fields: {
        contributors: { login: true },
      },
    });

    const data = res.data as any;
    expect(data.contributors).toHaveLength(2);
    expect(data.contributors[0].login).toBe("alice");
    expect(data.contributors[0].id).toBeUndefined();
  });

  test("all fields returned when no fields selector (resolvers still run)", async () => {
    const { server, wasReadmeResolved } = createServer();

    const res = await server.handle({
      action: "get_repo",
      input: { owner: "test", name: "repo" },
      // no fields selector — returns everything, resolvers don't run
    });

    // Without fields selector, resolvers don't run (handler returns default values)
    expect(wasReadmeResolved()).toBe(false);
    const data = res.data as any;
    expect(data.name).toBe("repo");
    expect(data.readme).toBe(""); // handler default, not resolved
  });
});
