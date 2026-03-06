// TQP Server

import type {
  ActionConfig,
  ActionDefinition,
  FieldDefinition,
  FieldSelector,
  ListenOptions,
  Manifest,
  ServerOptions,
  TQPError,
  TQPRequest,
  TQPResponse,
  TypeDefinition,
} from "./types";
import { validateRequest, validateInput, validateFields, applyDefaults } from "./validate";
import { filterFields } from "./filter";
import { estimateTokens } from "./tokens";

export class TQP {
  private manifest: Manifest;
  private handlers: Map<string, ActionConfig> = new Map();
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(options: ServerOptions) {
    this.manifest = {
      tqp: options.version ?? "0.1.0",
      name: options.name,
      description: options.description,
      types: {},
      actions: {},
    };
  }

  type(name: string, fields: Record<string, FieldDefinition>, description?: string): this {
    this.manifest.types[name] = { description, fields };
    return this;
  }

  action(name: string, config: ActionConfig): this {
    const { handler, resolve, ...def } = config;
    this.manifest.actions[name] = def as ActionDefinition;
    this.handlers.set(name, config);
    return this;
  }

  getManifest(): Manifest {
    return this.manifest;
  }

  async handle(raw: unknown): Promise<TQPResponse> {
    // Parse and validate request envelope
    const parsed = validateRequest(raw);
    if ("code" in parsed) {
      return { error: parsed };
    }

    const request = parsed as TQPRequest;
    const response: TQPResponse = { id: request.id };

    try {
      const result = await this.execute(request);
      if ("code" in (result as object)) {
        response.error = result as TQPError;
      } else {
        response.data = (result as { data: unknown }).data;
        response.meta = (result as { meta?: TQPResponse["meta"] }).meta;
      }
    } catch (err) {
      response.error = {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Internal server error",
      };
    }

    return response;
  }

  private async execute(request: TQPRequest): Promise<TQPError | { data: unknown; meta?: TQPResponse["meta"] }> {
    // Built-in actions
    if (request.action === "tqp.manifest") {
      return { data: this.manifest };
    }

    if (request.action === "tqp.describe") {
      const typeName = (request.input?.type as string) ?? "";
      const typeDef = this.manifest.types[typeName];
      if (!typeDef) {
        return { code: "INVALID_INPUT", message: `Type '${typeName}' not found` };
      }
      return { data: { name: typeName, ...typeDef } };
    }

    if (request.action === "tqp.health") {
      return { data: { status: "ok", version: this.manifest.tqp } };
    }

    // Look up action
    const actionDef = this.manifest.actions[request.action];
    const actionConfig = this.handlers.get(request.action);
    if (!actionDef || !actionConfig) {
      return { code: "INVALID_ACTION", message: `Action '${request.action}' not found` };
    }

    // Validate input
    const inputError = validateInput(request.input, actionDef.input);
    if (inputError) return inputError;

    // Apply defaults
    const input = applyDefaults(request.input, actionDef.input);

    // Check confirmation requirement
    if (actionDef.confirm && !request.confirmed) {
      return {
        code: "REQUIRES_CONFIRMATION",
        message: `Action '${request.action}' requires confirmation. Resend with "confirmed": true`,
      };
    }

    // Check dry_run support
    if (request.dry_run && !actionDef.dry_run) {
      return {
        code: "DRY_RUN_NOT_SUPPORTED",
        message: `Action '${request.action}' does not support dry-run mode`,
      };
    }

    // Validate fields selector
    if (request.fields) {
      const fieldsError = validateFields(request.fields, actionDef.returns, this.manifest);
      if (fieldsError) return fieldsError;
    }

    // Execute handler
    let data = await actionConfig.handler(input, {
      dry_run: request.dry_run ?? false,
      fields: request.fields,
    });

    // Run lazy resolvers for requested fields
    if (actionConfig.resolve && request.fields) {
      data = await this.runResolvers(data, request.fields, actionConfig.resolve, input);
    }

    // Apply field filtering
    const filtered = filterFields(data, request.fields, actionDef.returns, this.manifest);

    return {
      data: filtered,
      meta: {
        dry_run: request.dry_run ?? false,
        cost_tokens_estimate: estimateTokens(filtered),
      },
    };
  }

  private async runResolvers(
    data: unknown,
    fields: FieldSelector,
    resolvers: Record<string, (input: Record<string, unknown>) => Promise<unknown> | unknown>,
    input: Record<string, unknown>
  ): Promise<unknown> {
    if (data === null || data === undefined || typeof data !== "object") return data;

    // For arrays, apply resolvers to each item
    if (Array.isArray(data)) {
      return Promise.all(
        data.map((item) => this.runResolvers(item, fields, resolvers, input))
      );
    }

    const obj = { ...(data as Record<string, unknown>) };

    for (const [fieldName, selector] of Object.entries(fields)) {
      if (fieldName in resolvers && (selector === true || typeof selector === "object")) {
        obj[fieldName] = await resolvers[fieldName](input);
      }
    }

    return obj;
  }

  listen(options: ListenOptions): void {
    if (options.transport === "http") {
      this.listenHTTP(options);
    } else if (options.transport === "stdio") {
      this.listenStdio();
    }
  }

  private listenHTTP(options: ListenOptions) {
    const port = options.port ?? 3000;
    const hostname = options.hostname ?? "0.0.0.0";

    this.server = Bun.serve({
      port,
      hostname,
      fetch: async (req) => {
        const url = new URL(req.url);

        // GET endpoints
        if (req.method === "GET") {
          if (url.pathname === "/tqp/manifest") {
            return Response.json(await this.handle({ action: "tqp.manifest" }));
          }
          if (url.pathname === "/tqp/health") {
            return Response.json(await this.handle({ action: "tqp.health" }));
          }
          return new Response("Not Found", { status: 404 });
        }

        // POST /tqp
        if (req.method === "POST" && url.pathname === "/tqp") {
          try {
            const body = await req.json();
            const response = await this.handle(body);
            const status = response.error ? (response.error.code === "INTERNAL" ? 500 : 400) : 200;
            return Response.json(response, { status });
          } catch {
            return Response.json(
              { error: { code: "INVALID_INPUT", message: "Invalid JSON body" } },
              { status: 400 }
            );
          }
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    console.log(`TQP server "${this.manifest.name}" listening on http://${hostname}:${port}`);
  }

  private listenStdio() {
    const decoder = new TextDecoder();
    let buffer = "";

    const reader = Bun.stdin.stream().getReader();

    const read = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          try {
            const request = JSON.parse(line);
            const response = await this.handle(request);
            process.stdout.write(JSON.stringify(response) + "\n");
          } catch {
            process.stdout.write(
              JSON.stringify({ error: { code: "INVALID_INPUT", message: "Invalid JSON" } }) + "\n"
            );
          }
        }
      }
    };

    read();
  }

  stop() {
    this.server?.stop();
  }
}
