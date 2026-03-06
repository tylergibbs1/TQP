#!/usr/bin/env bun
// TQP vs MCP — Heavy Benchmark
//
// Three test surfaces:
// 1. Scale: 50 products, 20+ fields, deep nesting — field selection at scale
// 2. Write operations: TQP has safe/confirm; MCP just calls through
// 3. Multi-turn research: agent must gather data across many calls, context compounds

import Anthropic from "@anthropic-ai/sdk";
import { TQPClient } from "../src/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resetStats, readStats, type BenchStats } from "./stats";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) { console.error("Set ANTHROPIC_API_KEY"); process.exit(1); }

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-20250514";
const TQP_URL = "http://127.0.0.1:3030";

interface AgentResult {
  response: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tool_calls: number;
  tool_result_chars: number;
  wall_ms: number;
  backend_stats: BenchStats;
}

// ── MCP Agent ──────────────────────────────────────────────

async function runMCPAgent(task: string): Promise<AgentResult> {
  resetStats();
  const t0 = performance.now();
  const transport = new StdioClientTransport({ command: "bun", args: ["run", "bench/heavy-mcp.ts"], cwd: process.cwd() });
  const mcpClient = new Client({ name: "bench", version: "1.0.0" });
  await mcpClient.connect(transport);

  const { tools: mcpTools } = await mcpClient.listTools();
  const claudeTools: Anthropic.Messages.Tool[] = mcpTools.map((t) => ({
    name: t.name, description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));

  let totalIn = 0, totalOut = 0, calls = 0, chars = 0;
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: task }];

  while (true) {
    const r = await anthropic.messages.create({ model: MODEL, max_tokens: 4096, tools: claudeTools, messages });
    totalIn += r.usage.input_tokens; totalOut += r.usage.output_tokens;
    if (r.stop_reason === "end_turn") {
      const text = r.content.find((b) => b.type === "text");
      await mcpClient.close();
      return { response: text ? (text as any).text : "", input_tokens: totalIn, output_tokens: totalOut,
        total_tokens: totalIn + totalOut, tool_calls: calls, tool_result_chars: chars,
        wall_ms: performance.now() - t0, backend_stats: readStats() };
    }
    messages.push({ role: "assistant", content: r.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const b of r.content) {
      if (b.type === "tool_use") {
        calls++;
        const res = await mcpClient.callTool({ name: b.name, arguments: b.input as any });
        const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        chars += text.length;
        results.push({ type: "tool_result", tool_use_id: b.id, content: text });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

// ── TQP Agent ──────────────────────────────────────────────

async function runTQPAgent(task: string): Promise<AgentResult> {
  resetStats();
  const t0 = performance.now();
  const tqp = new TQPClient(TQP_URL);
  const manifest = await tqp.getManifest();

  const claudeTools: Anthropic.Messages.Tool[] = Object.entries(manifest.actions).map(([name, action]) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [pn, pd] of Object.entries(action.input)) {
      const typeMap: Record<string, string> = { string: "string", int: "integer", float: "number", bool: "boolean" };
      const base = pd.type.replace("?", "");
      if (base.startsWith("list:")) properties[pn] = { type: "array", description: pd.description };
      else properties[pn] = { type: typeMap[base] ?? "object", description: pd.description, enum: pd.enum };
      if (pd.required) required.push(pn);
    }
    const retBase = action.returns.replace("list:", "").replace("?", "");
    const typeDef = manifest.types[retBase];
    let fd = `Field selector. Only request fields you need. Returns: ${action.returns}.`;
    if (typeDef) {
      const fl = Object.entries(typeDef.fields).map(([fn, f]) => {
        let s = `${fn}: ${f.type}`; if (f.cost === "high") s += " (EXPENSIVE)"; if (f.description) s += ` — ${f.description}`; return s;
      });
      fd += ` Fields: ${fl.join(", ")}. Use {"field": true}.`;
    }
    properties["_fields"] = { type: "object", description: fd };
    return { name, description: action.description + (action.safe === false ? " (has side effects)" : ""),
      input_schema: { type: "object" as const, properties, required: required.length > 0 ? required : undefined } };
  });

  let totalIn = 0, totalOut = 0, calls = 0, chars = 0;
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: task }];

  while (true) {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 4096,
      system: "You have access to an e-commerce system via TQP tools. IMPORTANT: Always use _fields to request ONLY the fields you need. Fields marked EXPENSIVE trigger slow backend operations — never request them unless needed. Example: _fields: {name: true, price: true}.",
      tools: claudeTools, messages,
    });
    totalIn += r.usage.input_tokens; totalOut += r.usage.output_tokens;
    if (r.stop_reason === "end_turn") {
      const text = r.content.find((b) => b.type === "text");
      return { response: text ? (text as any).text : "", input_tokens: totalIn, output_tokens: totalOut,
        total_tokens: totalIn + totalOut, tool_calls: calls, tool_result_chars: chars,
        wall_ms: performance.now() - t0, backend_stats: readStats() };
    }
    messages.push({ role: "assistant", content: r.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const b of r.content) {
      if (b.type === "tool_use") {
        calls++;
        const input = { ...(b.input as Record<string, unknown>) };
        const fields = input._fields; delete input._fields;
        for (const k of Object.keys(input)) { if (input[k] === undefined) delete input[k]; }
        const res = await tqp.call(b.name, { input, fields: fields as any });
        const text = JSON.stringify(res.data, null, 2);
        chars += text.length;
        results.push({ type: "tool_result", tool_use_id: b.id, content: text });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

// ── Scenarios ──────────────────────────────────────────────

const SCENARIOS = [
  // Scale tests
  {
    name: "All 50 product names",
    task: "List the names of all 50 products in the catalog. Just the names, nothing else.",
    category: "Scale",
  },
  {
    name: "In-stock electronics",
    task: "Which electronics products are currently in stock? List product name and price for each.",
    category: "Scale",
  },
  {
    name: "Top rated products",
    task: "What are the top 5 highest-rated products? Show name, rating, and review count.",
    category: "Scale",
  },
  {
    name: "Price comparison",
    task: "Compare prices across all 50 products. What's the cheapest and most expensive? What's the average price? Just name and price for each extremes.",
    category: "Scale",
  },
  // Multi-turn research
  {
    name: "Product deep dive",
    task: "I'm considering buying prod_7. Give me a full analysis: the product details, what reviewers say (summarize the reviews), how the price has changed over the past year, and who the supplier is. Then recommend whether to buy.",
    category: "Multi-turn",
  },
  {
    name: "Category analysis",
    task: "Compare the Electronics and Clothing categories: how many products in each, average price, average rating, and which has better conversion rates (analytics). Give me a brief recommendation on which category to invest more inventory in.",
    category: "Multi-turn",
  },
  {
    name: "Supplier research",
    task: "I need to evaluate our supply chain. For the top 5 most-viewed products (by analytics), tell me their supplier name, country, lead time, and reliability score. Which supplier is the most reliable?",
    category: "Multi-turn",
  },
  // Write operations
  {
    name: "Shopping workflow",
    task: "I want to buy the cheapest Electronics product and the highest-rated Sports product. Find them, add both to my cart, and show me the cart contents with the total price.",
    category: "Write",
  },
];

function pad(s: string, n: number): string { return s.padEnd(n); }

async function main() {
  console.log("TQP vs MCP — Heavy Benchmark");
  console.log("Model:", MODEL);
  console.log("50 products, 20+ fields, expensive resolvers, write operations, multi-turn research");
  console.log("=".repeat(120));

  try { await fetch(`${TQP_URL}/tqp/health`); } catch {
    console.error("Heavy TQP server not running. Start with: TQP_PORT=3030 bun run bench/heavy-tqp.ts");
    process.exit(1);
  }

  const results: { name: string; category: string; mcp: AgentResult; tqp: AgentResult }[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n${"─".repeat(120)}`);
    console.log(`[${scenario.category}] ${scenario.name}`);
    console.log(`Task: "${scenario.task}"`);

    process.stdout.write("\n  MCP agent...");
    const mcpResult = await runMCPAgent(scenario.task);
    console.log(` done (${(mcpResult.wall_ms / 1000).toFixed(1)}s, ${mcpResult.tool_calls} calls)`);

    process.stdout.write("  TQP agent...");
    const tqpResult = await runTQPAgent(scenario.task);
    console.log(` done (${(tqpResult.wall_ms / 1000).toFixed(1)}s, ${tqpResult.tool_calls} calls)`);

    results.push({ name: scenario.name, category: scenario.category, mcp: mcpResult, tqp: tqpResult });

    const tSav = ((1 - tqpResult.total_tokens / mcpResult.total_tokens) * 100).toFixed(1);
    const aSav = mcpResult.backend_stats.api_calls > 0
      ? ((1 - tqpResult.backend_stats.api_calls / mcpResult.backend_stats.api_calls) * 100).toFixed(1) : "=";
    const wSav = ((1 - tqpResult.wall_ms / mcpResult.wall_ms) * 100).toFixed(1);

    console.log(`\n  ${"Metric".padEnd(22)} ${"MCP".padEnd(14)} ${"TQP".padEnd(14)} Savings`);
    console.log(`  ${"─".repeat(60)}`);
    console.log(`  ${"Tokens".padEnd(22)} ${String(mcpResult.total_tokens).padEnd(14)} ${String(tqpResult.total_tokens).padEnd(14)} ${tSav}%`);
    console.log(`  ${"Backend ops".padEnd(22)} ${String(mcpResult.backend_stats.api_calls).padEnd(14)} ${String(tqpResult.backend_stats.api_calls).padEnd(14)} ${aSav}%`);
    console.log(`  ${"Resolver runs".padEnd(22)} ${"n/a".padEnd(14)} ${String(tqpResult.backend_stats.resolver_runs).padEnd(14)}`);
    console.log(`  ${"Data chars".padEnd(22)} ${mcpResult.tool_result_chars.toLocaleString().padEnd(14)} ${tqpResult.tool_result_chars.toLocaleString().padEnd(14)}`);
    console.log(`  ${"Wall time".padEnd(22)} ${((mcpResult.wall_ms / 1000).toFixed(1) + "s").padEnd(14)} ${((tqpResult.wall_ms / 1000).toFixed(1) + "s").padEnd(14)} ${wSav}%`);
    console.log(`  ${"Tool calls".padEnd(22)} ${String(mcpResult.tool_calls).padEnd(14)} ${String(tqpResult.tool_calls).padEnd(14)}`);
  }

  // Summary by category
  for (const cat of ["Scale", "Multi-turn", "Write"]) {
    const catResults = results.filter(r => r.category === cat);
    const mcpTok = catResults.reduce((s, r) => s + r.mcp.total_tokens, 0);
    const tqpTok = catResults.reduce((s, r) => s + r.tqp.total_tokens, 0);
    const mcpApi = catResults.reduce((s, r) => s + r.mcp.backend_stats.api_calls, 0);
    const tqpApi = catResults.reduce((s, r) => s + r.tqp.backend_stats.api_calls, 0);
    const mcpChr = catResults.reduce((s, r) => s + r.mcp.tool_result_chars, 0);
    const tqpChr = catResults.reduce((s, r) => s + r.tqp.tool_result_chars, 0);
    const mcpMs = catResults.reduce((s, r) => s + r.mcp.wall_ms, 0);
    const tqpMs = catResults.reduce((s, r) => s + r.tqp.wall_ms, 0);
    const tqpRes = catResults.reduce((s, r) => s + r.tqp.backend_stats.resolver_runs, 0);

    console.log(`\n${"═".repeat(120)}`);
    console.log(`${cat.toUpperCase()} SUMMARY (${catResults.length} scenarios)`);
    console.log(`${"─".repeat(80)}`);
    console.log(`  Tokens:      MCP ${mcpTok.toLocaleString()} → TQP ${tqpTok.toLocaleString()} (${((1 - tqpTok / mcpTok) * 100).toFixed(1)}%)`);
    console.log(`  Backend ops: MCP ${mcpApi} → TQP ${tqpApi} (${mcpApi > 0 ? ((1 - tqpApi / mcpApi) * 100).toFixed(1) : 0}%)`);
    console.log(`  Data chars:  MCP ${mcpChr.toLocaleString()} → TQP ${tqpChr.toLocaleString()} (${mcpChr > 0 ? ((1 - tqpChr / mcpChr) * 100).toFixed(1) : 0}%)`);
    console.log(`  Wall time:   MCP ${(mcpMs / 1000).toFixed(1)}s → TQP ${(tqpMs / 1000).toFixed(1)}s (${((1 - tqpMs / mcpMs) * 100).toFixed(1)}%)`);
    console.log(`  Resolvers:   ${tqpRes} TQP resolver runs`);
  }

  // Grand total
  const gMcpTok = results.reduce((s, r) => s + r.mcp.total_tokens, 0);
  const gTqpTok = results.reduce((s, r) => s + r.tqp.total_tokens, 0);
  const gMcpApi = results.reduce((s, r) => s + r.mcp.backend_stats.api_calls, 0);
  const gTqpApi = results.reduce((s, r) => s + r.tqp.backend_stats.api_calls, 0);
  const gMcpChr = results.reduce((s, r) => s + r.mcp.tool_result_chars, 0);
  const gTqpChr = results.reduce((s, r) => s + r.tqp.tool_result_chars, 0);
  const gMcpMs = results.reduce((s, r) => s + r.mcp.wall_ms, 0);
  const gTqpMs = results.reduce((s, r) => s + r.tqp.wall_ms, 0);
  const gTqpRes = results.reduce((s, r) => s + r.tqp.backend_stats.resolver_runs, 0);

  console.log(`\n${"═".repeat(120)}`);
  console.log("GRAND TOTAL (all 8 scenarios)");
  console.log(`${"─".repeat(80)}`);
  console.log(`  Tokens:      MCP ${gMcpTok.toLocaleString()} → TQP ${gTqpTok.toLocaleString()} (${((1 - gTqpTok / gMcpTok) * 100).toFixed(1)}% savings)`);
  console.log(`  Backend ops: MCP ${gMcpApi} → TQP ${gTqpApi} (${gMcpApi > 0 ? ((1 - gTqpApi / gMcpApi) * 100).toFixed(1) : 0}% savings)`);
  console.log(`  Data chars:  MCP ${gMcpChr.toLocaleString()} → TQP ${gTqpChr.toLocaleString()} (${gMcpChr > 0 ? ((1 - gTqpChr / gMcpChr) * 100).toFixed(1) : 0}% savings)`);
  console.log(`  Wall time:   MCP ${(gMcpMs / 1000).toFixed(1)}s → TQP ${(gTqpMs / 1000).toFixed(1)}s (${((1 - gTqpMs / gMcpMs) * 100).toFixed(1)}% savings)`);
  console.log(`  Resolvers:   ${gTqpRes} TQP resolver runs (expensive ops only when needed)`);
}

main().catch(console.error);
