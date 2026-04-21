import { Notice } from "obsidian";
import type { PluginSettings } from "../../domain/models";
import type { SettingsService } from "../../services/settings-service";

/**
 * Obsidian PluginSettingTab — delegates to SettingsService.
 * The actual Plugin class injects `this` as the host tab.
 */
export class PluginSettingsTab {
  private container: HTMLElement;
  private service: SettingsService;

  constructor(container: HTMLElement, service: SettingsService) {
    this.container = container;
    this.service = service;
  }

  display(): void {
    this.container.empty();
    this.container.addClass("srf-settings");

    const settings = this.service.getSettings();

    const hero = this.container.createDiv({ cls: "srf-panel srf-settings__hero" });
    hero.createEl("p", { cls: "srf-eyebrow", text: "Plugin settings" });
    hero.createEl("h1", {
      cls: "srf-settings__title",
      text: "Tune the rhythm of review, not just the switches.",
    });
    hero.createEl("p", {
      cls: "srf-settings__subtitle",
      text: "Most defaults should fade into the background. These controls exist for the moments when your workflow needs a deliberate adjustment.",
    });

    this.renderGroup(
      "Review Behavior",
      "Set how aggressively new cards enter the queue and how much help the interface gives during review.",
      (group) => {
        this.renderNumber(group, "New cards per day", settings.newCardsPerDay, (v) =>
          this.service.updateSettings({ newCardsPerDay: v })
        );
        this.renderNumber(group, "Max reviews per day", settings.maxReviewsPerDay, (v) =>
          this.service.updateSettings({ maxReviewsPerDay: v })
        );
        this.renderToggle(group, "Bury sibling cards", settings.burySiblings, (v) =>
          this.service.updateSettings({ burySiblings: v })
        );
        this.renderToggle(group, "Show shortcut hints", settings.showShortcutHints, (v) =>
          this.service.updateSettings({ showShortcutHints: v })
        );
      }
    );

    this.renderGroup(
      "Card Defaults",
      "These defaults shape what the builder opens with before you make a specific choice.",
      (group) => {
        this.renderSelect(group, "Default card mode", ["basic", "cloze"], settings.defaultCardMode, (v) =>
          this.service.updateSettings({
            defaultCardMode: v as PluginSettings["defaultCardMode"],
          })
        );
      }
    );

    this.renderGroup(
      "Sync / Export",
      "Backup and restore your cards without reaching into plugin data by hand.",
      (group) => {
        this.renderSelect(group, "Export format", ["json", "csv"], settings.exportFormat, (v) =>
          this.service.updateSettings({
            exportFormat: v as PluginSettings["exportFormat"],
          })
        );
        this.renderButton(group, "Export data", "Export", async () => {
          const currentSettings = this.service.getSettings();
          const isCsv = currentSettings.exportFormat === "csv";
          const payload = isCsv
            ? await this.service.exportCsv()
            : await this.service.exportJson();
          const blob = new Blob([payload], {
            type: isCsv ? "text/csv" : "application/json",
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "a"
          ) as HTMLAnchorElement;
          anchor.href = url;
          anchor.download = isCsv ? "flashcards-backup.csv" : "flashcards-backup.json";
          anchor.click();
          URL.revokeObjectURL(url);
        });
        this.renderButton(group, "Import data", "Import JSON", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "application/json,.json";
          input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
              const text = await file.text();
              const result = await this.service.importJson(text);
              new Notice(`Imported ${result.importedCards} cards.`);
            } catch (error) {
              console.error("[SRF] Import failed:", error);
              new Notice("Import failed. Check that the file is valid JSON backup data.");
            }
          });
          input.click();
        });
      }
    );

    this.renderGroup(
      "Shortcuts",
      "Keep the core keyboard loop discoverable without hunting through documentation.",
      (group) => {
        this.renderInfo(group, "Reveal answer", "Space");
        this.renderInfo(group, "Again", "1");
        this.renderInfo(group, "Hard", "2");
        this.renderInfo(group, "Good", "3");
        this.renderInfo(group, "Easy", "4");
      }
    );

    this.renderGroup(
      "Advanced",
      "Low-level controls for how frequently previews update and whether note changes trigger background sync.",
      (group) => {
        this.renderToggle(group, "Auto sync on vault change", settings.autoSyncOnVaultChange, (v) =>
          this.service.updateSettings({ autoSyncOnVaultChange: v })
        );
        this.renderNumber(group, "Preview debounce (ms)", settings.previewDebounceMs, (v) =>
          this.service.updateSettings({ previewDebounceMs: v })
        );
      }
    );
  }

  private renderGroup(
    heading: string,
    description: string,
    body: (group: HTMLElement) => void
  ): void {
    const section = this.container.createDiv({ cls: "srf-panel srf-settings__group" });
    section.createEl("h2", { cls: "srf-settings__group-heading", text: heading });
    section.createEl("p", { cls: "srf-settings__group-description", text: description });
    const group = section.createDiv({ cls: "srf-settings__group-body" });
    body(group);
  }

  private renderToggle(
    group: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void
  ): void {
    const row = this.renderRow(group, label);
    const toggle = row.createEl("input") as HTMLInputElement;
    toggle.type = "checkbox";
    toggle.checked = value;
    toggle.className = "srf-settings__toggle";
    toggle.addEventListener("change", () => onChange(toggle.checked));
  }

  private renderNumber(
    group: HTMLElement,
    label: string,
    value: number,
    onChange: (v: number) => void
  ): void {
    const row = this.renderRow(group, label);
    const input = row.createEl("input") as HTMLInputElement;
    input.type = "number";
    input.value = String(value);
    input.className = "srf-settings__input";
    input.addEventListener("change", () => {
      const nextValue = parseInt(input.value, 10);
      if (!Number.isNaN(nextValue)) onChange(nextValue);
    });
  }

  private renderSelect(
    group: HTMLElement,
    label: string,
    options: string[],
    value: string,
    onChange: (v: string) => void
  ): void {
    const row = this.renderRow(group, label);
    const select = row.createEl("select", { cls: "srf-settings__select" }) as HTMLSelectElement;
    options.forEach((optionValue) => {
      const option = select.createEl("option", { value: optionValue, text: optionValue });
      if (optionValue === value) option.selected = true;
    });
    select.addEventListener("change", () => onChange(select.value));
  }

  private renderButton(
    group: HTMLElement,
    label: string,
    btnLabel: string,
    onClick: () => void
  ): void {
    const row = this.renderRow(group, label);
    const btn = row.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: btnLabel,
    });
    btn.addEventListener("click", onClick);
  }

  private renderInfo(group: HTMLElement, label: string, value: string): void {
    const row = this.renderRow(group, label);
    row.createEl("kbd", { cls: "srf-kbd", text: value });
  }

  private renderRow(group: HTMLElement, label: string): HTMLElement {
    const row = group.createDiv({ cls: "srf-settings__row" });
    const copy = row.createDiv({ cls: "srf-settings__row-copy" });
    copy.createEl("label", { cls: "srf-settings__label", text: label });
    return row;
  }
}
