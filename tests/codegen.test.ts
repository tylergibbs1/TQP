import { describe, test, expect } from "bun:test";
import { generateTypes } from "../src/codegen";
import type { Manifest } from "../src/types";

describe("Codegen", () => {
  const manifest: Manifest = {
    tqp: "0.1.0",
    name: "test",
    description: "Test server",
    types: {
      User: {
        description: "A user",
        fields: {
          id: { type: "string" },
          login: { type: "string" },
          name: { type: "string" },
          active: { type: "bool" },
        },
      },
      Repo: {
        fields: {
          id: { type: "string" },
          name: { type: "string" },
          stars: { type: "int" },
          score: { type: "float" },
          owner: { type: "User" },
          tags: { type: "list:string" },
          readme: { type: "string?", cost: "high", description: "README content" },
        },
      },
    },
    actions: {
      get_repo: {
        description: "Get a repo",
        input: {
          owner: { type: "string", required: true },
          name: { type: "string", required: true },
        },
        returns: "Repo",
        safe: true,
      },
      list_repos: {
        description: "List repos",
        input: {
          limit: { type: "int", default: 10 },
        },
        returns: "list:Repo",
        safe: true,
      },
    },
  };

  test("generates interface for each type", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("export interface User {");
    expect(output).toContain("export interface Repo {");
  });

  test("maps primitive types correctly", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("id: string;");
    expect(output).toContain("stars: number;");
    expect(output).toContain("score: number;");
    expect(output).toContain("active: boolean;");
  });

  test("maps reference types", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("owner: User;");
  });

  test("maps list types", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("tags: string[];");
  });

  test("marks optional fields", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("readme?: string;");
  });

  test("generates action input types", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("export interface GetRepoInput {");
    expect(output).toContain("owner: string;");
  });

  test("generates action result types", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("export type GetRepoResult = Repo;");
    expect(output).toContain("export type ListReposResult = Repo[];");
  });

  test("generates action name union", () => {
    const output = generateTypes(manifest);
    expect(output).toContain('export type ActionName = "get_repo" | "list_repos";');
  });

  test("includes type description", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("/** A user */");
  });

  test("includes field cost annotation", () => {
    const output = generateTypes(manifest);
    expect(output).toContain("@cost high");
  });
});
