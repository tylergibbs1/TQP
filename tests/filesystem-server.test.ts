import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createFilesystemServer } from "../src/servers/filesystem";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("Filesystem Server", () => {
  const testDir = join(import.meta.dir, ".test-fs");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "hello.txt"), "Hello, world!\nLine 2\n");
    writeFileSync(join(testDir, "data.json"), '{"key": "value"}');
    mkdirSync(join(testDir, "subdir"), { recursive: true });
    writeFileSync(join(testDir, "subdir", "nested.txt"), "nested content");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true });
  });

  const server = createFilesystemServer(join(import.meta.dir, ".test-fs"));

  test("manifest has correct types and actions", async () => {
    const res = await server.handle({ action: "tqp.manifest" });
    const manifest = res.data as any;
    expect(manifest.types.FileInfo).toBeDefined();
    expect(manifest.types.FileContent).toBeDefined();
    expect(manifest.types.DirListing).toBeDefined();
    expect(manifest.actions.read_file).toBeDefined();
    expect(manifest.actions.list_dir).toBeDefined();
    expect(manifest.actions.stat_file).toBeDefined();
    expect(manifest.actions.write_file).toBeDefined();
    expect(manifest.actions.delete_file).toBeDefined();
  });

  test("read_file returns file content", async () => {
    const res = await server.handle({
      action: "read_file",
      input: { path: "hello.txt" },
    });
    const data = res.data as any;
    expect(data.name).toBe("hello.txt");
    expect(data.content).toContain("Hello, world!");
    expect(data.lines).toBe(3);
  });

  test("read_file with field selection", async () => {
    const res = await server.handle({
      action: "read_file",
      input: { path: "hello.txt" },
      fields: { name: true, lines: true },
    });
    const data = res.data as any;
    expect(data.name).toBe("hello.txt");
    expect(data.lines).toBe(3);
    expect(data.content).toBeUndefined();
  });

  test("list_dir returns entries", async () => {
    const res = await server.handle({
      action: "list_dir",
      input: { path: "." },
    });
    const data = res.data as any;
    expect(data.count).toBeGreaterThanOrEqual(3);
    const names = data.entries.map((e: any) => e.name);
    expect(names).toContain("hello.txt");
    expect(names).toContain("subdir");
  });

  test("list_dir with pattern filter", async () => {
    const res = await server.handle({
      action: "list_dir",
      input: { path: ".", pattern: "\\.json$" },
    });
    const data = res.data as any;
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe("data.json");
  });

  test("stat_file returns metadata", async () => {
    const res = await server.handle({
      action: "stat_file",
      input: { path: "hello.txt" },
    });
    const data = res.data as any;
    expect(data.name).toBe("hello.txt");
    expect(data.is_dir).toBe(false);
    expect(data.size).toBeGreaterThan(0);
  });

  test("stat_file on directory", async () => {
    const res = await server.handle({
      action: "stat_file",
      input: { path: "subdir" },
    });
    const data = res.data as any;
    expect(data.is_dir).toBe(true);
  });

  test("read_file rejects path traversal", async () => {
    const res = await server.handle({
      action: "read_file",
      input: { path: "../../../etc/passwd" },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("INVALID_INPUT");
  });

  test("write_file requires confirmation", async () => {
    const res = await server.handle({
      action: "write_file",
      input: { path: "new.txt", content: "new content" },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("REQUIRES_CONFIRMATION");
  });

  test("write_file dry_run does not create file", async () => {
    const res = await server.handle({
      action: "write_file",
      input: { path: "dryrun.txt", content: "should not exist" },
      dry_run: true,
      confirmed: true,
    });
    expect(res.error).toBeUndefined();
    expect(existsSync(join(testDir, "dryrun.txt"))).toBe(false);
  });

  test("delete_file is destructive and requires confirmation", async () => {
    const manifest = await server.handle({ action: "tqp.manifest" });
    const deleteAction = (manifest.data as any).actions.delete_file;
    expect(deleteAction.destructive).toBe(true);
    expect(deleteAction.confirm).toBe(true);
  });
});
