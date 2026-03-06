# TQP — Typed Query Protocol

A lightweight agent-tool protocol with **field selection**, **typed resources**, **lazy resolvers**, and **agent-aware metadata**. TQP gives AI agents a structured, cost-aware interface to your data so they can make better decisions about what to request.

## Why TQP?

MCP (Model Context Protocol) tools return opaque JSON blobs — agents get everything whether they need it or not. TQP lets agents request exactly the fields they need, skip expensive computations they don't, and reason about data structure before making calls.

```
// MCP: always returns everything
get_user("alice") → { id, name, email, phone, bio, avatar, activity_log, analytics... }

// TQP: agent requests only what it needs
get_user("alice", _fields: { name: true, email: true }) → { name: "Alice", email: "alice@co.com" }
```

### Key features

- **Field selection** — Agents request only the fields they need via a JSON `_fields` parameter
- **Typed data model** — Agents see a full type schema before calling tools, enabling better planning
- **Cost hints** — Fields marked `cost: "high"` tell agents to avoid expensive data unless needed
- **Lazy resolvers** — Expensive fields (DB joins, ML inference, external APIs) only execute when requested
- **Safety built-in** — `safe`, `confirm`, `dry_run` are protocol-level, not per-tool afterthoughts
- **Input hardening** — Path traversal, control char, and injection protection at the framework level
- **MCP bridge** — Expose any TQP server as MCP tools for backward compatibility

## Benchmarks

We gave Claude Sonnet 4 agents identical tasks and measured how many tokens each protocol used. Both servers follow best practices — MCP uses separate tools per concern, TQP uses field selection and typed resources. Token counts are exact billing amounts from the Claude API.

### The short version

| API | Token savings | Data reduction | Why |
|-----|---------------|----------------|-----|
| Hacker News (real API) | **20%** | **56%** | Field selection on stories/users |
| CRM (synthetic) | **7%** | **41%** | Composability — 1 call vs 9 calls |
| E-commerce (synthetic) | **57%** | **72%** | Scale + multi-turn compounding |

TQP saves the most when agents need **few fields from many items**. The more items and the fewer fields needed, the bigger the win.

### Where TQP wins big

**1. Picking fields from large lists**

"Get all 50 product names" — TQP requests `{name: true}` and strips 20+ unneeded fields per product. MCP returns everything. **65% fewer tokens.**

**2. Composing nested data in one call**

"Which companies are at risk?" — TQP fetches all company names + churn risk scores in **1 call**:
```json
{ "fields": { "name": true, "health_score": { "churn_risk": true } } }
```
MCP needs **9 calls** (list companies, then get health score for each one). **58% fewer tokens.**

**3. Multi-turn conversations**

"Research suppliers for top products" — TQP does this in **2 calls**. MCP needs **56 calls** across 4 agent turns. Each turn re-sends the growing conversation to Claude, so token costs balloon. **70% fewer tokens.**

### Where TQP doesn't help much

- **Text-heavy responses** where you need most fields anyway (reading full comments)
- **Small result sets** where there's not much to trim
- **Single-item lookups** where field selection saves a few fields at most

### Detailed results

<details>
<summary>Hacker News API — 8 scenarios, 20% token savings</summary>

Real Hacker News API. Tests field selection on stories, users, and comments.

| Metric | MCP | TQP | Savings |
|--------|-----|-----|---------|
| Total tokens | 52,220 | 41,504 | **20.5%** |
| Data to agent | 54,350 chars | 25,183 chars | **56.3%** |
| Wall time | 89.6s | 89.3s | ~equal |
| Backend API calls | 105 | 104 | ~equal |

| Scenario | Token savings | Data reduction |
|----------|--------------|----------------|
| Top 5 titles | 9.5% | 79.3% |
| Story + author karma | 0.9% | 91.9% |
| Comment summary | -5.3% | 13.1% |
| Top 20 titles only | 42.9% | 84.7% |
| Top 10 + all authors karma | 46.9% | 91.9% |
| Deep comment thread | 8.0% | 21.4% |
| Multi-story comments | 10.8% | 21.3% |
| Author deep dive | 22.1% | 92.0% |

