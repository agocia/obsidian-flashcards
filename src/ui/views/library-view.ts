import { Notice } from "obsidian";
import type { LibraryQueryInput, LibraryRow, LibraryService } from "../../services/library-service";
import { renderFilterBar } from "../components/filter-bar";
import { renderStateBanner } from "../components/state-banner";

export const LIBRARY_VIEW_TYPE = "srf-library";

type BulkEditorAction = "move" | "tag" | null;

export interface LibraryViewOptionsPayload {
  decks: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; label: string }>;
  sourceFiles: string[];
}

/**
 * Library view — searchable, filterable card table with inline bulk editing.
 */
export class LibraryView {
  private container: HTMLElement;
  private service: LibraryService;
  private decks: Array<{ id: string; name: string }> = [];
  private tags: Array<{ id: string; label: string }> = [];
  private sourceFiles: string[] = [];
  private onCreateCard?: () => void;
  private onOpenSourceNote?: (filePath: string) => void;
  private loadOptions?: () =>
    | Promise<LibraryViewOptionsPayload>
    | LibraryViewOptionsPayload;

  private query: LibraryQueryInput = {
    search: "",
    deckIds: [],
    tagIds: [],
    sourceFile: null,
    states: [],
    sortBy: "due",
    sortDirection: "asc",
  };

  private selectedRowIds = new Set<string>();
  private bulkHost: HTMLElement | null = null;
  private lastRows: LibraryRow[] = [];
  private activeBulkEditor: BulkEditorAction = null;
  private bulkDeckId = "";
  private bulkTagValue = "";
  private isApplyingBulkAction = false;

  constructor(
    container: HTMLElement,
    service: LibraryService,
    decks: Array<{ id: string; name: string }>,
    tags: Array<{ id: string; label: string }>,
    sourceFiles: string[] = [],
    onCreateCard?: () => void,
    onOpenSourceNote?: (filePath: string) => void,
    loadOptions?: () => Promise<LibraryViewOptionsPayload> | LibraryViewOptionsPayload
  ) {
    this.container = container;
    this.service = service;
    this.decks = decks;
    this.tags = tags;
    this.sourceFiles = sourceFiles;
    this.onCreateCard = onCreateCard;
    this.onOpenSourceNote = onOpenSourceNote;
    this.loadOptions = loadOptions;
  }

  async render(): Promise<void> {
    this.container.empty();
    this.container.addClass("srf-view", "srf-library");

    await this.refreshOptions();

    const shell = this.container.createDiv({ cls: "srf-library__shell" });

    const result = await this.renderContent(shell);
    if (!result) return;

    this.lastRows = result.rows;
    const visibleIds = new Set(result.rows.map((row) => row.cardId));
    this.selectedRowIds.forEach((id) => {
      if (!visibleIds.has(id)) this.selectedRowIds.delete(id);
    });
  }

  private async renderContent(shell: HTMLElement): Promise<{ total: number; rows: LibraryRow[] } | null> {
    let result;
    try {
      result = await this.service.query(this.query);
    } catch {
      this.renderHero(shell, 0, 0);
      renderStateBanner(shell, {
        kind: "error",
        headline: "Failed to load library",
        body: "Try reloading the plugin.",
      });
      return null;
    }

    const suspendedCount = result.rows.filter((row) => row.state === "suspended").length;
    this.renderHero(shell, result.total, suspendedCount);

    const contentCard = shell.createDiv({ cls: "srf-panel srf-library__content" });

    const filterWrap = contentCard.createDiv({ cls: "srf-library__filter-bar" });
    renderFilterBar(filterWrap, {
      searchValue: this.query.search,
      sourceFileValue: this.query.sourceFile ?? "",
      sourceFiles: this.sourceFiles,
      decks: this.decks,
      tags: this.tags,
      selectedDeckId: this.query.deckIds[0] ?? "",
      selectedTagId: this.query.tagIds[0] ?? "",
      selectedState: this.query.states[0] ?? "",
      sortBy: this.query.sortBy,
      onSearchChange: (v) => this.update({ search: v }),
      onSourceFileChange: (value) => this.update({ sourceFile: value || null }),
      onDeckChange: (id) => this.update({ deckIds: id ? [id] : [] }),
      onTagChange: (id) => this.update({ tagIds: id ? [id] : [] }),
      onStateChange: (state) =>
        this.update({ states: state ? ([state] as LibraryQueryInput["states"]) : [] }),
      onSortChange: (sort) => this.update({ sortBy: sort as LibraryQueryInput["sortBy"] }),
    });

    if (result.rows.length === 0) {
      renderStateBanner(contentCard, {
        kind: "empty",
        headline: "No cards match these filters",
        body: "Try changing the search or create a fresh card to start building your library.",
        ctaLabel: "Create Card",
        onCta: () => this.onCreateCard?.(),
      });
      return result;
    }

    const tableWrap = contentCard.createDiv({ cls: "srf-library__table-wrap" });
    const table = tableWrap.createEl("table", { cls: "srf-library__table" });

    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    ["", "Prompt", "Deck", "Source Note", "Tags", "Due", "Ease", "Status"].forEach((col) => {
      headerRow.createEl("th", { cls: "srf-library__th", text: col });
    });

    const tbody = table.createEl("tbody");
    result.rows.forEach((row) => {
      const tr = tbody.createEl("tr", { cls: "srf-library__row" });
      this.applyRowSelectionState(tr, row.cardId);

      tr.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button,input,select,textarea,a,label")) return;
        const nextChecked = !this.selectedRowIds.has(row.cardId);
        this.toggleRowSelection(row.cardId, nextChecked, tr);
        const checkbox = tr.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox) checkbox.checked = nextChecked;
      });

