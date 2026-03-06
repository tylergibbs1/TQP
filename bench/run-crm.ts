#!/usr/bin/env bun
// TQP vs MCP Benchmark — Synthetic CRM API
//
// This benchmark exercises lazy resolvers and field selection
// on a richer data model where some fields are genuinely expensive.

import Anthropic from "@anthropic-ai/sdk";
import { TQPClient } from "../src/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resetStats, readStats, type BenchStats } from "./stats";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-20250514";
const TQP_URL = "http://127.0.0.1:3020";

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

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "bench/crm-mcp.ts"],
    cwd: process.cwd(),
  });
  const mcpClient = new Client({ name: "bench-client", version: "1.0.0" });
  await mcpClient.connect(transport);

  const { tools: mcpTools } = await mcpClient.listTools();
  const claudeTools: Anthropic.Messages.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));

  let totalIn = 0, totalOut = 0, toolCallCount = 0, toolResultChars = 0;
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: task }];

  while (true) {
    const response = await anthropic.messages.create({
      model: MODEL, max_tokens: 4096, tools: claudeTools, messages,
    });
    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const text = response.content.find((b) => b.type === "text");
      await mcpClient.close();
      return {
        response: text ? (text as any).text : "",
        input_tokens: totalIn, output_tokens: totalOut, total_tokens: totalIn + totalOut,
        tool_calls: toolCallCount, tool_result_chars: toolResultChars,
        wall_ms: performance.now() - t0, backend_stats: readStats(),
      };
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCallCount++;
        const result = await mcpClient.callTool({ name: block.name, arguments: block.input as any });
        const resultText = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        toolResultChars += resultText.length;
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
      }
    }
    messages.push({ role: "user", content: toolResults });
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

    for (const [paramName, paramDef] of Object.entries(action.input)) {
      const typeMap: Record<string, string> = { string: "string", int: "integer", float: "number", bool: "boolean" };
      const baseType = paramDef.type.replace("?", "");
      if (baseType.startsWith("list:")) {
        properties[paramName] = { type: "array", description: paramDef.description };
      } else {
        properties[paramName] = { type: typeMap[baseType] ?? "object", description: paramDef.description, enum: paramDef.enum };
      }
      if (paramDef.required) required.push(paramName);
    }

    const returnBase = action.returns.replace("list:", "").replace("?", "");
    const typeDef = manifest.types[returnBase];
    let fieldsDesc = `Optional TQP field selector. Only request fields you need. Returns: ${action.returns}.`;
    if (typeDef) {
      const fieldList = Object.entries(typeDef.fields).map(([fn, fd]) => {
        let s = `${fn}: ${fd.type}`;
        if (fd.cost === "high") s += " (EXPENSIVE)";
        if (fd.description) s += ` — ${fd.description}`;
        return s;
      });
      fieldsDesc += ` Fields: ${fieldList.join(", ")}. Use {"field": true}.`;
    }
    properties["_fields"] = { type: "object", description: fieldsDesc };

    return {
      name,
      description: action.description,
      input_schema: { type: "object" as const, properties, required: required.length > 0 ? required : undefined },
    };
  });

  let totalIn = 0, totalOut = 0, toolCallCount = 0, toolResultChars = 0;
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: task }];

  while (true) {
    const response = await anthropic.messages.create({
      model: MODEL, max_tokens: 4096,
      system: "You have access to a CRM system via TQP tools. IMPORTANT: Always use the _fields parameter to request ONLY the fields you need. Fields marked EXPENSIVE trigger slow backend operations (DB joins, ML inference) — never request them unless the user specifically needs that data. For example, if you only need company names, use _fields: {name: true}.",
      tools: claudeTools, messages,
    });
    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const text = response.content.find((b) => b.type === "text");
      return {
        response: text ? (text as any).text : "",
        input_tokens: totalIn, output_tokens: totalOut, total_tokens: totalIn + totalOut,
        tool_calls: toolCallCount, tool_result_chars: toolResultChars,
        wall_ms: performance.now() - t0, backend_stats: readStats(),
      };
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCallCount++;
        const input = { ...(block.input as Record<string, unknown>) };
        const fields = input._fields;
        delete input._fields;
        for (const key of Object.keys(input)) { if (input[key] === undefined) delete input[key]; }

        const res = await tqp.call(block.name, { input, fields: fields as any });
        const resultText = JSON.stringify(res.data, null, 2);
        toolResultChars += resultText.length;
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }
}

// ── Scenarios ──────────────────────────────────────────────

