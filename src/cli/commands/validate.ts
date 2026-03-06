// tqp validate <manifest.json>

import { existsSync } from "fs";
import { resolve } from "path";
import type { Manifest } from "../../types";

export async function validate(args: string[]) {
  const file = args[0];
  if (!file) {
    console.error("Usage: tqp validate <manifest.json>");
    process.exit(1);
  }

  const fullPath = resolve(process.cwd(), file);
  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const content = await Bun.file(fullPath).text();
  let manifest: Manifest;

  try {
    manifest = JSON.parse(content);
  } catch {
    console.error("Invalid JSON");
    process.exit(1);
  }

  const errors: string[] = [];

  // Validate top-level fields
  if (!manifest.tqp) errors.push("Missing 'tqp' version field");
  if (!manifest.name) errors.push("Missing 'name' field");
  if (!manifest.types || typeof manifest.types !== "object") errors.push("Missing or invalid 'types' field");
  if (!manifest.actions || typeof manifest.actions !== "object") errors.push("Missing or invalid 'actions' field");

  // Validate types
  if (manifest.types) {
    for (const [name, typeDef] of Object.entries(manifest.types)) {
      if (!typeDef.fields || typeof typeDef.fields !== "object") {
        errors.push(`Type '${name}': missing 'fields' object`);
        continue;
      }
      for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
        if (!fieldDef.type) {
          errors.push(`Type '${name}.${fieldName}': missing 'type'`);
        }
      }
    }
  }

  // Validate actions
  if (manifest.actions) {
    for (const [name, action] of Object.entries(manifest.actions)) {
      if (!action.description) errors.push(`Action '${name}': missing 'description'`);
      if (!action.returns) errors.push(`Action '${name}': missing 'returns'`);
      if (!action.input || typeof action.input !== "object") {
        errors.push(`Action '${name}': missing or invalid 'input'`);
        continue;
      }

      // Validate return type reference
      const returnBase = action.returns?.replace("list:", "").replace("?", "");
      if (returnBase && !["string", "int", "float", "bool"].includes(returnBase)) {
        if (!manifest.types?.[returnBase]) {
          errors.push(`Action '${name}': return type '${returnBase}' not found in types`);
        }
      }

      // Validate input field type references
      for (const [paramName, paramDef] of Object.entries(action.input)) {
        const paramBase = paramDef.type?.replace("list:", "").replace("?", "");
        if (paramBase && !["string", "int", "float", "bool"].includes(paramBase)) {
          if (!manifest.types?.[paramBase]) {
            errors.push(`Action '${name}' input '${paramName}': type '${paramBase}' not found in types`);
          }
        }
      }
    }
  }

  // Validate type references in fields
  if (manifest.types) {
    for (const [typeName, typeDef] of Object.entries(manifest.types)) {
      for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
        const refBase = fieldDef.type?.replace("list:", "").replace("?", "");
        if (refBase && !["string", "int", "float", "bool"].includes(refBase)) {
          if (!manifest.types[refBase]) {
            errors.push(`Type '${typeName}.${fieldName}': references unknown type '${refBase}'`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Manifest validation failed (${errors.length} error${errors.length > 1 ? "s" : ""}):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const typeCount = Object.keys(manifest.types ?? {}).length;
  const actionCount = Object.keys(manifest.actions ?? {}).length;
  console.log(`Manifest valid: ${typeCount} type${typeCount !== 1 ? "s" : ""}, ${actionCount} action${actionCount !== 1 ? "s" : ""}`);
}
