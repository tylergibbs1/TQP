// TQP Reference Server: Filesystem
// Exposes local filesystem operations as a TQP server.

import { TQP } from "../server";
import { statSync, readdirSync, existsSync } from "fs";
import { resolve, join, basename, extname, dirname } from "path";

export function createFilesystemServer(rootDir: string = process.cwd()): TQP {
  const root = resolve(rootDir);

  const server = new TQP({
    name: "filesystem",
    description: `Local filesystem access rooted at ${root}`,
  });

  server.type("FileInfo", {
    path:       { type: "string" },
    name:       { type: "string" },
    extension:  { type: "string" },
    size:       { type: "int" },
    is_dir:     { type: "bool" },
    modified:   { type: "string" },
    created:    { type: "string" },
  });

  server.type("FileContent", {
    path:     { type: "string" },
    name:     { type: "string" },
    content:  { type: "string", cost: "high" },
    size:     { type: "int" },
    lines:    { type: "int" },
  });

  server.type("DirListing", {
    path:     { type: "string" },
    entries:  { type: "list:FileInfo" },
    count:    { type: "int" },
  });

  function safePath(p: string): string {
    const resolved = resolve(root, p);
    if (!resolved.startsWith(root)) {
      throw new Error("Path outside root directory");
    }
    return resolved;
  }

  server.action("read_file", {
    description: "Read a file's contents",
    input: {
      path: { type: "string", required: true },
    },
    returns: "FileContent",
    safe: true,
    handler: async ({ path: filePath }) => {
      const full = safePath(filePath as string);
      if (!existsSync(full)) throw new Error(`File not found: ${filePath}`);
      const stat = statSync(full);
      const content = await Bun.file(full).text();
      return {
        path: filePath as string,
        name: basename(full),
        content,
        size: stat.size,
        lines: content.split("\n").length,
      };
    },
  });

  server.action("list_dir", {
    description: "List directory contents",
    input: {
      path:    { type: "string", default: "." },
      pattern: { type: "string" },
    },
    returns: "DirListing",
    safe: true,
    handler: async ({ path: dirPath, pattern }) => {
      const full = safePath((dirPath as string) ?? ".");
      if (!existsSync(full)) throw new Error(`Directory not found: ${dirPath}`);

      let entries = readdirSync(full);
      if (pattern) {
        const re = new RegExp(pattern as string);
        entries = entries.filter((e) => re.test(e));
      }

      const fileInfos = entries.map((name) => {
        const entryPath = join(full, name);
        const stat = statSync(entryPath);
        return {
          path: join((dirPath as string) ?? ".", name),
          name,
          extension: extname(name),
          size: stat.size,
          is_dir: stat.isDirectory(),
          modified: stat.mtime.toISOString(),
          created: stat.birthtime.toISOString(),
        };
      });

      return {
        path: (dirPath as string) ?? ".",
        entries: fileInfos,
        count: fileInfos.length,
      };
    },
  });

  server.action("stat_file", {
    description: "Get file metadata without reading content",
    input: {
      path: { type: "string", required: true },
    },
    returns: "FileInfo",
    safe: true,
    handler: async ({ path: filePath }) => {
      const full = safePath(filePath as string);
      if (!existsSync(full)) throw new Error(`File not found: ${filePath}`);
      const stat = statSync(full);
      return {
        path: filePath as string,
        name: basename(full),
        extension: extname(full),
        size: stat.size,
        is_dir: stat.isDirectory(),
        modified: stat.mtime.toISOString(),
        created: stat.birthtime.toISOString(),
      };
    },
  });

  server.action("write_file", {
    description: "Write content to a file",
    input: {
      path:    { type: "string", required: true },
      content: { type: "string", required: true },
    },
    returns: "FileContent",
    safe: false,
    confirm: true,
    dry_run: true,
    handler: async ({ path: filePath, content }, ctx) => {
      const full = safePath(filePath as string);
      const text = content as string;

      if (!ctx.dry_run) {
        await Bun.write(full, text);
      }

      return {
        path: filePath as string,
        name: basename(full),
        content: text,
        size: text.length,
        lines: text.split("\n").length,
      };
    },
  });

  server.action("delete_file", {
    description: "Delete a file",
    input: {
      path: { type: "string", required: true },
    },
    returns: "bool",
    safe: false,
    destructive: true,
    confirm: true,
    handler: async ({ path: filePath }) => {
      const full = safePath(filePath as string);
      if (!existsSync(full)) throw new Error(`File not found: ${filePath}`);
      const { unlinkSync } = require("fs");
      unlinkSync(full);
      return true;
    },
  });

  return server;
}

// Run standalone
if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const port = parseInt(process.env.TQP_PORT ?? "3001", 10);
  const server = createFilesystemServer(root);
  server.listen({ transport: "http", port });
}