</details>

<details>
<summary>CRM API — 8 scenarios, 7% token savings, 41% data reduction</summary>

Synthetic CRM with cheap fields (in-memory) and expensive fields (DB joins at 150ms, ML inference at 300ms). Shows lazy resolver and composability benefits.

| Metric | MCP | TQP | Savings |
|--------|-----|-----|---------|
| Total tokens | 55,771 | 51,655 | **7.4%** |
| Data to agent | 35,869 chars | 21,044 chars | **41.3%** |

| Scenario | Token savings | What happened |
|----------|--------------|---------------|
| Company names only | 20.5% | Field selection strips 5 unneeded fields per company |
| Pipeline value by stage | 38.8% | Only deal value + stage needed from full deal objects |
| Health check (top 3) | 47.7% | TQP: 1 call. MCP: 4 calls (list + 3 health lookups) |
| Revenue forecast | 14.4% | Only predicted ARR needed from full forecast object |
| Full company dossier | 15.9% | Both need everything; TQP saves with fewer calls |
| At-risk companies | 58.7% | TQP: 1 call. MCP: 9 calls (list + 8 health checks) |
| Contact search | 18.4% | Field selection on search results |

</details>

<details>
<summary>E-commerce API — 8 scenarios, 57% token savings, 72% data reduction</summary>

50 products with 20+ fields and 6 expensive resolver fields. Tests scale, multi-turn research, and write operations.

| Category | MCP tokens | TQP tokens | Token savings | Data reduction |
|----------|-----------|-----------|---------------|----------------|
| Scale (4 scenarios) | 48,296 | 20,126 | **58.3%** | **86.9%** |
| Multi-turn (3 scenarios) | 74,110 | 27,755 | **62.5%** | **43.5%** |
| Write ops (1 scenario) | 15,035 | 10,792 | **28.2%** | **75.5%** |
| **TOTAL** | **137,441** | **58,673** | **57.3%** | **72.0%** |

| Scenario | Token savings | What happened |
|----------|--------------|---------------|
| All 50 product names | 65.7% | `{name: true}` strips 20+ fields per product |
| Top rated products | 59.6% | Only name + rating needed from 50 products |
| Price comparison | 64.0% | Only name + price needed from 50 products |
| In-stock electronics | 8.5% | Small result set, less to trim |
| Supplier research | 70.9% | TQP: 2 calls. MCP: 56 calls across 4 turns |
| Category analysis | 53.8% | TQP: 2 calls. MCP: 8 calls for separate analytics |
| Product deep dive | ~equal | Both need most fields |
| Shopping workflow | 28.2% | Field selection during cart building |

</details>

### Running benchmarks

```bash
# Hacker News benchmark
bun run bench/hn-tqp.ts &        # Start TQP server on :3010
bun run bench/run.ts              # Run benchmark

# CRM benchmark
TQP_PORT=3020 bun run bench/crm-tqp.ts &  # Start CRM TQP server on :3020
bun run bench/run-crm.ts                    # Run benchmark

# E-commerce benchmark (scale + multi-turn + write ops)
TQP_PORT=3030 bun run bench/heavy-tqp.ts &  # Start server on :3030
bun run bench/run-heavy.ts                    # Run benchmark
```

## Quick start

```bash
bun add tqp
```

### Define a server

```typescript
import { TQP } from "tqp";

const server = new TQP({ name: "my-api", description: "My API" });

server.type("User", {
  id:       { type: "string" },
  name:     { type: "string" },
  email:    { type: "string" },
  bio:      { type: "string", cost: "high" },
  posts:    { type: "list:Post", cost: "high" },
});

server.action("get_user", {
  description: "Get a user by ID",
  input: { id: { type: "string", required: true } },
  returns: "User",
  safe: true,
  handler: async ({ id }) => {
    return { id, name: "Alice", email: "alice@co.com", bio: "", posts: [] };
  },
  resolve: {
    bio: async ({ id }) => fetchBioFromDB(id),       // Only runs if bio requested
    posts: async ({ id }) => fetchPostsFromDB(id),    // Only runs if posts requested
  },
});

server.listen({ transport: "http", port: 3000 });
```

