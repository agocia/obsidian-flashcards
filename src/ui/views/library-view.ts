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
  private newDeckName = "";
  private moveDeckName = "";
  private isDeckEditorOpen = false;
  private isCreatingDeck = false;
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

    this.renderListToolbar(contentCard, result.rows);

    const list = contentCard.createDiv({ cls: "srf-library__list" });
    list.setAttribute("role", "list");

    result.rows.forEach((row) => {
      const cardEl = list.createDiv({
        cls: `srf-library-card srf-library-card--${row.state}`,
      });
      cardEl.setAttribute("role", "listitem");
      this.applyRowSelectionState(cardEl, row.cardId);

      cardEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button,input,select,textarea,a,label")) return;
        const nextChecked = !this.selectedRowIds.has(row.cardId);
        this.toggleRowSelection(row.cardId, nextChecked, cardEl);
        const checkbox = cardEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox) checkbox.checked = nextChecked;
      });

      const checkLabel = cardEl.createEl("label", { cls: "srf-library-card__check" });
      const checkbox = checkLabel.createEl("input") as HTMLInputElement;
      checkbox.type = "checkbox";
      checkbox.checked = this.selectedRowIds.has(row.cardId);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        this.toggleRowSelection(row.cardId, checkbox.checked, cardEl);
      });
      checkLabel.createSpan({ cls: "srf-library-card__check-mark" });

      const body = cardEl.createDiv({ cls: "srf-library-card__body" });
      const header = body.createDiv({ cls: "srf-library-card__header" });
      const copy = header.createDiv({ cls: "srf-library-card__copy" });
      copy.createDiv({
        cls: "srf-library-card__prompt",
        text: row.promptText || "Untitled prompt",
      });
      copy.createDiv({
        cls: "srf-library-card__source-path",
        text: row.sourceFile ? fileLabel(row.sourceFile) : "No source note",
      });

      const stateBadge = header.createSpan({
        cls: `srf-library-card__state srf-library-card__state--${row.state}`,
        text: row.state,
      });
      stateBadge.setAttribute("aria-label", `Card state: ${row.state}`);

      const tags = body.createDiv({ cls: "srf-library-card__tags" });
      if (row.tags.length > 0) {
        row.tags.forEach((tag) => tags.createSpan({ cls: "srf-tag-pill", text: tag }));
      } else {
        tags.createSpan({ cls: "srf-library-card__empty-meta", text: "No tags yet" });
      }

      const meta = body.createDiv({ cls: "srf-library-card__meta-grid" });
      this.renderMetaItem(meta, "Deck", row.deckName || "No deck");
      this.renderMetaItem(meta, "Due", row.dueAt ? formatDue(row.dueAt) : "Not scheduled");
      this.renderMetaItem(meta, "Ease", row.difficulty != null ? row.difficulty.toFixed(1) : "Fresh");

      const sourceItem = meta.createDiv({ cls: "srf-library-card__meta-item srf-library-card__meta-item--source" });
      sourceItem.createDiv({ cls: "srf-library-card__meta-label", text: "Source" });
      const sourceBtn = sourceItem.createEl("button", {
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
    const actions = copy.createDiv({ cls: "srf-library__hero-actions" });
    const createDeckBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: this.isDeckEditorOpen ? "Hide deck form" : "New Deck",
    });
    createDeckBtn.addEventListener("click", () => {
      this.isDeckEditorOpen = !this.isDeckEditorOpen;
      void this.render();
    });
    const createCardBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Create Card",
    });
    createCardBtn.addEventListener("click", () => this.onCreateCard?.());
    if (this.isDeckEditorOpen) {
      this.renderDeckEditor(copy, {
        value: this.newDeckName,
        placeholder: "Exam deck, Biology, Japanese...",
        buttonLabel: "Create deck",
        onInput: (value) => {
          this.newDeckName = value;
        },
        onCreate: () => this.createDeckFromName(this.newDeckName),
        onCancel: () => {
          this.isDeckEditorOpen = false;
          this.newDeckName = "";
          void this.render();
        },
      });
    }

    const stats = hero.createDiv({ cls: "srf-library__hero-stats" });
    this.renderHeroStat(stats, "Visible cards", String(total));
    this.renderHeroStat(stats, "Suspended", String(suspendedCount));
    this.renderHeroStat(stats, "Selected", String(this.selectedRowIds.size));
  }

  private renderListToolbar(container: HTMLElement, rows: LibraryRow[]): void {
    const toolbar = container.createDiv({ cls: "srf-library__list-toolbar" });
    const copy = toolbar.createDiv({ cls: "srf-library__list-toolbar-copy" });
    copy.createDiv({ cls: "srf-library__list-count", text: `${rows.length} visible card${rows.length === 1 ? "" : "s"}` });
    copy.createDiv({
      cls: "srf-library__list-hint",
      text: "Select cards, then move, tag, suspend, unsuspend, or delete from the action tray.",
    });

    const actions = toolbar.createDiv({ cls: "srf-library__list-toolbar-actions" });
    const visibleIds = rows.map((row) => row.cardId);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => this.selectedRowIds.has(id));
    const selectBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: allVisibleSelected ? "Clear visible" : "Select visible",
    });
    selectBtn.addEventListener("click", () => {
      if (allVisibleSelected) {
        visibleIds.forEach((id) => this.selectedRowIds.delete(id));
      } else {
        visibleIds.forEach((id) => this.selectedRowIds.add(id));
      }
      void this.render();
    });
  }

  private renderMetaItem(container: HTMLElement, label: string, value: string): void {
    const item = container.createDiv({ cls: "srf-library-card__meta-item" });
    item.createDiv({ cls: "srf-library-card__meta-label", text: label });
    item.createDiv({ cls: "srf-library-card__meta-value", text: value });
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
    editor.createDiv({ cls: "srf-library__bulk-editor-label", text: "Move selected cards to deck" });
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

    const createInline = editor.createDiv({ cls: "srf-library__bulk-editor-inline" });
    this.renderDeckEditor(createInline, {
      value: this.moveDeckName,
      placeholder: "Create deck then move here",
      buttonLabel: "Create & select",
      compact: true,
      onInput: (value) => {
        this.moveDeckName = value;
      },
      onCreate: () =>
        this.createDeckFromName(this.moveDeckName, {
          selectForMove: true,
        }),
    });
  }

  private renderTagEditor(editor: HTMLElement): void {
    editor.createDiv({ cls: "srf-library__bulk-editor-label", text: "Add comma-separated tags" });
    const input = editor.createEl("input", {
      cls: "srf-input srf-library__bulk-input",
      type: "text",
      placeholder: "biology, chapter-3, formulas",
    }) as HTMLInputElement;
    input.value = this.bulkTagValue;

    const apply = editor.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: "Apply tags",
    });
    const syncApplyState = () => {
      apply.disabled = this.isApplyingBulkAction || !this.bulkTagValue.trim();
    };
    input.addEventListener("input", () => {
      this.bulkTagValue = input.value;
      syncApplyState();
    });
    syncApplyState();
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

  private renderDeckEditor(
    container: HTMLElement,
    opts: {
      value: string;
      placeholder: string;
      buttonLabel: string;
      compact?: boolean;
      onInput: (value: string) => void;
      onCreate: () => void;
      onCancel?: () => void;
    }
  ): void {
    const form = container.createEl("form", {
      cls: opts.compact ? "srf-deck-editor srf-deck-editor--compact" : "srf-deck-editor",
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      opts.onCreate();
    });

    if (!opts.compact) {
      form.createDiv({
        cls: "srf-deck-editor__label",
        text: "Create a deck",
      });
    }

    const input = form.createEl("input", {
      cls: "srf-input srf-deck-editor__input",
      type: "text",
      placeholder: opts.placeholder,
    }) as HTMLInputElement;
    input.value = opts.value;

    const create = form.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: opts.buttonLabel,
      attr: { type: "button" },
    }) as HTMLButtonElement;
    const syncState = () => {
      create.disabled = this.isCreatingDeck || !input.value.trim();
    };
    input.addEventListener("input", () => {
      opts.onInput(input.value);
      syncState();
    });
    syncState();
    create.addEventListener("click", opts.onCreate);

    if (opts.onCancel) {
      const cancel = form.createEl("button", {
        cls: "srf-btn srf-btn--ghost",
        text: "Cancel",
        attr: { type: "button" },
      });
      cancel.addEventListener("click", opts.onCancel);
    }
  }

  private async createDeckFromName(
    name: string,
    options: { selectForMove?: boolean } = {}
  ): Promise<void> {
    if (this.isCreatingDeck) return;
    const trimmed = name.trim();
    if (!trimmed) {
      new Notice("Deck name is required.");
      return;
    }

    this.isCreatingDeck = true;
    let shouldRender = false;
    try {
      const deck = await this.service.createDeck({ name: trimmed });
      await this.refreshOptions();
      if (options.selectForMove) {
        this.bulkDeckId = deck.id;
        this.activeBulkEditor = "move";
      }
      this.newDeckName = "";
      this.moveDeckName = "";
      this.isDeckEditorOpen = false;
      shouldRender = true;
      new Notice(`Deck created: ${deck.name}`);
    } catch (error) {
      console.error("[SRF] Create deck failed:", error);
      new Notice(error instanceof Error ? error.message : "Could not create deck.");
    } finally {
      this.isCreatingDeck = false;
    }

    if (shouldRender) {
      await this.render();
    } else {
      this.renderBulkBar();
    }
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
      rowEl.addClass("srf-library-card--selected");
    } else {
      rowEl.removeClass("srf-library__row--selected");
      rowEl.removeClass("srf-library-card--selected");
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
