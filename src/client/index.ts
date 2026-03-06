// TQP Client

import type { FieldSelector, Manifest, TQPResponse } from "../types";

export interface CallOptions {
  input?: Record<string, unknown>;
  fields?: FieldSelector;
  dry_run?: boolean;
  confirmed?: boolean;
}

export class TQPClient {
  private baseUrl: string;
  private manifest: Manifest | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    const res = await fetch(`${this.baseUrl}/tqp/manifest`);
    const body = (await res.json()) as TQPResponse;
    if (body.error) throw new Error(body.error.message);
    this.manifest = body.data as Manifest;
    return this.manifest;
  }

  async health(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/tqp/health`);
    const body = (await res.json()) as TQPResponse;
    if (body.error) throw new Error(body.error.message);
    return body.data as { status: string; version: string };
  }

  async describe(typeName: string): Promise<unknown> {
    return this.call("tqp.describe", { input: { type: typeName } });
  }

  async call(action: string, options: CallOptions = {}): Promise<TQPResponse> {
    const body: Record<string, unknown> = { action };
    if (options.input) body.input = options.input;
    if (options.fields) body.fields = options.fields;
    if (options.dry_run) body.dry_run = true;
    if (options.confirmed) body.confirmed = true;
    body.id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const res = await fetch(`${this.baseUrl}/tqp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return (await res.json()) as TQPResponse;
  }
}
