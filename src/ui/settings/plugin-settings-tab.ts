import { Notice } from "obsidian";
import type { PluginSettings } from "../../domain/models";
import { getDeckDescendantIds } from "../../domain/deck-utils";
import type { DeckService } from "../../services/deck-service";
import type { SettingsService } from "../../services/settings-service";

/**
 * Obsidian PluginSettingTab — delegates to SettingsService and DeckService.
 * The actual Plugin class injects `this` as the host tab.
 */
export class PluginSettingsTab {
  private container: HTMLElement;
  private service: SettingsService;
  private deckService: DeckService;
  private onDidChange?: () => void | Promise<void>;

  constructor(
    container: HTMLElement,
    service: SettingsService,
    deckService: DeckService,
    onDidChange?: () => void | Promise<void>
  ) {
    this.container = container;
    this.service = service;
    this.deckService = deckService;
    this.onDidChange = onDidChange;
  }

  display(): void {
    this.container.empty();
    this.container.addClass("srf-settings");

    const settings = this.service.getSettings();
    const activeDeckOptions = this.deckService.getDeckOptions();
    const allDeckOptions = this.deckService.getDeckOptions(true);
    const deckRecords = this.deckService.getDeckRecords(true);

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
          this.persistSettings({ newCardsPerDay: v })
        );
        this.renderNumber(group, "Max reviews per day", settings.maxReviewsPerDay, (v) =>
          this.persistSettings({ maxReviewsPerDay: v })
        );
        this.renderToggle(group, "Bury sibling cards", settings.burySiblings, (v) =>
          this.persistSettings({ burySiblings: v })
        );
        this.renderToggle(group, "Show shortcut hints", settings.showShortcutHints, (v) =>
          this.persistSettings({ showShortcutHints: v })
        );
      }
    );

    this.renderGroup(
      "Card Defaults",
      "These defaults shape what the builder opens with before you make a specific choice.",
      (group) => {
        this.renderSelect(
          group,
          "Default card mode",
          ["basic", "cloze"],
          settings.defaultCardMode,
          (v) =>
            this.persistSettings({
              defaultCardMode: v as PluginSettings["defaultCardMode"],
            })
        );
      }
    );

    this.renderGroup(
      "Decks",
      "Create decks, set the default capture target, and keep your hierarchy clean without leaving the plugin.",
      (group) => {
        this.renderOptionSelect(
          group,
          "Default deck",
          activeDeckOptions.map((deck) => ({ value: deck.id, label: deck.label })),
          this.deckService.getDefaultDeckId(),
          (deckId) => {
            void this.runDeckMutation(async () => {
              await this.deckService.setDefaultDeck(deckId);
            }, "Default deck updated.");
          }
        );

        const creator = group.createDiv({ cls: "srf-settings__deck-creator" });
        creator.createDiv({
          cls: "srf-settings__deck-helper",
          text: "Create a top-level deck or nest it under an existing one.",
        });

        const createGrid = creator.createDiv({ cls: "srf-settings__deck-grid" });
        const nameField = createGrid.createDiv({ cls: "srf-settings__deck-field" });
        nameField.createEl("label", { cls: "srf-settings__label", text: "Deck name" });
        const nameInput = nameField.createEl("input", {
          cls: "srf-settings__input",
          type: "text",
          placeholder: "Deck name",
        }) as HTMLInputElement;

        const parentField = createGrid.createDiv({ cls: "srf-settings__deck-field" });
        parentField.createEl("label", { cls: "srf-settings__label", text: "Parent deck" });
        const parentSelect = parentField.createEl("select", {
          cls: "srf-settings__select",
        }) as HTMLSelectElement;
        const rootOption = parentSelect.createEl("option", {
          value: "",
          text: "No parent deck",
        });
        rootOption.selected = true;
        activeDeckOptions.forEach((deck) => {
          parentSelect.createEl("option", {
            value: deck.id,
            text: deck.label,
          });
        });

        const createActions = createGrid.createDiv({
          cls: "srf-settings__deck-actions srf-settings__deck-actions--create",
        });
        const createBtn = createActions.createEl("button", {
          cls: "srf-btn srf-btn--primary",
          text: "Create deck",
        });
        createBtn.addEventListener("click", () => {
          void this.runDeckMutation(async () => {
            await this.deckService.createDeck({
              name: nameInput.value,
              parentDeckId: parentSelect.value || null,
            });
          }, "Deck created.");
        });

        const list = group.createDiv({ cls: "srf-settings__deck-list" });
        deckRecords.forEach((deck) => {
          const card = list.createDiv({
            cls: `srf-settings__deck-card${deck.archived ? " srf-settings__deck-card--archived" : ""}`,
          });

          const header = card.createDiv({ cls: "srf-settings__deck-card-header" });
          const title = header.createDiv({ cls: "srf-settings__deck-card-title-wrap" });
          title.createDiv({ cls: "srf-settings__deck-card-path", text: deck.fullPath });

          const badges = title.createDiv({ cls: "srf-settings__deck-card-badges" });
          if (deck.id === this.deckService.getDefaultDeckId()) {
            badges.createSpan({ cls: "srf-tag-pill", text: "Default" });
          }
          if (deck.archived) {
            badges.createSpan({ cls: "srf-tag-pill", text: "Archived" });
          }
          if (deck.parentDeckId) {
            badges.createSpan({ cls: "srf-tag-pill", text: "Subdeck" });
          }

          header.createDiv({
            cls: "srf-settings__deck-card-meta",
            text: deck.archived
              ? "Archived decks stay out of the active review queue until restored."
              : "Active decks appear in builder, dashboard, and library deck selectors.",
          });

          const grid = card.createDiv({ cls: "srf-settings__deck-grid" });
          const deckNameField = grid.createDiv({ cls: "srf-settings__deck-field" });
          deckNameField.createEl("label", { cls: "srf-settings__label", text: "Deck name" });
          const deckNameInput = deckNameField.createEl("input", {
            cls: "srf-settings__input",
            type: "text",
          }) as HTMLInputElement;
          deckNameInput.value = deck.name;

          const deckParentField = grid.createDiv({ cls: "srf-settings__deck-field" });
          deckParentField.createEl("label", { cls: "srf-settings__label", text: "Parent deck" });
          const deckParentSelect = deckParentField.createEl("select", {
            cls: "srf-settings__select",
          }) as HTMLSelectElement;
          const noneOption = deckParentSelect.createEl("option", {
            value: "",
            text: "No parent deck",
          });
          if (!deck.parentDeckId) noneOption.selected = true;

          const blockedParentIds = new Set([
            deck.id,
            ...getDeckDescendantIds(deckRecords, deck.id),
          ]);
          allDeckOptions
            .filter((option) => !blockedParentIds.has(option.id))
            .forEach((option) => {
              const parentOption = deckParentSelect.createEl("option", {
                value: option.id,
                text: option.label,
              });
              if (option.id === deck.parentDeckId) parentOption.selected = true;
            });
          if (deck.id === "default") {
            deckParentSelect.disabled = true;
          }

          const actions = card.createDiv({ cls: "srf-settings__deck-actions" });
          const saveBtn = actions.createEl("button", {
            cls: "srf-btn srf-btn--secondary",
            text: "Save",
          });
          saveBtn.addEventListener("click", () => {
            void this.runDeckMutation(async () => {
              await this.deckService.updateDeck({
                deckId: deck.id,
                name: deckNameInput.value,
                parentDeckId: deckParentSelect.value || null,
              });
            }, "Deck updated.");
          });

          const archiveBtn = actions.createEl("button", {
            cls: "srf-btn srf-btn--ghost",
            text: deck.archived ? "Restore" : "Archive",
          });
          archiveBtn.disabled = deck.id === "default";
          archiveBtn.addEventListener("click", () => {
            void this.runDeckMutation(async () => {
              await this.deckService.setArchived(deck.id, !deck.archived);
            }, deck.archived ? "Deck restored." : "Deck archived.");
          });

          const deleteBtn = actions.createEl("button", {
            cls: "srf-btn srf-btn--danger",
            text: "Delete",
          });
          deleteBtn.disabled = deck.id === "default";
          deleteBtn.addEventListener("click", () => {
            if (!window.confirm(`Delete "${deck.fullPath}" and move its cards into the default deck?`)) {
              return;
            }
            void this.runDeckMutation(async () => {
              await this.deckService.deleteDeck(
                deck.id,
                this.deckService.getDefaultDeckId()
              );
            }, "Deck deleted.");
          });
        });
      }
    );

    this.renderGroup(
      "Sync / Export",
      "Backup and restore your cards without reaching into plugin data by hand.",
      (group) => {
        this.renderSelect(group, "Export format", ["json", "csv"], settings.exportFormat, (v) =>
          this.persistSettings({
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
              await Promise.resolve(this.onDidChange?.());
              this.display();
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
          this.persistSettings({ autoSyncOnVaultChange: v })
        );
        this.renderNumber(group, "Preview debounce (ms)", settings.previewDebounceMs, (v) =>
          this.persistSettings({ previewDebounceMs: v })
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
    this.renderOptionSelect(
      group,
      label,
      options.map((optionValue) => ({ value: optionValue, label: optionValue })),
      value,
      onChange
    );
  }

  private renderOptionSelect(
    group: HTMLElement,
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    onChange: (v: string) => void
  ): void {
    const row = this.renderRow(group, label);
    const select = row.createEl("select", { cls: "srf-settings__select" }) as HTMLSelectElement;
    options.forEach((optionValue) => {
      const option = select.createEl("option", {
        value: optionValue.value,
        text: optionValue.label,
      });
      if (optionValue.value === value) option.selected = true;
    });
    select.addEventListener("change", () => onChange(select.value));
  }

  private renderButton(
    group: HTMLElement,
    label: string,
    btnLabel: string,
    onClick: () => void | Promise<void>
  ): void {
    const row = this.renderRow(group, label);
    const btn = row.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: btnLabel,
    });
    btn.addEventListener("click", () => {
      void Promise.resolve(onClick());
    });
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

  private persistSettings(partial: Partial<PluginSettings>): void {
    void this.service
      .updateSettings(partial)
      .then(() => Promise.resolve(this.onDidChange?.()))
      .catch((error) => {
        console.error("[SRF] Settings update failed:", error);
        new Notice(error instanceof Error ? error.message : "Could not update settings.");
      });
  }

  private async runDeckMutation(
    action: () => Promise<void>,
    successMessage: string
  ): Promise<void> {
    try {
      await action();
      await Promise.resolve(this.onDidChange?.());
      this.display();
      new Notice(successMessage);
    } catch (error) {
      console.error("[SRF] Deck update failed:", error);
      new Notice(error instanceof Error ? error.message : "Could not update deck.");
    }
  }
}
