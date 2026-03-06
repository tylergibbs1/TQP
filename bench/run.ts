#!/usr/bin/env bun
// TQP vs MCP Benchmark — Anthropic SDK
//
// Measures beyond just tokens:
//   - Token usage (from Claude API response.usage)
//   - Backend API calls (actual HN API hits)
//   - Resolver skips (TQP lazy resolvers that didn't fire)
//   - Wall clock time per scenario
//   - Tool result data size

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

const TQP_URL = "http://127.0.0.1:3010";

interface TurnLog {
  turn: number;
  input_tokens: number;
  output_tokens: number;
  tool_calls: string[];
  tool_result_chars: number;
}

interface AgentResult {
  response: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tool_calls: number;
  tool_result_chars: number;
  turns: TurnLog[];
  wall_ms: number;
  backend_stats: BenchStats;
}

// ============================================================
// MCP AGENT
// ============================================================

async function runMCPAgent(task: string): Promise<AgentResult> {
  resetStats();
  const t0 = performance.now();

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "bench/hn-mcp.ts"],
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

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;
  let toolResultChars = 0;
  const turns: TurnLog[] = [];

  let messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task },
  ];

  let turnNum = 0;

  while (true) {
    turnNum++;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: claudeTools,
      messages,
    });

    const usage = response.usage;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;

    const turnLog: TurnLog = {
      turn: turnNum,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      tool_calls: [],
      tool_result_chars: 0,
    };

    if (response.stop_reason === "end_turn") {
      turns.push(turnLog);
      const textBlock = response.content.find((b) => b.type === "text");
      await mcpClient.close();
      return {
        response: textBlock ? (textBlock as Anthropic.Messages.TextBlock).text : "",
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        tool_calls: toolCallCount,
        tool_result_chars: toolResultChars,
        turns,
        wall_ms: performance.now() - t0,
        backend_stats: readStats(),
      };
    }

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        toolCallCount++;
        turnLog.tool_calls.push(block.name);

        const result = await mcpClient.callTool({
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });

        const resultText = result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");

        turnLog.tool_result_chars += resultText.length;
        toolResultChars += resultText.length;

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
      }
    }

    turns.push(turnLog);
    messages.push({ role: "user", content: toolResults });
  }
}

// ============================================================
// TQP AGENT
// ============================================================

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
        properties[paramName] = {
          type: typeMap[baseType] ?? "object",
          description: paramDef.description,
          enum: paramDef.enum,
        };
      }
      if (paramDef.required) required.push(paramName);
    }

    const returnBase = action.returns.replace("list:", "").replace("?", "");
    const typeDef = manifest.types[returnBase];
    let fieldsDesc = `Optional TQP field selector. Only request the fields you need to save tokens. Returns type: ${action.returns}.`;
    if (typeDef) {
      const fieldList = Object.entries(typeDef.fields).map(([fn, fd]) => {
        let s = `${fn}: ${fd.type}`;
        if (fd.cost === "high") s += " (EXPENSIVE - only request if needed)";
        if (fd.description) s += ` — ${fd.description}`;
        return s;
      });
      fieldsDesc += ` Available fields: ${fieldList.join(", ")}. Use {"fieldName": true} for scalars, {"nested": {"subField": true}} for objects.`;
    }

    properties["_fields"] = { type: "object", description: fieldsDesc };

    return {
      name,
      description: action.description + (action.safe ? "" : " (has side effects)"),
      input_schema: {
        type: "object" as const,
        properties,
        required: required.length > 0 ? required : undefined,
      },
    };
  });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;
  let toolResultChars = 0;
  const turns: TurnLog[] = [];

  let messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task },
  ];

  let turnNum = 0;

  while (true) {
    turnNum++;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: "You have access to Hacker News data via TQP tools. IMPORTANT: Always use the _fields parameter to request ONLY the fields you need. This dramatically reduces response size. For example, if you only need titles, use _fields: {title: true}. Never omit _fields unless you truly need every field.",
      tools: claudeTools,
      messages,
    });

    const usage = response.usage;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;

    const turnLog: TurnLog = {
      turn: turnNum,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      tool_calls: [],
      tool_result_chars: 0,
    };

    if (response.stop_reason === "end_turn") {
      turns.push(turnLog);
      const textBlock = response.content.find((b) => b.type === "text");
      return {
        response: textBlock ? (textBlock as Anthropic.Messages.TextBlock).text : "",
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        tool_calls: toolCallCount,
        tool_result_chars: toolResultChars,
        turns,
        wall_ms: performance.now() - t0,
        backend_stats: readStats(),
      };
    }

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        toolCallCount++;
        turnLog.tool_calls.push(block.name);

        const input = { ...(block.input as Record<string, unknown>) };
        const fields = input._fields;
        delete input._fields;

        const res = await tqp.call(block.name, { input, fields: fields as any });
        const resultText = JSON.stringify(res.data, null, 2);

        turnLog.tool_result_chars += resultText.length;
        toolResultChars += resultText.length;

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
      }
    }

    turns.push(turnLog);
    messages.push({ role: "user", content: toolResults });
  }
}

