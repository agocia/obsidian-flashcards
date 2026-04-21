import {
  createDefaultPluginData,
  SCHEMA_VERSION,
  type PluginData,
} from "../domain/models";
import { safeParsePluginData } from "../domain/schemas";

// ─── Migration entry ─────────────────────────────────────────────────────────

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations = new Map<number, MigrationFn>([
  [
    0,
    (data) => {
      // v0 → v1: ensure all required top-level fields exist
      const defaults = createDefaultPluginData();
      return {
        version: 1,
        settings: (data["settings"] as object | undefined) ?? defaults.settings,
        decks:
          Array.isArray(data["decks"]) && (data["decks"] as unknown[]).length > 0
            ? data["decks"]
            : defaults.decks,
        tags: Array.isArray(data["tags"]) ? data["tags"] : [],
        templates: Array.isArray(data["templates"]) ? data["templates"] : [],
        cards: Array.isArray(data["cards"]) ? data["cards"] : [],
        logs: Array.isArray(data["logs"] ?? data["reviewLogs"])
          ? (data["logs"] ?? data["reviewLogs"])
          : [],
        sessionDraft: (data["sessionDraft"] as object | null | undefined) ?? null,
      };
    },
  ],
  [
    1,
    (data) => ({
      ...data,
      version: 2,
      cards: Array.isArray(data["cards"])
        ? (data["cards"] as Array<Record<string, unknown>>).map((card) => ({
            ...card,
            stateBeforeSuspension:
              typeof card["stateBeforeSuspension"] === "string" ||
              card["stateBeforeSuspension"] === null
                ? card["stateBeforeSuspension"]
                : null,
          }))
        : [],
    }),
  ],
]);

// ─── Public migration entry ───────────────────────────────────────────────────

export function migratePluginData(raw: unknown): PluginData {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return createDefaultPluginData();
  }

  let data = raw as Record<string, unknown>;
  let version = typeof data["version"] === "number"
    ? (data["version"] as number)
    : typeof data["schemaVersion"] === "number"
    ? (data["schemaVersion"] as number)
    : 0;

  while (version < SCHEMA_VERSION) {
    const migration = migrations.get(version);
    if (!migration) break;
    data = migration(data);
    version =
      typeof data["version"] === "number"
        ? (data["version"] as number)
        : version + 1;
  }

  return safeParsePluginData(data);
}
