import { Notice } from "obsidian";
import type { PluginDataRepository } from "../../data/plugin-data-repository";
import type { SelectionContext } from "../../data/source-anchor-resolver";
import type { CardBuilderService, PreviewCardPayload } from "../../services/card-builder-service";
import type { DeckService } from "../../services/deck-service";
import type { GenerateTemplateInput } from "../../parsing/template-generator";

/**
 * Builder panel — card creation surface mounted inside an Obsidian side pane.
 */
export class BuilderDrawer {
  private el: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private service: CardBuilderService;
  private repository: PluginDataRepository;
  private deckService: DeckService;
  private selectionContext?: SelectionContext;
  private onDataChanged?: () => void | Promise<void>;
  private onOpenSourceNote?: (filePath: string) => void;
  private onManageDecks?: () => void;
  private onRequestClose?: () => void;
  private previewTimer: number | null = null;

  private mode: GenerateTemplateInput["mode"] = "basic";
  private frontMarkdown = "";
  private backMarkdown = "";
  private clozeMarkdown = "";
  private deckId = "";
  private isCreatingDeck = false;
  private newDeckName = "";
  private newDeckParentId: string | null = null;

  constructor(
    service: CardBuilderService,
    repository: PluginDataRepository,
    deckService: DeckService,
    onDataChanged?: () => void | Promise<void>,
    onOpenSourceNote?: (filePath: string) => void,
    onManageDecks?: () => void
  ) {
    this.service = service;
    this.repository = repository;
    this.deckService = deckService;
    this.onDataChanged = onDataChanged;
    this.onOpenSourceNote = onOpenSourceNote;
    this.onManageDecks = onManageDecks;
  }

  mount(container: HTMLElement, onRequestClose?: () => void): void {
    this.container = container;
    this.container.addClass("srf-builder-view");
    this.onRequestClose = onRequestClose;
    this.render();
  }

  unmount(): void {
    this.container?.removeClass("srf-builder-view");
    this.clearRendered();
    this.container = null;
    this.onRequestClose = undefined;
  }

  open(
    selectionContext?: SelectionContext,
    modeOverride?: GenerateTemplateInput["mode"]
  ): void {
    this.selectionContext = selectionContext;

    const settings = this.repository.snapshot().settings;
    this.deckId = this.deckService.getDefaultDeckId() || settings.defaultDeckId;
    this.mode = modeOverride ?? settings.defaultCardMode;
    this.frontMarkdown = "";
    this.backMarkdown = "";
    this.clozeMarkdown = "";
    this.isCreatingDeck = false;
    this.newDeckName = "";
    this.newDeckParentId = this.deckId || null;

    if (selectionContext) {
      const text = selectionContext.fileContent.slice(
        selectionContext.startOffset,
        selectionContext.endOffset
      );
      if (this.mode === "cloze") {
        this.clozeMarkdown = makeDefaultCloze(text);
      } else {
        this.frontMarkdown = text;
      }
    }

    this.render();
  }