const SCENARIOS = [
  {
    name: "Company names only",
    task: "List all company names in the CRM. Just the names, nothing else.",
  },
  {
    name: "Company + CEO lookup",
    task: "For each company in the CRM, tell me the company name and who the CEO (or top executive) is. Format: 'Company — CEO Name'.",
  },
  {
    name: "Pipeline value by stage",
    task: "What's the total deal value at each pipeline stage across all companies? Show stage name and total USD value.",
  },
  {
    name: "Health check (top 3)",
    task: "What are the health scores for the top 3 largest companies (by employee count)? Show company name, overall health score, and churn risk.",
  },
  {
    name: "Revenue forecast",
    task: "What's the predicted ARR in 12 months for Acme Corp and Umbrella Ltd? Just the company name and predicted ARR number.",
  },
  {
    name: "Full company dossier",
    task: "Give me a complete dossier on Cyberdyne Systems: company info, all contacts, all deals, recent activity, health score, and revenue forecast.",
  },
  {
    name: "At-risk companies",
    task: "Which companies have a churn risk above 30%? List company name and churn risk percentage.",
  },
  {
    name: "Contact search",
    task: "Find all CEOs across all companies. List their name, company, and email.",
  },
];

function pad(s: string, n: number): string { return s.padEnd(n); }