      const checkTd = tr.createEl("td", { cls: "srf-library__td srf-library__td--check" });
      const checkbox = checkTd.createEl("input") as HTMLInputElement;
      checkbox.type = "checkbox";
      checkbox.checked = this.selectedRowIds.has(row.cardId);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        this.toggleRowSelection(row.cardId, checkbox.checked, tr);
      });

      const promptTd = tr.createEl("td", {
        cls: "srf-library__td srf-library__td--prompt",
      });
      promptTd.createDiv({ cls: "srf-library__prompt-text", text: row.promptText });
      promptTd.createDiv({
        cls: "srf-library__prompt-meta",
        text: row.sourceFile ? fileLabel(row.sourceFile) : "No source note",
      });

      tr.createEl("td", { cls: "srf-library__td srf-library__td--deck", text: row.deckName });

      const sourceTd = tr.createEl("td", {
        cls: "srf-library__td srf-library__td--source-note",
      });
      const sourceBtn = sourceTd.createEl("button", {
        cls: "srf-btn srf-btn--ghost srf-library__source-note-btn",
        text: row.sourceNoteTitle || fileLabel(row.sourceFile),
      });
      sourceBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (row.sourceFile) {
          this.onOpenSourceNote?.(row.sourceFile);
        }
      });
      if (!row.sourceFile) {
        sourceBtn.disabled = true;
      } else {
        sourceBtn.setAttribute("title", row.sourceFile);
      }

      const tagsTd = tr.createEl("td", { cls: "srf-library__td srf-library__td--tags" });
      if (row.tags.length > 0) {
        row.tags.forEach((tag) => tagsTd.createSpan({ cls: "srf-tag-pill", text: tag }));
      } else {
        tagsTd.createSpan({ cls: "srf-library__empty-meta", text: "No tags" });
      }

      tr.createEl("td", {
        cls: "srf-library__td srf-library__td--due",
        text: row.dueAt ? formatDue(row.dueAt) : "—",
      });
      tr.createEl("td", {
        cls: "srf-library__td srf-library__td--ease",
        text: row.difficulty != null ? row.difficulty.toFixed(1) : "—",
      });

      const stateTd = tr.createEl("td", {
        cls: `srf-library__td srf-library__td--state srf-library__state-badge srf-library__state-badge--${row.state}`,
      });
      stateTd.textContent = row.state;
    });

    this.bulkHost = contentCard.createDiv({ cls: "srf-library__bulk-host" });
    this.renderBulkBar();

    return result;
  }

  private renderHero(shell: HTMLElement, total: number, suspendedCount: number): void {
    const hero = shell.createDiv({ cls: "srf-panel srf-library__hero" });
    const copy = hero.createDiv({ cls: "srf-library__hero-copy" });
    copy.createEl("p", { cls: "srf-eyebrow", text: "Card Library" });
    copy.createEl("h1", { cls: "srf-library__title", text: "Shape the collection, not just the table." });
    copy.createEl("p", {
      cls: "srf-library__subtitle",
      text: "Filter by deck, source, and state. Then act on groups with a dedicated action tray instead of modal prompts.",
    });

    const stats = hero.createDiv({ cls: "srf-library__hero-stats" });
    this.renderHeroStat(stats, "Visible cards", String(total));
    this.renderHeroStat(stats, "Suspended", String(suspendedCount));
    this.renderHeroStat(stats, "Selected", String(this.selectedRowIds.size));
  }

  private renderHeroStat(container: HTMLElement, label: string, value: string): void {
    const stat = container.createDiv({ cls: "srf-library__hero-stat" });
    stat.createDiv({ cls: "srf-library__hero-stat-value", text: value });
    stat.createDiv({ cls: "srf-library__hero-stat-label", text: label });
  }

  private renderBulkBar(): void {
    if (!this.bulkHost) return;

    this.bulkHost.empty();
    if (this.selectedRowIds.size === 0) {
      this.activeBulkEditor = null;
      return;
    }

    const selectedRows = this.lastRows.filter((row) => this.selectedRowIds.has(row.cardId));
    const hasSuspended = selectedRows.some((row) => row.state === "suspended");
    const hasActive = selectedRows.some((row) => row.state !== "suspended");

    const bar = this.bulkHost.createDiv({ cls: "srf-library__bulk-bar" });

    const summary = bar.createDiv({ cls: "srf-library__bulk-summary" });
    summary.createDiv({
      cls: "srf-library__bulk-title",
      text: `${this.selectedRowIds.size} card${this.selectedRowIds.size === 1 ? "" : "s"} selected`,
    });
    const summaryMeta = summary.createDiv({ cls: "srf-library__bulk-meta" });
    if (hasActive) summaryMeta.createSpan({ cls: "srf-tag-pill", text: `${selectedRows.filter((row) => row.state !== "suspended").length} active` });
    if (hasSuspended) summaryMeta.createSpan({ cls: "srf-tag-pill", text: `${selectedRows.filter((row) => row.state === "suspended").length} suspended` });

    const actions = bar.createDiv({ cls: "srf-library__bulk-actions" });
    actions.appendChild(
      this.renderEditorToggle("Move", "move", !this.isApplyingBulkAction)
    );
    actions.appendChild(
      this.renderEditorToggle("Add tags", "tag", !this.isApplyingBulkAction)
    );
    actions.appendChild(
      this.renderQuickAction("Suspend", () => this.applySuspendState(true), hasActive)
    );
    actions.appendChild(
      this.renderQuickAction("Unsuspend", () => this.applySuspendState(false), hasSuspended)
    );
    actions.appendChild(
      this.renderQuickAction("Delete", () => this.deleteSelection(), true, "srf-btn--danger")
    );

    const clearBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Clear",
    });
    clearBtn.disabled = this.isApplyingBulkAction;
    clearBtn.addEventListener("click", () => {
      this.selectedRowIds.clear();
      this.activeBulkEditor = null;
      this.renderBulkBar();
    });

    if (this.activeBulkEditor) {
      const editor = bar.createDiv({ cls: "srf-library__bulk-editor" });
      if (this.activeBulkEditor === "move") {
        this.renderMoveEditor(editor);
      } else if (this.activeBulkEditor === "tag") {
        this.renderTagEditor(editor);
      }
    }
  }

  private renderEditorToggle(label: string, action: Exclude<BulkEditorAction, null>, enabled: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `srf-btn ${this.activeBulkEditor === action ? "srf-btn--primary" : "srf-btn--secondary"}`;
    button.textContent = label;
    button.disabled = !enabled;
    button.addEventListener("click", () => {
      if (this.activeBulkEditor === action) {
        this.activeBulkEditor = null;
      } else {
        this.activeBulkEditor = action;
        if (action === "move" && !this.bulkDeckId) {
          this.bulkDeckId = this.query.deckIds[0] ?? this.decks[0]?.id ?? "";
        }
      }
      this.renderBulkBar();
    });
    return button;
  }

  private renderQuickAction(
    label: string,
    onClick: () => void,
    enabled: boolean,
    extraClass = ""
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `srf-btn srf-btn--secondary ${extraClass}`.trim();
    button.textContent = label;
    button.disabled = !enabled || this.isApplyingBulkAction;
    button.addEventListener("click", onClick);
    return button;
  }

  private renderMoveEditor(editor: HTMLElement): void {
    const label = editor.createDiv({ cls: "srf-library__bulk-editor-label", text: "Move selected cards to deck" });
    const select = editor.createEl("select", { cls: "srf-select srf-library__bulk-select" }) as HTMLSelectElement;
    this.decks.forEach((deck) => {
      const option = select.createEl("option", { value: deck.id, text: deck.name });
      if (deck.id === this.bulkDeckId) option.selected = true;
    });
    select.addEventListener("change", () => {
      this.bulkDeckId = select.value;
    });

    const apply = editor.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: "Apply move",
    });
    apply.disabled = this.isApplyingBulkAction || !this.bulkDeckId;
    apply.addEventListener("click", () => this.applyMove());
  }

  private renderTagEditor(editor: HTMLElement): void {
    editor.createDiv({ cls: "srf-library__bulk-editor-label", text: "Add comma-separated tags" });
    const input = editor.createEl("input", {
      cls: "srf-input srf-library__bulk-input",
      type: "text",
      placeholder: "biology, chapter-3, formulas",
    }) as HTMLInputElement;
    input.value = this.bulkTagValue;
    input.addEventListener("input", () => {
      this.bulkTagValue = input.value;
    });

    const apply = editor.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: "Apply tags",
    });
    apply.disabled = this.isApplyingBulkAction || !this.bulkTagValue.trim();
    apply.addEventListener("click", () => this.applyTags());
  }

  private async applyMove(): Promise<void> {
    if (!this.bulkDeckId) {
      new Notice("Choose a deck first.");
      return;
    }
    await this.executeBulkAction(async () => {
      await this.service.bulkUpdate({
        action: "move",
        cardIds: Array.from(this.selectedRowIds),
        deckId: this.bulkDeckId,
      });
      new Notice("Cards moved.");
    });
  }

  private async applyTags(): Promise<void> {
    const tagIds = this.bulkTagValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (tagIds.length === 0) {
      new Notice("Add at least one tag.");
      return;
    }

    await this.executeBulkAction(async () => {
      await this.service.bulkUpdate({
        action: "tag",
        cardIds: Array.from(this.selectedRowIds),
        tagIds,
        createMissingTags: true,
      });
      new Notice("Tags applied.");
    });
  }

  private async applySuspendState(suspended: boolean): Promise<void> {
    await this.executeBulkAction(async () => {
      await this.service.bulkUpdate({
        action: "suspend",
        cardIds: Array.from(this.selectedRowIds),
        suspended,
      });
      new Notice(suspended ? "Cards suspended." : "Cards unsuspended.");
    });
  }

  private async deleteSelection(): Promise<void> {
    if (!window.confirm(`Delete ${this.selectedRowIds.size} selected card${this.selectedRowIds.size === 1 ? "" : "s"}?`)) {
      return;
    }

    await this.executeBulkAction(async () => {
      await this.service.bulkUpdate({
        action: "delete",
        cardIds: Array.from(this.selectedRowIds),
      });
      new Notice("Cards deleted.");
    });
  }

  private async executeBulkAction(action: () => Promise<void>): Promise<void> {
    if (this.selectedRowIds.size === 0 || this.isApplyingBulkAction) return;

    this.isApplyingBulkAction = true;
    this.renderBulkBar();

    try {
      await action();
      this.selectedRowIds.clear();
      this.activeBulkEditor = null;
      this.bulkTagValue = "";
      await this.render();
    } catch (error) {
      console.error("[SRF] Library bulk action failed:", error);
      new Notice(error instanceof Error ? error.message : "Could not update selected cards.");
      this.isApplyingBulkAction = false;
      this.renderBulkBar();
      return;
    }

    this.isApplyingBulkAction = false;
  }

  private applyRowSelectionState(rowEl: HTMLElement, cardId: string): void {
    if (this.selectedRowIds.has(cardId)) {
      rowEl.addClass("srf-library__row--selected");
    } else {
      rowEl.removeClass("srf-library__row--selected");
    }
  }

  private toggleRowSelection(cardId: string, checked: boolean, rowEl: HTMLElement): void {
    if (checked) this.selectedRowIds.add(cardId);
    else this.selectedRowIds.delete(cardId);
    this.applyRowSelectionState(rowEl, cardId);
    this.renderBulkBar();
  }

  private async refreshOptions(): Promise<void> {
    if (!this.loadOptions) return;
    const options = await this.loadOptions();
    this.decks = options.decks;
    this.tags = options.tags;
    this.sourceFiles = options.sourceFiles;
  }

  private async update(partial: Partial<LibraryQueryInput>): Promise<void> {
    this.query = { ...this.query, ...partial };
    await this.render();
  }
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return `${diffDays}d`;
}

function fileLabel(path: string): string {
  if (!path) return "No source note";
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