  private render(): void {
    this.clearRendered();
    if (!this.container) return;

    const drawer = this.container.createDiv({ cls: "srf-builder-drawer" });
    this.el = drawer;

    const header = drawer.createDiv({ cls: "srf-builder-drawer__header" });
    const titleWrap = header.createDiv({ cls: "srf-builder-drawer__title-wrap" });
    titleWrap.createEl("p", { cls: "srf-eyebrow", text: "Card builder" });
    titleWrap.createEl("h2", { cls: "srf-builder-drawer__title", text: "Capture the idea while it is still fresh." });
    titleWrap.createEl("p", {
      cls: "srf-builder-drawer__subtitle",
      text: this.selectionContext
        ? `Source: ${this.selectionContext.noteTitle}`
        : "Choose a note or selection, then shape it into a study card.",
    });

    const closeBtn = header.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Close",
    });
    closeBtn.setAttribute("aria-label", "Close builder");
    closeBtn.addEventListener("click", () => this.close());

    const tabs = drawer.createDiv({ cls: "srf-builder-drawer__mode-tabs" });
    CARD_MODES.forEach(({ mode, label, badge }) => {
      const tab = tabs.createEl("button", {
        cls: `srf-mode-tab${this.mode === mode ? " srf-mode-tab--active" : ""}`,
      });
      tab.createSpan({ cls: "srf-mode-tab__label", text: label });
      tab.createSpan({ cls: "srf-mode-tab__badge", text: badge });
      tab.addEventListener("click", () => this.switchMode(mode));
    });

    const modeInfo = getModeInfo(this.mode);
    const modeHelp = drawer.createDiv({ cls: "srf-panel srf-builder-drawer__mode-help" });
    modeHelp.createEl("strong", { text: modeInfo.title });
    modeHelp.createEl("span", { text: modeInfo.description });

    const body = drawer.createDiv({ cls: "srf-builder-drawer__body" });

    const sourceCard = body.createEl("details", { cls: "srf-panel srf-builder-drawer__source-card" });
    sourceCard.createEl("summary", {
      cls: "srf-builder-drawer__source-summary",
      text: this.selectionContext
        ? `Source context · ${this.selectionContext.noteTitle}`
        : "Source context",
    });
    if (this.selectionContext) {
      sourceCard.createDiv({
        cls: "srf-builder-drawer__source-note",
        text: this.selectionContext.noteTitle,
      });
      sourceCard.createDiv({
        cls: "srf-builder-drawer__source-path",
        text: this.selectionContext.filePath,
      });
      sourceCard.createEl("blockquote", {
        cls: "srf-builder-drawer__excerpt",
        text: this.selectedText(),
      });
    } else {
      sourceCard.createDiv({
        cls: "srf-text-tertiary",
        text: "No source selected.",
      });
    }

    const workspace = body.createDiv({ cls: "srf-builder-drawer__workspace" });

    const formCol = workspace.createDiv({
      cls: "srf-panel srf-builder-drawer__col srf-builder-drawer__col--form",
    });
    formCol.createEl("h3", { cls: "srf-builder-drawer__col-heading", text: "Card content" });
    const form = formCol.createEl("form", { cls: "srf-builder-drawer__form" });

    const deckOptions = this.deckService.getDeckOptions();
    if (!deckOptions.some((deck) => deck.id === this.deckId)) {
      this.deckId = deckOptions[0]?.id ?? "";
    }

    const deckHeader = form.createDiv({ cls: "srf-builder-drawer__deck-header" });
    const deckLabel = deckHeader.createEl("label", { cls: "srf-form-label" });
    deckLabel.textContent = "Deck";
    const deckTools = deckHeader.createDiv({ cls: "srf-builder-drawer__deck-tools" });
    const newDeckBtn = deckTools.createEl("button", {
      cls: `srf-btn ${this.isCreatingDeck ? "srf-btn--ghost" : "srf-btn--secondary"}`,
      text: this.isCreatingDeck ? "Cancel" : "New deck",
      attr: { type: "button" },
    });
    newDeckBtn.addEventListener("click", () => {
      this.isCreatingDeck = !this.isCreatingDeck;
      if (this.isCreatingDeck) {
        this.newDeckName = "";
        this.newDeckParentId = this.deckId || null;
      }
      this.render();
    });
    const manageDecksBtn = deckTools.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Manage decks",
      attr: { type: "button" },
    });
    manageDecksBtn.addEventListener("click", () => this.onManageDecks?.());

    const deckSelect = form.createEl("select", { cls: "srf-select" }) as HTMLSelectElement;
    deckOptions.forEach((deck) => {
      const option = deckSelect.createEl("option", { value: deck.id, text: deck.label });
      if (deck.id === this.deckId) option.selected = true;
    });
    deckSelect.addEventListener("change", () => {
      this.deckId = deckSelect.value;
    });

    if (this.isCreatingDeck) {
      const deckCreate = form.createDiv({ cls: "srf-builder-drawer__deck-create" });

      const nameField = deckCreate.createDiv({ cls: "srf-builder-drawer__deck-create-field" });
      const nameLabel = nameField.createEl("label", { cls: "srf-form-label" });
      nameLabel.textContent = "New deck name";
      const nameInput = nameField.createEl("input", {
        cls: "srf-input",
        type: "text",
        placeholder: "Deck name",
      }) as HTMLInputElement;
      nameInput.value = this.newDeckName;
      nameInput.addEventListener("input", () => {
        this.newDeckName = nameInput.value;
      });

      const parentField = deckCreate.createDiv({ cls: "srf-builder-drawer__deck-create-field" });
      const parentLabel = parentField.createEl("label", { cls: "srf-form-label" });
      parentLabel.textContent = "Parent deck";
      const parentSelect = parentField.createEl("select", {
        cls: "srf-select",
      }) as HTMLSelectElement;
      const rootOption = parentSelect.createEl("option", {
        value: "",
        text: "No parent deck",
      });
      if (!this.newDeckParentId) rootOption.selected = true;
      deckOptions.forEach((deck) => {
        const option = parentSelect.createEl("option", {
          value: deck.id,
          text: deck.label,
        });
        if (deck.id === this.newDeckParentId) option.selected = true;
      });
      parentSelect.addEventListener("change", () => {
        this.newDeckParentId = parentSelect.value || null;
      });

      const createActions = deckCreate.createDiv({ cls: "srf-builder-drawer__deck-create-actions" });
      const createBtn = createActions.createEl("button", {
        cls: "srf-btn srf-btn--primary",
        text: "Create deck",
        attr: { type: "button" },
      });
      createBtn.addEventListener("click", () => void this.createDeckInline());
    }

    if (this.mode === "cloze") {
      const clozeLabel = form.createEl("label", { cls: "srf-form-label" });
      clozeLabel.textContent = "Cloze text";
      const clozeArea = form.createEl("textarea", {
        cls: "srf-textarea",
        attr: { rows: "6", placeholder: "Use {{c1::hidden text}} syntax" },
      }) as HTMLTextAreaElement;
      clozeArea.value = this.clozeMarkdown || this.frontMarkdown;
      clozeArea.addEventListener("input", () => {
        this.clozeMarkdown = clozeArea.value;
        this.schedulePreview(previewCol);
      });
    } else {
      const frontLabel = form.createEl("label", { cls: "srf-form-label" });
      frontLabel.textContent = "Front";
      const frontArea = form.createEl("textarea", {
        cls: "srf-textarea",
        attr: { rows: "4", placeholder: "Prompt or question" },
      }) as HTMLTextAreaElement;
      frontArea.value = this.frontMarkdown;
      frontArea.addEventListener("input", () => {
        this.frontMarkdown = frontArea.value;
        this.schedulePreview(previewCol);
      });

      const backLabel = form.createEl("label", { cls: "srf-form-label" });
      backLabel.textContent = "Back";
      const backArea = form.createEl("textarea", {
        cls: "srf-textarea",
        attr: { rows: "5", placeholder: "Answer or explanation" },
      }) as HTMLTextAreaElement;
      backArea.value = this.backMarkdown;
      backArea.addEventListener("input", () => {
        this.backMarkdown = backArea.value;
        this.schedulePreview(previewCol);
      });
    }

    const actions = form.createDiv({ cls: "srf-builder-drawer__actions" });

    const saveBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: "Save Card",
      attr: { type: "button" },
    });
    saveBtn.addEventListener("click", () => this.save(false));

    const saveNextBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: "Save & Add Another",
      attr: { type: "button" },
    });
    saveNextBtn.addEventListener("click", () => this.save(true));

    if (this.selectionContext?.filePath) {
      const sourceBtn = actions.createEl("button", {
        cls: "srf-btn srf-btn--ghost",
        text: "Open Source Note",
        attr: { type: "button" },
      });
      sourceBtn.addEventListener("click", () => {
        if (this.selectionContext?.filePath) {
          const filePath = this.selectionContext.filePath;
          this.close();
          this.onOpenSourceNote?.(filePath);
        }
      });
    }

    const previewCol = workspace.createDiv({
      cls: "srf-panel srf-builder-drawer__col srf-builder-drawer__col--preview",
    });
    previewCol.createEl("h3", { cls: "srf-builder-drawer__col-heading", text: "Preview" });
    this.refreshPreview(previewCol);
  }

  private switchMode(mode: GenerateTemplateInput["mode"]): void {
    if (mode === this.mode) return;

    if (mode === "cloze" && !this.clozeMarkdown.trim()) {
      const sourceText = this.frontMarkdown || this.selectedText();
      this.clozeMarkdown = makeDefaultCloze(sourceText);
    }

    if (mode !== "cloze" && !this.frontMarkdown.trim() && this.clozeMarkdown.trim()) {
      this.frontMarkdown = stripClozeSyntax(this.clozeMarkdown);
    }

    this.mode = mode;
    this.render();
  }

  private selectedText(): string {
    if (!this.selectionContext) return "";
    return this.selectionContext.fileContent.slice(
      this.selectionContext.startOffset,
      this.selectionContext.endOffset
    );
  }

  private schedulePreview(col: HTMLElement): void {
    this.clearPreviewTimer();
    const delay = this.repository.snapshot().settings.previewDebounceMs;
    this.previewTimer = window.setTimeout(() => {
      this.refreshPreview(col);
      this.previewTimer = null;
    }, delay);
  }

  private refreshPreview(col: HTMLElement): void {
    const existing = col.querySelector(".srf-builder-preview");
    if (existing) existing.remove();

    const preview = col.createDiv({ cls: "srf-builder-preview" });

    let payloads: PreviewCardPayload[] = [];
    try {
      payloads = this.service.previewTemplate({
        mode: this.mode,
        deckId: this.deckId,
        tagIds: [],
        frontMarkdown: this.frontMarkdown,
        backMarkdown: this.backMarkdown,
        clozeMarkdown: this.mode === "cloze" ? this.clozeMarkdown : undefined,
      });
    } catch {
      preview.createEl("p", { cls: "srf-text-tertiary", text: "Nothing to preview yet." });
      return;
    }

    payloads.forEach((payload) => {
      const card = preview.createDiv({ cls: "srf-builder-preview__card" });
      card.createDiv({ cls: "srf-builder-preview__label", text: "Prompt" });
      const front = card.createDiv({ cls: "srf-builder-preview__front" });
      front.textContent = payload.promptMarkdown;
      card.createDiv({ cls: "srf-builder-preview__divider" });
      card.createDiv({ cls: "srf-builder-preview__label", text: "Answer" });
      const back = card.createDiv({ cls: "srf-builder-preview__back" });
      back.textContent = payload.answerMarkdown;
    });
  }

  private async save(addAnother: boolean): Promise<void> {
    if (!this.selectionContext) {
      new Notice("Pick a source note or selection first.");
      return;
    }

    try {
      await this.service.createFromSelection({
        selectionContext: this.selectionContext,
        mode: this.mode,
        deckId: this.deckId,
        tagIds: [],
        frontMarkdown: this.frontMarkdown,
        backMarkdown: this.backMarkdown,
        clozeMarkdown: this.mode === "cloze" ? this.clozeMarkdown : undefined,
      });
      await Promise.resolve(this.onDataChanged?.());
      new Notice("Card saved.");

      if (addAnother) {
        this.frontMarkdown = "";
        this.backMarkdown = "";
        this.clozeMarkdown = "";
        this.render();
      } else {
        this.close();
      }
    } catch (err) {
      console.error("[SRF] Save card failed:", err);
      const message = err instanceof Error ? err.message : "Could not save card.";
      new Notice(message);
    }
  }

  close(): void {
    this.clearRendered();
    this.onRequestClose?.();
  }

  private async createDeckInline(): Promise<void> {
    try {
      const deck = await this.deckService.createDeck({
        name: this.newDeckName,
        parentDeckId: this.newDeckParentId,
      });
      this.deckId = deck.id;
      this.isCreatingDeck = false;
      this.newDeckName = "";
      this.newDeckParentId = deck.id;
      await Promise.resolve(this.onDataChanged?.());
      new Notice(`Created deck: ${deck.name}`);
      this.render();
    } catch (error) {
      console.error("[SRF] Create deck failed:", error);
      new Notice(error instanceof Error ? error.message : "Could not create deck.");
    }
  }

  private clearRendered(): void {
    this.clearPreviewTimer();
    this.container?.empty();
    this.el = null;
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }
}

const CARD_MODES: Array<{
  mode: GenerateTemplateInput["mode"];
  label: string;
  badge: string;
  title: string;
  description: string;
}> = [
  {
    mode: "basic",
    label: "Basic",
    badge: "1 card",
    title: "Basic: Front -> Back",
    description: "A simple prompt and answer. Ideal for definitions, facts, and direct recall.",
  },
  {
    mode: "reverse",
    label: "Reverse",
    badge: "2 cards",
    title: "Reverse: Front <-> Back",
    description: "Generate both directions when recall should work either way.",
  },
  {
    mode: "cloze",
    label: "Cloze",
    badge: "blank",
    title: "Cloze: fill the blank",
    description: "Hide only the crucial fragment and keep the surrounding context visible.",
  },
];

function getModeInfo(mode: GenerateTemplateInput["mode"]) {
  return CARD_MODES.find((entry) => entry.mode === mode) ?? CARD_MODES[0];
}

function makeDefaultCloze(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/\{\{c\d+::.+?\}\}/.test(trimmed)) return trimmed;
  return `{{c1::${trimmed}}}`;
}

function stripClozeSyntax(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)(?:::.+?)?\}\}/g, "$1");
}
