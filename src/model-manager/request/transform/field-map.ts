import type { FieldMapRule } from "../../catalog/types";
import type { UnifiedChatRequest } from "../types";

function getPath(obj: unknown, path: string): unknown {
  if (!path.includes(".")) {
    return (obj as Record<string, unknown> | undefined)?.[path];
  }
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!path.includes(".")) {
    obj[path] = value;
    return;
  }
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!cur[key] || typeof cur[key] !== "object") {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function applyFieldMap(
  target: Record<string, unknown>,
  src: UnifiedChatRequest,
  rules: FieldMapRule[],
  stream: boolean,
): void {
  for (const rule of rules) {
    if ("drop" in rule && rule.drop) {
      continue;
    }
    if ("whenStream" in rule && rule.whenStream === true && !stream) {
      continue;
    }
    if ("whenNotStream" in rule && rule.whenNotStream === true && stream) {
      continue;
    }
    if (!("to" in rule)) {
      continue;
    }
    const raw = getPath(src, rule.from);
    if (raw === undefined) {
      continue;
    }
    let v: unknown = raw;
    if (rule.clamp && typeof v === "number") {
      let n = v;
      if (rule.clamp.min != null) {
        n = Math.max(rule.clamp.min, n);
      }
      if (rule.clamp.max != null) {
        n = Math.min(rule.clamp.max, n);
      }
      v = n;
    }
    if (rule.enumMap && typeof v === "string") {
      v = rule.enumMap[v] ?? v;
    }
    // responseFormat → snake vendor shape
    if (rule.from === "responseFormat" && v && typeof v === "object") {
      const rf = v as { type: string; jsonSchema?: unknown };
      v = {
        type: rf.type,
        ...(rf.jsonSchema != null ? { json_schema: rf.jsonSchema } : {}),
      };
    }
    setPath(target, rule.to, v);
  }
}
