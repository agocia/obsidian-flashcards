import type { PluginDataRepository } from "../data/plugin-data-repository";
import type { PluginSettings } from "../domain/models";

// ─── Theme tokens ─────────────────────────────────────────────────────────────

const LIGHT_TOKENS: Record<string, string> = {
  "--srf-bg-primary": "#F6F4EF",
  "--srf-bg-secondary": "#EFEBE3",
  "--srf-surface-primary": "#FFFCF7",
  "--srf-surface-elevated": "#FFFFFF",
  "--srf-surface-tint": "#F3EFE8",
  "--srf-text-primary": "#1C1B19",
  "--srf-text-secondary": "#5F5A52",
  "--srf-text-tertiary": "#8B8479",
  "--srf-border-subtle": "#DDD6CA",
  "--srf-accent-primary": "#6C5CE7",
  "--srf-accent-primary-hover": "#5B4DD1",
  "--srf-accent-soft": "#EEEAFE",
  "--srf-success": "#1F8A5B",
  "--srf-warning": "#D98E04",
  "--srf-danger": "#C84C3A",
  "--srf-info": "#2F6FED",
  "--srf-shadow-color": "rgba(28, 27, 25, 0.10)",
};

const DARK_TOKENS: Record<string, string> = {
  "--srf-bg-primary": "#171614",
  "--srf-bg-secondary": "#1F1D1A",
  "--srf-surface-primary": "#24211D",
  "--srf-surface-elevated": "#2B2722",
  "--srf-surface-tint": "#312C26",
  "--srf-text-primary": "#F5F1E8",
  "--srf-text-secondary": "#C9C1B5",
  "--srf-text-tertiary": "#948B7E",
  "--srf-border-subtle": "#3A352E",
  "--srf-accent-primary": "#8B7CFF",
  "--srf-accent-primary-hover": "#9C90FF",
  "--srf-accent-soft": "rgba(139, 124, 255, 0.16)",
  "--srf-success": "#4CC38A",
  "--srf-warning": "#F0AE3A",
  "--srf-danger": "#F06D5E",
  "--srf-info": "#69A6FF",
  "--srf-shadow-color": "rgba(0, 0, 0, 0.32)",
};

export function themeTokensForMode(mode: "light" | "dark"): Record<string, string> {
  return mode === "dark" ? { ...DARK_TOKENS } : { ...LIGHT_TOKENS };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SettingsService {
  constructor(private readonly repository: PluginDataRepository) {}

  getSettings(): PluginSettings {
    return this.repository.snapshot().settings;
  }

  async updateSettings(partial: Partial<PluginSettings>): Promise<PluginSettings> {
    const updated = await this.repository.save((data) => ({
      ...data,
      settings: { ...data.settings, ...partial },
    }));
    return updated.settings;
  }

  async exportJson(): Promise<string> {
    const data = await this.repository.load();
    return JSON.stringify(data, null, 2);
  }

  async exportCsv(): Promise<string> {
    const data = await this.repository.load();
    const templateMap = new Map(data.templates.map((template) => [template.id, template]));
    const deckMap = new Map(data.decks.map((deck) => [deck.id, deck.name]));
    const tagMap = new Map(data.tags.map((tag) => [tag.id, tag.label]));

    const rows = data.cards.map((card) => {
      const template = templateMap.get(card.templateId);
      const tagLabels = (template?.tagIds ?? [])
        .map((tagId) => tagMap.get(tagId) ?? tagId)
        .join("|");

      return [
        card.id,
        card.templateId,
        template?.deckId ?? "",
        deckMap.get(template?.deckId ?? "") ?? "",
        template?.sourceAnchor.filePath ?? "",
        template?.sourceAnchor.noteTitle ?? "",
        card.promptText,
        card.answerText,
        card.state,
        card.dueAt ?? "",
        card.difficulty?.toString() ?? "",
        tagLabels,
      ];
    });

    return [
      [
        "cardId",
        "templateId",
        "deckId",
        "deckName",
        "sourceFile",
        "sourceNoteTitle",
        "promptText",
        "answerText",
        "state",
        "dueAt",
        "difficulty",
        "tags",
      ],
      ...rows,
    ]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\n");
  }

  async importJson(json: string): Promise<{ importedCards: number }> {
    const { safeParsePluginData } = await import("../domain/schemas");
    const parsed = JSON.parse(json) as unknown;
    const data = safeParsePluginData(parsed);
    await this.repository.replace(data);
    return { importedCards: data.cards.length };
  }
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}