### Call from a client

```typescript
import { TQPClient } from "tqp/client";

const client = new TQPClient("http://localhost:3000");

// Get only name and email — bio and posts resolvers never run
const res = await client.call("get_user", {
  input: { id: "alice" },
  fields: { name: true, email: true },
});
// → { name: "Alice", email: "alice@co.com" }
```

## Protocol specification

### Request format

All requests are JSON objects sent via `POST /tqp`:

```json
{
  "action": "get_user",
  "input": { "id": "alice" },
  "fields": { "name": true, "email": true },
  "dry_run": false,
  "confirmed": false,
  "id": "req_123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | Action name or built-in action (`tqp.manifest`, `tqp.describe`, `tqp.health`) |
| `input` | object | no | Action input parameters |
| `fields` | object | no | Field selector (omit to return all fields) |
| `dry_run` | boolean | no | Preview effects without executing (action must support it) |
| `confirmed` | boolean | no | Required for actions with `confirm: true` |
| `id` | string | no | Request ID, echoed in response |

### Response format

```json
{
  "id": "req_123",
  "data": { "name": "Alice", "email": "alice@co.com" },
  "error": null,
  "meta": {
    "cost_tokens_estimate": 12,
    "dry_run": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Echoed from request |
| `data` | any | Response data (filtered by `fields` if provided) |
| `error` | object \| null | Error object with `code`, `message`, optional `field` and `type` |
| `meta.cost_tokens_estimate` | number | Estimated token cost of the response (~4 chars/token) |
| `meta.dry_run` | boolean | Whether this was a dry run |

### Error codes

| Code | Meaning |
|------|---------|
| `INVALID_ACTION` | Action not found |
| `INVALID_FIELD` | Field doesn't exist on the return type |
| `INVALID_INPUT` | Missing required field, wrong type, or failed hardening |
| `REQUIRES_CONFIRMATION` | Action needs `"confirmed": true` |
| `DRY_RUN_NOT_SUPPORTED` | Action doesn't support dry run |
| `RATE_LIMITED` | Rate limit exceeded |
| `UNAUTHORIZED` | Authentication required |
| `INTERNAL` | Server error |

### Built-in actions

Every TQP server exposes these automatically:

- `tqp.manifest` — Returns the full manifest (types + actions). Also available via `GET /tqp/manifest`.
- `tqp.describe` — Describe a type. Input: `{ type: "User" }`.
- `tqp.health` — Health check. Also available via `GET /tqp/health`.

### HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tqp` | Execute a TQP request |
| `GET` | `/tqp/manifest` | Get the manifest |
| `GET` | `/tqp/health` | Health check |

## Type system

### Primitive types

| TQP type | Description | TypeScript equivalent |
|----------|-------------|----------------------|
| `string` | String value | `string` |
| `int` | Integer | `number` |
| `float` | Floating-point number | `number` |
| `bool` | Boolean | `boolean` |

### Modifiers

- **Optional:** Append `?` — e.g., `"string?"` means the field may be null/undefined
- **List:** Prefix `list:` — e.g., `"list:string"` is a string array, `"list:Post"` is an array of Post objects
- **Combined:** `"list:Post?"` is an optional list of Posts

### Defining types

```typescript
server.type("User", {
  id:       { type: "string" },
  name:     { type: "string" },
  email:    { type: "string" },
  role:     { type: "string", enum: ["admin", "user", "guest"] },
  bio:      { type: "string", cost: "high", description: "Full biography (DB lookup)" },
  score:    { type: "float", deprecated: "Use rating instead" },
  posts:    { type: "list:Post", cost: "high" },
  address:  { type: "Address" },       // Nested type reference
  tags:     { type: "list:string" },    // Primitive list
});
```

### Field definition options

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | Required. Type string (see above) |
| `description` | string | Human-readable description shown to agents |
| `cost` | `"low"` \| `"medium"` \| `"high"` | Hints agents to avoid expensive fields |
| `enum` | string[] | Allowed values (validated at framework level) |
| `default` | any | Default value for action inputs |
| `required` | boolean | Whether the field is required (for action inputs) |
| `deprecated` | string | Deprecation message |

## Field selection

The core feature of TQP. Agents send a `fields` object that specifies exactly which fields to return.

### Syntax

```json
{
  "fields": {
    "name": true,
    "email": true,
    "address": {
      "city": true,
      "country": true
    }
  }
}
```

- `true` — Include this scalar field
- `{ ... }` — Include this object/list field, recursing into nested fields
- Omit a field — Exclude it from the response
- Omit `fields` entirely — Return all fields (no filtering)

### How it works

1. Agent sends request with `fields` selector
2. Server validates that every requested field exists on the return type
3. Handler executes and returns the full object
4. Lazy resolvers run **only** for fields present in the selector
5. Field filter strips everything not in the selector
6. Response contains only requested fields

### Nested selection on lists

Field selection applies recursively to every item in a list:

```json
// Get all 50 product names — nothing else
{
  "action": "list_products",
  "input": { "limit": 50 },
  "fields": { "name": true }
}
// → [{ "name": "Product 1" }, { "name": "Product 2" }, ...]
```

## Lazy resolvers

Expensive fields (DB joins, ML inference, external APIs) can be defined as resolvers that only execute when the agent requests them.

```typescript
server.action("get_user", {
  description: "Get a user by ID",
  input: { id: { type: "string", required: true } },
  returns: "User",
  safe: true,
  handler: async ({ id }) => {
    // Fast: return cheap fields from cache/memory
    return { id, name: "Alice", email: "alice@co.com", bio: "", posts: [] };
  },
  resolve: {
    // Slow: only runs if agent requests bio
    bio: async ({ id }) => {
      return await db.query("SELECT bio FROM users WHERE id = ?", [id]);
    },
    // Slow: only runs if agent requests posts
    posts: async ({ id }) => {
      return await db.query("SELECT * FROM posts WHERE author_id = ?", [id]);
    },
  },
});
```

**Key behavior:**
- If agent sends `fields: { name: true, email: true }` — no resolvers run
- If agent sends `fields: { name: true, bio: true }` — only the `bio` resolver runs
- If agent omits `fields` — all resolvers run (everything returned)
- Resolvers receive the same `input` as the handler
- For list returns, resolvers run per item

### Combining with cost hints

Mark resolver fields as `cost: "high"` so agents know to avoid them unless needed:

```typescript
server.type("Company", {
  name:          { type: "string" },                                    // cheap
  health_score:  { type: "HealthScore", cost: "high", description: "ML inference (300ms)" },
  forecast:      { type: "Forecast", cost: "high", description: "Aggregation query (500ms)" },
});
```

Agents see this in the manifest and can make informed decisions about what to request.

## Safety metadata

TQP bakes safety into the protocol instead of leaving it to individual tool descriptions.

### Action safety flags

```typescript
server.action("delete_user", {
  description: "Delete a user account",
  input: { id: { type: "string", required: true } },
  returns: "User",
  safe: false,           // Has side effects
  destructive: true,     // Cannot be undone
  confirm: true,         // Requires "confirmed": true in request
  dry_run: true,         // Supports "dry_run": true to preview
  idempotent: false,     // Not safe to retry
  rate_limit: "10/min",  // Rate limit hint
  handler: async ({ id }, ctx) => {
    if (ctx.dry_run) {
      return { id, name: "Alice", status: "would_be_deleted" };
    }
    return await db.deleteUser(id);
  },
});
```

| Flag | Type | Meaning |
|------|------|---------|
| `safe` | boolean | `true` = read-only, no side effects. Agents can call freely. |
| `destructive` | boolean | `true` = cannot be undone. Agents should warn users. |
| `confirm` | boolean | `true` = server rejects unless `"confirmed": true` in request |
| `dry_run` | boolean | `true` = supports `"dry_run": true` to preview without executing |
| `idempotent` | boolean | `true` = safe to retry on failure |
| `rate_limit` | string | Hint like `"10/min"` or `"100/hour"` |

### Confirmation flow

```
Agent → { action: "place_order", confirmed: false }
Server → { error: { code: "REQUIRES_CONFIRMATION", message: "..." } }
Agent → (asks user for confirmation)
Agent → { action: "place_order", confirmed: true }
Server → { data: { id: "ord_123", status: "confirmed" } }
```

### Dry run flow

```
Agent → { action: "place_order", dry_run: true }
Server → { data: { total: 149.99, items: 3 }, meta: { dry_run: true } }
Agent → (shows preview to user, asks to proceed)
Agent → { action: "place_order", confirmed: true }
```

## Input validation and hardening

TQP validates and hardens all input at the framework level — handlers never see invalid data.

### Automatic validation

- **Required fields** — Returns `INVALID_INPUT` if missing
- **Type checking** — Validates strings, ints, floats, bools, arrays
- **Enum validation** — Rejects values not in the `enum` list
- **Unknown fields** — Rejects fields not defined in the action's input schema
- **Default values** — Applied automatically before the handler runs
- **Field selector validation** — Validates that requested fields exist on the return type, with max nesting depth of 10

### Security hardening

All string inputs are automatically checked for:

- **Path traversal** — Rejects `../`, `..\\`, `%2e%2e` patterns
- **Control characters** — Rejects `\x00`–`\x08`, `\x0b`, `\x0c`, `\x0e`–`\x1f`
- **Resource ID injection** — Rejects `?` and `#` in fields ending with `_id`

These protections apply recursively to arrays.

## Manifest

The manifest is the complete schema of a TQP server — all types and actions with their metadata. Agents fetch it once to understand the full data model before making calls.

```json
{
  "tqp": "0.1.0",
  "name": "my-api",
  "description": "My API",
  "types": {
    "User": {
      "fields": {
        "id":    { "type": "string" },
        "name":  { "type": "string" },
        "bio":   { "type": "string", "cost": "high", "description": "Full biography" }
      }
    }
  },
  "actions": {
    "get_user": {
      "description": "Get a user by ID",
      "input": { "id": { "type": "string", "required": true } },
      "returns": "User",
      "safe": true
    }
  }
}
```

## MCP bridge

Expose any TQP server as MCP-compatible tools for backward compatibility with MCP clients.

```typescript
import { TQP } from "tqp";
import { MCPBridge } from "tqp/mcp-bridge";

const server = new TQP({ name: "my-api", description: "My API" });
// ... register types and actions ...

const bridge = new MCPBridge(server);
await bridge.listenStdio();  // Speaks MCP JSON-RPC over stdio
```

**How it works:**
- Each TQP action becomes an MCP tool
- An `_fields` parameter is injected into every tool's input schema for field selection
- Safety flags are included in tool descriptions (`[DESTRUCTIVE]`, `[REQUIRES CONFIRMATION]`, `(has side effects)`)
- Return type field descriptions are included so agents know what to select
- Confirmation is auto-accepted (MCP doesn't have native confirmation)
- Supports `initialize`, `tools/list`, `tools/call`, `ping`

## Client API

```typescript
import { TQPClient } from "tqp/client";

const client = new TQPClient("http://localhost:3000");

// Get the manifest (cached after first call)
const manifest = await client.getManifest();

// Health check
const health = await client.health();
// → { status: "ok", version: "0.1.0" }

// Describe a type
const userType = await client.describe("User");

// Call an action with field selection
const res = await client.call("get_user", {
  input: { id: "alice" },
  fields: { name: true, email: true },
});
// res.data → { name: "Alice", email: "alice@co.com" }

// Dry run
const preview = await client.call("place_order", {
  dry_run: true,
});

// Confirmed action
const order = await client.call("place_order", {
  confirmed: true,
});
```

## Transport options

### HTTP (default)

```typescript
server.listen({ transport: "http", port: 3000, hostname: "0.0.0.0" });
```

- `POST /tqp` — Execute requests
- `GET /tqp/manifest` — Get manifest
- `GET /tqp/health` — Health check

### stdio

```typescript
server.listen({ transport: "stdio" });
```

Reads newline-delimited JSON from stdin, writes responses to stdout. Useful for subprocess-based integrations (like MCP bridge).

## CLI reference

```bash
tqp init <name>                           # Scaffold a new TQP server
tqp serve [file]                          # Start the dev server (default: server.ts)
tqp manifest [url]                        # Print the manifest from a running server
tqp describe <type> [url]                 # Describe a specific type
tqp call <action> [options]               # Call an action on a running server
tqp validate <file>                       # Validate a manifest JSON file
tqp codegen <file> [--output <path>]      # Generate TypeScript types from manifest
```

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help |
| `--port` | `-p` | Server port (default: 3000) |
| `--url` | `-u` | Server URL (default: http://localhost:3000) |
| `--input` | `-i` | JSON input for action call |
| `--fields` | `-f` | JSON fields selector for action call |
| `--output` | `-o` | Output file path |

### Examples

```bash
# Start a server
tqp serve my-server.ts

# Inspect the manifest
tqp manifest http://localhost:3000

# Describe a type
tqp describe User http://localhost:3000

# Call an action with field selection
tqp call get_user -i '{"id":"alice"}' -f '{"name":true,"email":true}'

# Generate TypeScript types
tqp codegen manifest.json --output types.ts

# Validate a manifest
tqp validate manifest.json
```

## Codegen

Generate TypeScript types from a TQP manifest:

```bash
tqp codegen manifest.json --output generated-types.ts
```

Produces:

```typescript
// Generated by tqp codegen from "my-api" manifest
// TQP version: 0.1.0

export interface User {
  id: string;
  name: string;
  /** Full biography — @cost high */
  bio: string;
  posts: Post[];
}

/** Input for get_user: Get a user by ID */
export interface GetUserInput {
  id: string;
}

export type GetUserResult = User;

export type ActionName = "get_user" | "list_users";
```

## Agent prompt generation

Generate a structured prompt that teaches an agent how to use your TQP server:

```typescript
import { generateAgentPrompt } from "tqp/prompt";

const prompt = generateAgentPrompt(manifest);
// Returns a markdown document with:
// - Data model (all types with fields, costs, descriptions)
// - Available actions (inputs, returns, safety flags)
// - Query instructions (field selection syntax, tips)
```

## Project structure

```
src/
  types.ts        — Core type definitions
  server.ts       — TQP server (type/action registration, HTTP/stdio transport)
  validate.ts     — Input validation, field validation, hardening
  filter.ts       — Recursive field filtering engine
  tokens.ts       — Token cost estimation
  codegen.ts      — TypeScript type generation from manifests
  prompt.ts       — Agent prompt template generation
  mcp-bridge.ts   — TQP-to-MCP compatibility bridge
  client/         — TQPClient for HTTP
  cli/            — CLI tool (init, serve, call, describe, manifest, validate, codegen)
  servers/        — Reference server implementations (filesystem, sqlite, github)
tests/            — 91 tests
bench/            — Benchmark suite (HN + CRM + E-commerce, TQP vs MCP)
```

## Commands

```bash
bun test                                    # Run all tests
bun run src/cli/index.ts                    # Run CLI
bun run src/servers/filesystem.ts [root]    # Filesystem server
bun run src/servers/sqlite.ts [db]          # SQLite server
bun run src/servers/github.ts               # GitHub server (needs GITHUB_TOKEN)
```

## License

MIT