// ============================================================
// SCENARIOS & RUNNER
// ============================================================

const SCENARIOS = [
  {
    name: "Top 5 titles",
    task: "List the titles and scores of the top 5 stories on Hacker News right now. Just the titles and scores, nothing else.",
  },
  {
    name: "Story + author karma",
    task: "What is the #1 story on Hacker News right now? Tell me the title, who posted it, and what their karma is.",
  },
  {
    name: "Comment summary",
    task: "Get the top 5 comments on the #1 Hacker News story. Summarize what people are saying in 2-3 sentences.",
  },
  {
    name: "Top 20 titles only",
    task: "List just the titles of the top 20 Hacker News stories. Only titles, nothing else — no scores, URLs, authors, or other metadata.",
  },
  {
    name: "Top 10 + authors karma",
    task: "For each of the top 10 Hacker News stories, tell me the title and the author's karma. Format as a numbered list: 'Title — Author (karma: N)'.",
  },
  {
    name: "Deep comment thread",
    task: "Get the top 10 comments (with up to 3 levels of replies) on the #1 Hacker News story. For each comment, show the author and a one-line summary of what they said. Include replies indented under their parent.",
  },
  {
    name: "Multi-story comments",
    task: "For the top 3 Hacker News stories, get the top 3 comments on each. Tell me the story title, then list the comment authors and a brief summary of each comment.",
  },
  {
    name: "Author deep dive",
    task: "Who posted the top 3 stories on Hacker News? For each author, tell me their username, karma, and when they joined (created date). Nothing else.",
  },
];

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

