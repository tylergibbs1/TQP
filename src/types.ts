// TQP Core Type Definitions

export type PrimitiveType = "string" | "int" | "float" | "bool";

export interface FieldDefinition {
  type: string;
  description?: string;
  cost?: "low" | "medium" | "high";
  enum?: string[];
  default?: unknown;
  deprecated?: string;
  required?: boolean;
}

export interface TypeDefinition {
  description?: string;
  fields: Record<string, FieldDefinition>;
}

export interface ActionDefinition {
  description: string;
  input: Record<string, FieldDefinition>;
  returns: string;
  safe?: boolean;
  destructive?: boolean;
  dry_run?: boolean;
  confirm?: boolean;
  idempotent?: boolean;
  rate_limit?: string;
}

export interface Manifest {
  tqp: string;
  name: string;
  description: string;
  types: Record<string, TypeDefinition>;
  actions: Record<string, ActionDefinition>;
}

export interface TQPRequest {
  action: string;
  input?: Record<string, unknown>;
  fields?: FieldSelector;
  dry_run?: boolean;
  confirmed?: boolean;
  id?: string;
}

export type FieldSelector = Record<string, true | FieldSelector>;

export interface TQPResponse {
  id?: string;
  data?: unknown;
  error?: TQPError | null;
  meta?: ResponseMeta;
}

export interface TQPError {
  code: ErrorCode;
  message: string;
  field?: string;
  type?: string;
}

export type ErrorCode =
  | "INVALID_ACTION"
  | "INVALID_FIELD"
  | "INVALID_INPUT"
  | "REQUIRES_CONFIRMATION"
  | "DRY_RUN_NOT_SUPPORTED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "INTERNAL";

export interface ResponseMeta {
  cost_tokens_estimate?: number;
  dry_run?: boolean;
  truncated?: boolean;
}

export interface ServerOptions {
  name: string;
  description: string;
  version?: string;
}

export interface ListenOptions {
  transport: "http" | "stdio";
  port?: number;
  hostname?: string;
}

export interface ActionConfig<T = unknown> {
  description: string;
  input: Record<string, FieldDefinition>;
  returns: string;
  safe?: boolean;
  destructive?: boolean;
  dry_run?: boolean;
  confirm?: boolean;
  idempotent?: boolean;
  rate_limit?: string;
  handler: (input: Record<string, unknown>, context: ActionContext) => Promise<T> | T;
  resolve?: Record<string, (input: Record<string, unknown>) => Promise<unknown> | unknown>;
}

export interface ActionContext {
  dry_run: boolean;
  fields?: FieldSelector;
}
