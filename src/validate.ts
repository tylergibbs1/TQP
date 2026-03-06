// TQP Input Validation & Hardening

import type { FieldDefinition, TQPError, TQPRequest, ActionDefinition, Manifest, FieldSelector, TypeDefinition } from "./types";

const PATH_TRAVERSAL = /\.\.[\/\\]|%2e%2e/i;
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
const RESOURCE_ID_UNSAFE = /[?#]/;

export function validateRequest(request: unknown): TQPRequest | TQPError {
  if (typeof request !== "object" || request === null) {
    return { code: "INVALID_INPUT", message: "Request must be a JSON object" };
  }

  const req = request as Record<string, unknown>;

  if (typeof req.action !== "string" || req.action.length === 0) {
    return { code: "INVALID_INPUT", message: "Missing or invalid 'action' field" };
  }

  if (req.input !== undefined && (typeof req.input !== "object" || req.input === null || Array.isArray(req.input))) {
    return { code: "INVALID_INPUT", message: "'input' must be a JSON object" };
  }

  if (req.fields !== undefined && (typeof req.fields !== "object" || req.fields === null || Array.isArray(req.fields))) {
    return { code: "INVALID_INPUT", message: "'fields' must be a JSON object" };
  }

  return {
    action: req.action,
    input: req.input as Record<string, unknown> | undefined,
    fields: req.fields as FieldSelector | undefined,
    dry_run: typeof req.dry_run === "boolean" ? req.dry_run : false,
    confirmed: typeof req.confirmed === "boolean" ? req.confirmed : false,
    id: typeof req.id === "string" ? req.id : undefined,
  };
}

export function validateInput(
  input: Record<string, unknown> | undefined,
  schema: Record<string, FieldDefinition>
): TQPError | null {
  const provided = input ?? {};

  // Check required fields
  for (const [name, def] of Object.entries(schema)) {
    if (def.required && (provided[name] === undefined || provided[name] === null)) {
      return {
        code: "INVALID_INPUT",
        message: `Missing required field '${name}'`,
        field: name,
      };
    }
  }

  // Validate each provided field
  for (const [name, value] of Object.entries(provided)) {
    const def = schema[name];
    if (!def) {
      return {
        code: "INVALID_INPUT",
        message: `Unknown input field '${name}'`,
        field: name,
      };
    }

    if (value === undefined || value === null) continue;

    const typeError = validateFieldType(name, value, def);
    if (typeError) return typeError;

    const hardenError = hardenInput(name, value);
    if (hardenError) return hardenError;
  }

  return null;
}

function validateFieldType(name: string, value: unknown, def: FieldDefinition): TQPError | null {
  const baseType = def.type.replace("?", "");

  if (baseType.startsWith("list:")) {
    if (!Array.isArray(value)) {
      return {
        code: "INVALID_INPUT",
        message: `Field '${name}' must be an array`,
        field: name,
      };
    }
    return null;
  }

  switch (baseType) {
    case "string":
      if (typeof value !== "string") {
        return { code: "INVALID_INPUT", message: `Field '${name}' must be a string`, field: name };
      }
      if (def.enum && !def.enum.includes(value)) {
        return {
          code: "INVALID_INPUT",
          message: `Field '${name}' must be one of: ${def.enum.join(", ")}`,
          field: name,
        };
      }
      break;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { code: "INVALID_INPUT", message: `Field '${name}' must be an integer`, field: name };
      }
      break;
    case "float":
      if (typeof value !== "number") {
        return { code: "INVALID_INPUT", message: `Field '${name}' must be a number`, field: name };
      }
      break;
    case "bool":
      if (typeof value !== "boolean") {
        return { code: "INVALID_INPUT", message: `Field '${name}' must be a boolean`, field: name };
      }
      break;
  }

  return null;
}

function hardenInput(name: string, value: unknown): TQPError | null {
  if (typeof value === "string") {
    if (PATH_TRAVERSAL.test(value)) {
      return { code: "INVALID_INPUT", message: `Field '${name}' contains path traversal`, field: name };
    }
    if (CONTROL_CHARS.test(value)) {
      return { code: "INVALID_INPUT", message: `Field '${name}' contains invalid control characters`, field: name };
    }
    if (RESOURCE_ID_UNSAFE.test(value) && name.endsWith("_id")) {
      return { code: "INVALID_INPUT", message: `Field '${name}' contains invalid characters for a resource ID`, field: name };
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const err = hardenInput(name, item);
      if (err) return err;
    }
  }

  return null;
}

export function validateFields(
  fields: FieldSelector,
  typeName: string,
  manifest: Manifest,
  depth: number = 0,
  maxDepth: number = 10
): TQPError | null {
  if (depth > maxDepth) {
    return { code: "INVALID_FIELD", message: `Field selector exceeds maximum nesting depth of ${maxDepth}` };
  }

  const typeDef = manifest.types[typeName];
  if (!typeDef) return null; // Primitive or list type, skip validation

  for (const [fieldName, selector] of Object.entries(fields)) {
    const fieldDef = typeDef.fields[fieldName];
    if (!fieldDef) {
      return {
        code: "INVALID_FIELD",
        message: `Field '${fieldName}' does not exist on type '${typeName}'`,
        field: fieldName,
        type: typeName,
      };
    }

    if (typeof selector === "object" && selector !== null) {
      // Nested selector — resolve the referenced type
      const referencedType = resolveTypeName(fieldDef.type);
      if (referencedType && manifest.types[referencedType]) {
        const err = validateFields(selector, referencedType, manifest, depth + 1, maxDepth);
        if (err) return err;
      }
    }
  }

  return null;
}

function resolveTypeName(typeStr: string): string | null {
  let t = typeStr.replace("?", "");
  if (t.startsWith("list:")) t = t.slice(5);
  if (["string", "int", "float", "bool"].includes(t)) return null;
  return t;
}

export function applyDefaults(
  input: Record<string, unknown> | undefined,
  schema: Record<string, FieldDefinition>
): Record<string, unknown> {
  const result = { ...(input ?? {}) };
  for (const [name, def] of Object.entries(schema)) {
    if (result[name] === undefined && def.default !== undefined) {
      result[name] = def.default;
    }
  }
  return result;
}
