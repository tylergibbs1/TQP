// TQP Field Filtering Engine

import type { FieldSelector, Manifest } from "./types";

/**
 * Recursively filters a data object to include only the fields
 * specified in the selector. If no selector is provided, returns
 * the full object.
 */
export function filterFields(
  data: unknown,
  fields: FieldSelector | undefined,
  typeName: string,
  manifest: Manifest
): unknown {
  if (fields === undefined) return data;
  if (data === null || data === undefined) return data;

  // Handle list types
  if (Array.isArray(data)) {
    const itemType = resolveListItemType(typeName);
    return data.map((item) => filterFields(item, fields, itemType, manifest));
  }

  if (typeof data !== "object") return data;

  const typeDef = manifest.types[resolveBaseType(typeName)];
  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [fieldName, selector] of Object.entries(fields)) {
    if (!(fieldName in obj)) continue;

    if (selector === true) {
      result[fieldName] = obj[fieldName];
    } else if (typeof selector === "object" && selector !== null) {
      // Nested selection — find the field's type and recurse
      const fieldType = typeDef?.fields[fieldName]?.type;
      if (fieldType) {
        result[fieldName] = filterFields(obj[fieldName], selector, fieldType, manifest);
      } else {
        // Unknown type, just include as-is
        result[fieldName] = obj[fieldName];
      }
    }
  }

  return result;
}

function resolveBaseType(typeStr: string): string {
  let t = typeStr.replace("?", "");
  if (t.startsWith("list:")) t = t.slice(5);
  return t;
}

function resolveListItemType(typeStr: string): string {
  const t = typeStr.replace("?", "");
  if (t.startsWith("list:")) return t.slice(5);
  return t;
}
