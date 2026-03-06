# TQP — Typed Query Protocol

## Project

TQP is a lightweight agent-tool protocol with field selection, typed resources, and agent-aware metadata. Runtime: Bun + TypeScript.

## Structure

- `src/types.ts` — Core type definitions
- `src/server.ts` — TQP server class (type/action registration, request handling, HTTP/stdio transport)
- `src/validate.ts` — Input validation, field validation, hardening
- `src/filter.ts` — Recursive field filtering engine
- `src/tokens.ts` — Token cost estimation
- `src/codegen.ts` — TypeScript type generation from manifests
- `src/prompt.ts` — Agent prompt template generation
- `src/mcp-bridge.ts` — TQP-to-MCP compatibility bridge
- `src/client/index.ts` — TQPClient for HTTP
- `src/cli/` — CLI tool (init, serve, call, describe, manifest, validate, codegen)
- `src/servers/` — Reference server implementations (filesystem, sqlite, github)
- `tests/` — Test suite (91 tests)

## Commands

- `bun test` — Run all tests
- `bun run src/cli/index.ts` — Run CLI
- `bun run src/servers/filesystem.ts [root]` — Run filesystem server
- `bun run src/servers/sqlite.ts [db]` — Run SQLite server
- `bun run src/servers/github.ts` — Run GitHub server (needs GITHUB_TOKEN)

## Conventions

- Use Bun, not Node.js
- Validation happens at framework level, not in handlers
- Handlers return full objects; field filtering is automatic
- Lazy resolvers only run when their fields are requested
