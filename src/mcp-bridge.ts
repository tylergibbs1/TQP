// TQP → MCP Compatibility Bridge
//
// Exposes a TQP server as MCP-compatible tools over stdio.
// Each TQP action becomes an MCP tool. Field selection happens
// transparently via an optional `_fields` parameter injected
// into every tool's input schema.

import type { TQP } from "./server";
import type { ActionDefinition, FieldDefinition, Manifest } from "./types";

interface MCPMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class MCPBridge {
  private server: TQP;
  private manifest: Manifest;

  constructor(server: TQP) {
    this.server = server;
    this.manifest = server.getManifest();
  }

  async handleMessage(msg: MCPMessage): Promise<MCPMessage> {
    const id = msg.id;

    switch (msg.method) {
      case "initialize":
        return this.respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: this.manifest.name,
            version: this.manifest.tqp,
          },
        });

      case "notifications/initialized":
        // No response needed for notifications
        return this.respond(id, null);

      case "tools/list":
        return this.respond(id, { tools: this.buildToolList() });

      case "tools/call":
        return this.handleToolCall(id, msg.params as { name: string; arguments?: Record<string, unknown> });

      case "ping":
        return this.respond(id, {});

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        };
    }
  }

  private buildToolList(): MCPTool[] {
    const tools: MCPTool[] = [];

    for (const [name, action] of Object.entries(this.manifest.actions)) {
      const properties: Record<string, MCPProperty> = {};
      const required: string[] = [];

      for (const [paramName, paramDef] of Object.entries(action.input)) {
        properties[paramName] = fieldDefToJsonSchema(paramDef);
        if (paramDef.required) required.push(paramName);
      }

      // Inject _fields parameter for TQP field selection
      properties["_fields"] = {
        type: "object",
        description:
          "TQP field selector. Specify which fields to return as a nested JSON object. " +
          `Returns type: ${action.returns}. ` +
          this.describeReturnType(action.returns),
      };

      let description = action.description;
      if (action.destructive) description = `[DESTRUCTIVE] ${description}`;
      if (action.confirm) description = `[REQUIRES CONFIRMATION] ${description}`;
      if (!action.safe) description += " (has side effects)";

      tools.push({
        name,
        description,
        inputSchema: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      });
    }

    return tools;
  }

  private describeReturnType(typeName: string): string {
    const baseName = typeName.replace("list:", "").replace("?", "");
    const typeDef = this.manifest.types[baseName];
    if (!typeDef) return "";

    const fields = Object.entries(typeDef.fields).map(([name, def]) => {
      let desc = `${name}: ${def.type}`;
      if (def.cost === "high") desc += " (expensive)";
      if (def.description) desc += ` — ${def.description}`;
      return desc;
    });

    return `Available fields: ${fields.join(", ")}`;
  }

  private async handleToolCall(
    id: string | number | undefined,
    params: { name: string; arguments?: Record<string, unknown> }
  ): Promise<MCPMessage> {
    const { name, arguments: args } = params;
    const input = { ...(args ?? {}) };

    // Extract _fields from the MCP arguments
    const fields = input._fields as Record<string, unknown> | undefined;
    delete input._fields;

    // Build TQP request
    const tqpRequest: Record<string, unknown> = {
      action: name,
      input,
    };

    if (fields) {
      tqpRequest.fields = fields;
    }

    // Handle confirmation - MCP doesn't have this concept natively,
    // so we auto-confirm (the agent framework handles confirmation)
    tqpRequest.confirmed = true;

    const response = await this.server.handle(tqpRequest);

    if (response.error) {
      return this.respond(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.error, null, 2),
          },
        ],
        isError: true,
      });
    }

    return this.respond(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    });
  }

  private respond(id: string | number | undefined, result: unknown): MCPMessage {
    return { jsonrpc: "2.0", id, result } as MCPMessage;
  }

  async listenStdio(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = Bun.stdin.stream().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        try {
          const msg = JSON.parse(line) as MCPMessage;
          const response = await this.handleMessage(msg);
          if (response.id !== undefined) {
            process.stdout.write(JSON.stringify(response) + "\n");
          }
        } catch {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32700, message: "Parse error" },
            }) + "\n"
          );
        }
      }
    }
  }
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, MCPProperty>;
    required?: string[];
  };
}

interface MCPProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: MCPProperty;
  default?: unknown;
}

function fieldDefToJsonSchema(def: FieldDefinition): MCPProperty {
  const baseType = def.type.replace("?", "");

  if (baseType.startsWith("list:")) {
    return {
      type: "array",
      description: def.description,
      items: fieldDefToJsonSchema({ ...def, type: baseType.slice(5) }),
    };
  }

  const typeMap: Record<string, string> = {
    string: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
  };

  return {
    type: typeMap[baseType] ?? "object",
    description: def.description,
    enum: def.enum,
    default: def.default,
  };
}