async function main() {
  console.log("TQP vs MCP Benchmark");
  console.log("Model:", MODEL);
  console.log("Metrics: tokens, backend API calls, resolver skips, wall time, data size");
  console.log("=".repeat(120));

  try {
    await fetch(`${TQP_URL}/tqp/health`);
  } catch {
    console.error("TQP server not running. Start with: bun run bench/hn-tqp.ts");
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

    // Per-scenario detail
    const tokenSav = ((1 - tqpResult.total_tokens / mcpResult.total_tokens) * 100).toFixed(1);
    const apiSav = mcpResult.backend_stats.api_calls > 0
      ? ((1 - tqpResult.backend_stats.api_calls / mcpResult.backend_stats.api_calls) * 100).toFixed(1)
      : "0.0";
    const timeSav = mcpResult.wall_ms > 0
      ? ((1 - tqpResult.wall_ms / mcpResult.wall_ms) * 100).toFixed(1)
      : "0.0";

    console.log(`\n  ${"Metric".padEnd(22)} ${"MCP".padEnd(12)} ${"TQP".padEnd(12)} ${"Savings".padEnd(10)}`);
    console.log(`  ${"─".repeat(56)}`);
    console.log(`  ${"Tokens".padEnd(22)} ${String(mcpResult.total_tokens).padEnd(12)} ${String(tqpResult.total_tokens).padEnd(12)} ${tokenSav}%`);
    console.log(`  ${"Backend API calls".padEnd(22)} ${String(mcpResult.backend_stats.api_calls).padEnd(12)} ${String(tqpResult.backend_stats.api_calls).padEnd(12)} ${apiSav}%`);
    console.log(`  ${"Resolver runs".padEnd(22)} ${"n/a".padEnd(12)} ${String(tqpResult.backend_stats.resolver_runs).padEnd(12)}`);
    console.log(`  ${"Tool result chars".padEnd(22)} ${mcpResult.tool_result_chars.toLocaleString().padEnd(12)} ${tqpResult.tool_result_chars.toLocaleString().padEnd(12)}`);
    console.log(`  ${"Wall time".padEnd(22)} ${(mcpResult.wall_ms / 1000).toFixed(1).padEnd(12)}s ${(tqpResult.wall_ms / 1000).toFixed(1).padEnd(11)}s ${timeSav}%`);
    console.log(`  ${"Tool calls".padEnd(22)} ${String(mcpResult.tool_calls).padEnd(12)} ${String(tqpResult.tool_calls).padEnd(12)}`);
  }

  // Summary table
  console.log(`\n${"═".repeat(120)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(120)}\n`);

  console.log(
    pad("Scenario", 23) +
    pad("│ Proto", 8) +
    pad("Tokens", 9) +
    pad("API calls", 11) +
    pad("Resolvers", 11) +
    pad("Result chars", 14) +
    pad("Wall (s)", 10) +
    pad("│ Token sav", 12) +
    pad("API sav", 9)
  );
  console.log("─".repeat(107));

  let grandMcpTokens = 0, grandTqpTokens = 0;
  let grandMcpCalls = 0, grandTqpCalls = 0;
  let grandMcpChars = 0, grandTqpChars = 0;
  let grandMcpTime = 0, grandTqpTime = 0;

  for (const r of results) {
    grandMcpTokens += r.mcp.total_tokens;
    grandTqpTokens += r.tqp.total_tokens;
    grandMcpCalls += r.mcp.backend_stats.api_calls;
    grandTqpCalls += r.tqp.backend_stats.api_calls;
    grandMcpChars += r.mcp.tool_result_chars;
    grandTqpChars += r.tqp.tool_result_chars;
    grandMcpTime += r.mcp.wall_ms;
    grandTqpTime += r.tqp.wall_ms;

    const tokenSav = ((1 - r.tqp.total_tokens / r.mcp.total_tokens) * 100).toFixed(1);
    const apiSav = r.mcp.backend_stats.api_calls > 0
      ? ((1 - r.tqp.backend_stats.api_calls / r.mcp.backend_stats.api_calls) * 100).toFixed(1)
      : "0.0";

    console.log(
      pad(r.name, 23) +
      pad("│ MCP", 8) +
      pad(String(r.mcp.total_tokens), 9) +
      pad(String(r.mcp.backend_stats.api_calls), 11) +
      pad("n/a", 11) +
      pad(r.mcp.tool_result_chars.toLocaleString(), 14) +
      pad((r.mcp.wall_ms / 1000).toFixed(1), 10) +
      "│"
    );
    console.log(
      pad("", 23) +
      pad("│ TQP", 8) +
      pad(String(r.tqp.total_tokens), 9) +
      pad(String(r.tqp.backend_stats.api_calls), 11) +
      pad(String(r.tqp.backend_stats.resolver_runs), 11) +
      pad(r.tqp.tool_result_chars.toLocaleString(), 14) +
      pad((r.tqp.wall_ms / 1000).toFixed(1), 10) +
      pad("│ " + tokenSav + "%", 12) +
      pad(apiSav + "%", 9)
    );
    console.log("");
  }

  console.log("─".repeat(107));

  const totalTokenSav = ((1 - grandTqpTokens / grandMcpTokens) * 100).toFixed(1);
  const totalApiSav = grandMcpCalls > 0 ? ((1 - grandTqpCalls / grandMcpCalls) * 100).toFixed(1) : "0.0";
  const totalCharSav = grandMcpChars > 0 ? ((1 - grandTqpChars / grandMcpChars) * 100).toFixed(1) : "0.0";
  const totalTimeSav = grandMcpTime > 0 ? ((1 - grandTqpTime / grandMcpTime) * 100).toFixed(1) : "0.0";

  console.log(
    pad("TOTAL", 23) +
    pad("│ MCP", 8) +
    pad(String(grandMcpTokens), 9) +
    pad(String(grandMcpCalls), 11) +
    pad("", 11) +
    pad(grandMcpChars.toLocaleString(), 14) +
    pad((grandMcpTime / 1000).toFixed(1), 10) +
    "│"
  );
  console.log(
    pad("", 23) +
    pad("│ TQP", 8) +
    pad(String(grandTqpTokens), 9) +
    pad(String(grandTqpCalls), 11) +
    pad("", 11) +
    pad(grandTqpChars.toLocaleString(), 14) +
    pad((grandTqpTime / 1000).toFixed(1), 10) +
    pad("│ " + totalTokenSav + "%", 12) +
    pad(totalApiSav + "%", 9)
  );

  console.log(`\n${"═".repeat(120)}`);
  console.log("KEY FINDINGS:");
  console.log(`  Tokens:         ${totalTokenSav}% fewer (${grandMcpTokens.toLocaleString()} → ${grandTqpTokens.toLocaleString()})`);
  console.log(`  Backend calls:  ${totalApiSav}% fewer (${grandMcpCalls} → ${grandTqpCalls})`);
  console.log(`  Data to agent:  ${totalCharSav}% smaller (${grandMcpChars.toLocaleString()} → ${grandTqpChars.toLocaleString()} chars)`);
  console.log(`  Wall time:      ${totalTimeSav}% faster (${(grandMcpTime / 1000).toFixed(1)}s → ${(grandTqpTime / 1000).toFixed(1)}s)`);
  console.log(`\nTQP advantages beyond tokens:`);
  console.log(`  - Lazy resolvers: expensive fields (comments, submitted, about) only fetched when requested`);
  console.log(`  - Cost hints: agents see cost:"high" annotations and avoid expensive fields proactively`);
  console.log(`  - Typed data model: agents reason about field structure before calling tools`);
  console.log(`  - Safety built-in: safe/confirm/dry_run are protocol-level, not per-tool`);
}

main().catch(console.error);
