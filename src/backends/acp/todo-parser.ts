/**
 * Todo parsing utilities for ACP backend.
 * Converts raw ACP tool payloads into structured TodoItem arrays.
 */

import type { TodoItem } from "../../types/loop";
import { firstString, isRecord } from "./json-helpers";

function normalizeTodoStatus(value: unknown): TodoItem["status"] | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  switch (normalized) {
    case "pending":
      return "pending";
    case "in_progress":
    case "in-progress":
    case "running":
    case "active":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
    case "finished":
    case "success":
      return "completed";
    case "cancelled":
    case "canceled":
    case "skipped":
      return "cancelled";
    default:
      return undefined;
  }
}

function normalizeTodoPriority(value: unknown): TodoItem["priority"] | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  switch (normalized) {
    case "high":
    case "urgent":
      return "high";
    case "medium":
    case "normal":
      return "medium";
    case "low":
      return "low";
    default:
      return undefined;
  }
}

function makeTodoId(prefix: string, index: number, content: string): string {
  const normalizedContent = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = normalizedContent.length > 0 ? normalizedContent : String(index);
  return `${prefix}-${index}-${suffix}`;
}

function parseTodoChecklist(raw: string, prefix: string): TodoItem[] {
  const todos: TodoItem[] = [];
  const lines = raw.split(/\r?\n/);
  const checkboxPattern = /^\s*[-*]\s*\[([ xX~\-])\]\s*(.+?)\s*$/;

  for (const line of lines) {
    const match = line.match(checkboxPattern);
    if (!match) {
      continue;
    }
    const marker = match[1];
    const content = match[2]?.trim() ?? "";
    if (content.length === 0) {
      continue;
    }

    const status: TodoItem["status"] =
      marker === "x" || marker === "X"
        ? "completed"
        : marker === "~" || marker === "-"
          ? "in_progress"
          : "pending";

    todos.push({
      id: makeTodoId(prefix, todos.length, content),
      content,
      status,
      priority: "medium",
    });
  }

  return todos;
}

function parseTodoRecord(value: Record<string, unknown>, index: number, prefix: string): TodoItem | null {
  const content = firstString(
    value["content"],
    value["text"],
    value["title"],
    value["task"],
    value["name"],
  )?.trim();

  if (!content) {
    return null;
  }

  const status = normalizeTodoStatus(value["status"])
    ?? (typeof value["done"] === "boolean" ? (value["done"] ? "completed" : "pending") : undefined)
    ?? "pending";

  const priority = normalizeTodoPriority(value["priority"]) ?? "medium";
  const id = firstString(value["id"], value["todoId"], value["key"]) ?? makeTodoId(prefix, index, content);

  return {
    id,
    content,
    status,
    priority,
  };
}

export function parseTodosFromUnknown(value: unknown, prefix: string): TodoItem[] {
  if (Array.isArray(value)) {
    const todos: TodoItem[] = [];
    for (const [index, item] of value.entries()) {
      if (isRecord(item)) {
        const parsed = parseTodoRecord(item, index, prefix);
        if (parsed) {
          todos.push(parsed);
        }
        continue;
      }
      if (typeof item === "string") {
        const checklistTodos = parseTodoChecklist(item, `${prefix}-${index}`);
        if (checklistTodos.length > 0) {
          todos.push(...checklistTodos);
        } else if (item.trim().length > 0) {
          todos.push({
            id: makeTodoId(prefix, index, item),
            content: item.trim(),
            status: "pending",
            priority: "medium",
          });
        }
      }
    }
    return todos;
  }

  if (isRecord(value)) {
    const nestedTodos = value["todos"];
    if (nestedTodos !== undefined) {
      const parsedNested = parseTodosFromUnknown(nestedTodos, `${prefix}-todos`);
      if (parsedNested.length > 0) {
        return parsedNested;
      }
    }

    const parsedRecord = parseTodoRecord(value, 0, prefix);
    if (parsedRecord) {
      return [parsedRecord];
    }

    const textCandidates = [
      firstString(value["detailedContent"]),
      firstString(value["content"]),
      firstString(value["text"]),
      firstString(value["message"]),
    ];
    for (const candidate of textCandidates) {
      if (!candidate) {
        continue;
      }
      const parsedChecklist = parseTodoChecklist(candidate, prefix);
      if (parsedChecklist.length > 0) {
        return parsedChecklist;
      }
    }

    return [];
  }

  if (typeof value === "string") {
    return parseTodoChecklist(value, prefix);
  }

  return [];
}
