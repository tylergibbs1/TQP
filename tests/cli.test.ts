import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { TQP } from "../src/server";
import { existsSync, rmSync } from "fs";
import { join } from "path";

describe("CLI", () => {
  const testDir = join(import.meta.dir, ".test-cli-output");

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  test("tqp --help shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "--help"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("tqp — Typed Query Protocol CLI");
    expect(output).toContain("init");
    expect(output).toContain("serve");
    expect(output).toContain("call");
  });

  test("tqp init creates project scaffold", async () => {
    const name = "test-init-project";
    const projectDir = join(import.meta.dir, "..", name);

    // Clean up if exists from previous run
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });

    const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "init", name], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("Created TQP server");

    expect(existsSync(join(projectDir, "server.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "package.json"))).toBe(true);

    // Read generated server.ts
    const serverContent = await Bun.file(join(projectDir, "server.ts")).text();
    expect(serverContent).toContain('name: "test-init-project"');
    expect(serverContent).toContain("server.type");
    expect(serverContent).toContain("server.action");

    // Clean up
    rmSync(projectDir, { recursive: true });
  });

  describe("tqp validate", () => {
    const validManifest = join(import.meta.dir, ".test-valid-manifest.json");
    const invalidManifest = join(import.meta.dir, ".test-invalid-manifest.json");

    beforeAll(async () => {
      await Bun.write(
        validManifest,
        JSON.stringify({
          tqp: "0.1.0",
          name: "test",
          description: "test",
          types: {
            Item: { fields: { id: { type: "string" }, name: { type: "string" } } },
          },
          actions: {
            get_item: {
              description: "Get item",
              input: { id: { type: "string", required: true } },
              returns: "Item",
            },
          },
        })
      );
      await Bun.write(
        invalidManifest,
        JSON.stringify({
          tqp: "0.1.0",
          name: "test",
          types: {
            Item: { fields: { owner: { type: "NonexistentType" } } },
          },
          actions: {
            bad: {
              description: "Bad action",
              input: {},
              returns: "MissingType",
            },
          },
        })
      );
    });

    afterAll(() => {
      if (existsSync(validManifest)) rmSync(validManifest);
      if (existsSync(invalidManifest)) rmSync(invalidManifest);
    });

    test("validates a correct manifest", async () => {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "validate", validManifest], {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      expect(output).toContain("Manifest valid");
      expect(output).toContain("1 type");
      expect(output).toContain("1 action");
    });

    test("reports errors for invalid manifest", async () => {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "validate", invalidManifest], {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      expect(stderr).toContain("validation failed");
      expect(stderr).toContain("MissingType");
    });
  });

  describe("tqp codegen", () => {
    const manifestFile = join(import.meta.dir, ".test-codegen-manifest.json");
    const outputFile = join(import.meta.dir, ".test-codegen-output.ts");

    beforeAll(async () => {
      await Bun.write(
        manifestFile,
        JSON.stringify({
          tqp: "0.1.0",
          name: "test",
          description: "test",
          types: {
            User: { fields: { id: { type: "string" }, name: { type: "string" } } },
          },
          actions: {
            get_user: {
              description: "Get user",
              input: { id: { type: "string", required: true } },
              returns: "User",
            },
          },
        })
      );
    });

    afterAll(() => {
      if (existsSync(manifestFile)) rmSync(manifestFile);
      if (existsSync(outputFile)) rmSync(outputFile);
    });

    test("prints generated types to stdout", async () => {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "codegen", manifestFile], {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      expect(output).toContain("export interface User");
      expect(output).toContain("export interface GetUserInput");
      expect(output).toContain("export type GetUserResult = User;");
    });

    test("writes to output file with --output", async () => {
      const proc = Bun.spawn(
        ["bun", "run", "src/cli/index.ts", "codegen", manifestFile, "--output", outputFile],
        {
          cwd: join(import.meta.dir, ".."),
          stdout: "pipe",
        }
      );
      await proc.exited;
      expect(existsSync(outputFile)).toBe(true);
      const content = await Bun.file(outputFile).text();
      expect(content).toContain("export interface User");
    });
  });
});
