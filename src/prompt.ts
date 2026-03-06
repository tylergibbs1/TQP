// TQP Agent Prompt Template Generator
// Produces a system prompt section that teaches an agent how to use a TQP server.

import type { Manifest } from "./types";

export function generateAgentPrompt(manifest: Manifest): string {
  const lines: string[] = [];

  lines.push(`# ${manifest.name} — TQP Data Source`);
  lines.push("");
  lines.push(manifest.description);
  lines.push("");

  // Available types
  lines.push("## Data Model");
  lines.push("");
  for (const [name, typeDef] of Object.entries(manifest.types)) {
    lines.push(`### ${name}`);
    if (typeDef.description) lines.push(typeDef.description);
    lines.push("");
    lines.push("| Field | Type | Cost | Description |");
    lines.push("|-------|------|------|-------------|");
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
      const cost = fieldDef.cost ?? "low";
      const desc = fieldDef.description ?? "";
      lines.push(`| ${fieldName} | ${fieldDef.type} | ${cost} | ${desc} |`);
    }
    lines.push("");
  }

  // Available actions
  lines.push("## Actions");
  lines.push("");
  for (const [name, action] of Object.entries(manifest.actions)) {
    const flags: string[] = [];
    if (action.safe) flags.push("read-only");
    if (action.destructive) flags.push("DESTRUCTIVE");
    if (action.confirm) flags.push("requires confirmation");
    if (action.dry_run) flags.push("supports dry-run");
    if (action.idempotent) flags.push("idempotent");

    lines.push(`### ${name}${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}`);
    lines.push(action.description);
    if (action.rate_limit) lines.push(`Rate limit: ${action.rate_limit}`);
    lines.push("");

    // Input
    lines.push("**Input:**");
    for (const [paramName, paramDef] of Object.entries(action.input)) {
      const req = paramDef.required ? "(required)" : `(optional, default: ${paramDef.default ?? "null"})`;
      const enumStr = paramDef.enum ? ` — one of: ${paramDef.enum.join(", ")}` : "";
      lines.push(`- \`${paramName}\`: ${paramDef.type} ${req}${enumStr}`);
    }
    lines.push("");

    lines.push(`**Returns:** ${action.returns}`);
    lines.push("");
  }

  // Usage instructions
  lines.push("## How to Query");
  lines.push("");
  lines.push("Use the `fields` parameter to request only the data you need.");
  lines.push("This reduces tokens and speeds up responses.");
  lines.push("");
  lines.push("```json");
  lines.push('{');
  lines.push('  "action": "<action_name>",');
  lines.push('  "input": { ... },');
  lines.push('  "fields": {');
  lines.push('    "field_name": true,');
  lines.push('    "nested_object": { "sub_field": true }');
  lines.push("  }");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("**Tips:**");
  lines.push("- Avoid fields marked `cost: high` unless you specifically need them.");
  lines.push("- Use `true` for scalar fields, nested objects for relationships.");
  lines.push("- Omit `fields` entirely to get everything (not recommended for large types).");
  lines.push("- Actions marked `destructive` or `confirm` require `\"confirmed\": true`.");
  lines.push("- Use `\"dry_run\": true` on supported actions to preview effects.");

  return lines.join("\n");
}