async function main() {
  console.log("TQP vs MCP Benchmark — Synthetic CRM API");
  console.log("Model:", MODEL);
  console.log("This API has EXPENSIVE fields: DB joins (150ms), ML inference (300ms)");
  console.log("TQP lazy resolvers skip expensive work when fields aren't requested.");
  console.log("=".repeat(120));

  try { await fetch(`${TQP_URL}/tqp/health`); } catch {
    console.error("CRM TQP server not running. Start with: TQP_PORT=3020 bun run bench/crm-tqp.ts");
    process.exit(1);
  }

  const results: { name: string; mcp: AgentResult; tqp: AgentResult }[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n${"─".repeat(120)}`);
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Task: "${scenario.task}"`);

    process.stdout.write("\n  MCP agent...");
    const mcpResult = await runMCPAgent(scenario.task);
    console.log(` done (${(mcpResult.wall_ms / 1000).toFixed(1)}s)`);

    process.stdout.write("  TQP agent...");
    const tqpResult = await runTQPAgent(scenario.task);
    console.log(` done (${(tqpResult.wall_ms / 1000).toFixed(1)}s)`);

    results.push({ name: scenario.name, mcp: mcpResult, tqp: tqpResult });

    const tokenSav = ((1 - tqpResult.total_tokens / mcpResult.total_tokens) * 100).toFixed(1);
    const apiSav = mcpResult.backend_stats.api_calls > 0
      ? ((1 - tqpResult.backend_stats.api_calls / mcpResult.backend_stats.api_calls) * 100).toFixed(1) : "0.0";
    const timeSav = mcpResult.wall_ms > 0
      ? ((1 - tqpResult.wall_ms / mcpResult.wall_ms) * 100).toFixed(1) : "0.0";

    console.log(`\n  ${"Metric".padEnd(22)} ${"MCP".padEnd(14)} ${"TQP".padEnd(14)} ${"Savings"}`);
    console.log(`  ${"─".repeat(60)}`);
    console.log(`  ${"Tokens".padEnd(22)} ${String(mcpResult.total_tokens).padEnd(14)} ${String(tqpResult.total_tokens).padEnd(14)} ${tokenSav}%`);
    console.log(`  ${"Backend operations".padEnd(22)} ${String(mcpResult.backend_stats.api_calls).padEnd(14)} ${String(tqpResult.backend_stats.api_calls).padEnd(14)} ${apiSav}%`);
    console.log(`  ${"Resolver runs (TQP)".padEnd(22)} ${"n/a".padEnd(14)} ${String(tqpResult.backend_stats.resolver_runs).padEnd(14)}`);
    console.log(`  ${"Tool result chars".padEnd(22)} ${mcpResult.tool_result_chars.toLocaleString().padEnd(14)} ${tqpResult.tool_result_chars.toLocaleString().padEnd(14)}`);
    console.log(`  ${"Wall time".padEnd(22)} ${((mcpResult.wall_ms / 1000).toFixed(1) + "s").padEnd(14)} ${((tqpResult.wall_ms / 1000).toFixed(1) + "s").padEnd(14)} ${timeSav}%`);
    console.log(`  ${"Tool calls".padEnd(22)} ${String(mcpResult.tool_calls).padEnd(14)} ${String(tqpResult.tool_calls).padEnd(14)}`);
  }

  // Summary
  console.log(`\n${"═".repeat(120)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(120)}\n`);

  console.log(
    pad("Scenario", 25) + pad("│ Proto", 8) + pad("Tokens", 9) + pad("Backend", 9) +
    pad("Resolvers", 11) + pad("Chars", 10) + pad("Time(s)", 9) +
    pad("│ Tok%", 8) + pad("API%", 8) + pad("Time%", 8)
  );
  console.log("─".repeat(105));

  let gMcpTok = 0, gTqpTok = 0, gMcpApi = 0, gTqpApi = 0;
  let gMcpChr = 0, gTqpChr = 0, gMcpMs = 0, gTqpMs = 0;
  let gTqpRes = 0;

  for (const r of results) {
    gMcpTok += r.mcp.total_tokens; gTqpTok += r.tqp.total_tokens;
    gMcpApi += r.mcp.backend_stats.api_calls; gTqpApi += r.tqp.backend_stats.api_calls;
    gMcpChr += r.mcp.tool_result_chars; gTqpChr += r.tqp.tool_result_chars;
    gMcpMs += r.mcp.wall_ms; gTqpMs += r.tqp.wall_ms;
    gTqpRes += r.tqp.backend_stats.resolver_runs;

    const tSav = ((1 - r.tqp.total_tokens / r.mcp.total_tokens) * 100).toFixed(1);
    const aSav = r.mcp.backend_stats.api_calls > 0
      ? ((1 - r.tqp.backend_stats.api_calls / r.mcp.backend_stats.api_calls) * 100).toFixed(1) : "=";
    const wSav = ((1 - r.tqp.wall_ms / r.mcp.wall_ms) * 100).toFixed(1);

    console.log(
      pad(r.name, 25) + pad("│ MCP", 8) + pad(String(r.mcp.total_tokens), 9) +
      pad(String(r.mcp.backend_stats.api_calls), 9) + pad("n/a", 11) +
      pad(r.mcp.tool_result_chars.toLocaleString(), 10) +
      pad((r.mcp.wall_ms / 1000).toFixed(1), 9) + "│"
    );
    console.log(
      pad("", 25) + pad("│ TQP", 8) + pad(String(r.tqp.total_tokens), 9) +
      pad(String(r.tqp.backend_stats.api_calls), 9) +
      pad(String(r.tqp.backend_stats.resolver_runs), 11) +
      pad(r.tqp.tool_result_chars.toLocaleString(), 10) +
      pad((r.tqp.wall_ms / 1000).toFixed(1), 9) +
      pad("│ " + tSav + "%", 8) + pad(aSav + "%", 8) + pad(wSav + "%", 8)
    );
    console.log("");
  }

  console.log("─".repeat(105));
  const tTokSav = ((1 - gTqpTok / gMcpTok) * 100).toFixed(1);
  const tApiSav = gMcpApi > 0 ? ((1 - gTqpApi / gMcpApi) * 100).toFixed(1) : "0.0";
  const tChrSav = gMcpChr > 0 ? ((1 - gTqpChr / gMcpChr) * 100).toFixed(1) : "0.0";
  const tTimSav = gMcpMs > 0 ? ((1 - gTqpMs / gMcpMs) * 100).toFixed(1) : "0.0";

  console.log(
    pad("TOTAL", 25) + pad("│ MCP", 8) + pad(String(gMcpTok), 9) +
    pad(String(gMcpApi), 9) + pad("", 11) +
    pad(gMcpChr.toLocaleString(), 10) + pad((gMcpMs / 1000).toFixed(1), 9) + "│"
  );
  console.log(
    pad("", 25) + pad("│ TQP", 8) + pad(String(gTqpTok), 9) +
    pad(String(gTqpApi), 9) + pad(String(gTqpRes), 11) +
    pad(gTqpChr.toLocaleString(), 10) + pad((gTqpMs / 1000).toFixed(1), 9) +
    pad("│ " + tTokSav + "%", 8) + pad(tApiSav + "%", 8) + pad(tTimSav + "%", 8)
  );

  console.log(`\n${"═".repeat(120)}`);
  console.log("KEY FINDINGS:");
  console.log(`  Tokens:            ${tTokSav}% fewer (${gMcpTok.toLocaleString()} → ${gTqpTok.toLocaleString()})`);
  console.log(`  Backend operations: ${tApiSav}% fewer (${gMcpApi} → ${gTqpApi})`);
  console.log(`  TQP resolver runs: ${gTqpRes} (only fired when expensive fields were actually needed)`);
  console.log(`  Data to agent:     ${tChrSav}% smaller (${gMcpChr.toLocaleString()} → ${gTqpChr.toLocaleString()} chars)`);
  console.log(`  Wall time:         ${tTimSav}% faster (${(gMcpMs / 1000).toFixed(1)}s → ${(gTqpMs / 1000).toFixed(1)}s)`);
}

main().catch(console.error);
