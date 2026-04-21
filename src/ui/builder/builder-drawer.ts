import { Notice } from "obsidian";
import type { PluginDataRepository } from "../../data/plugin-data-repository";
import type { SelectionContext } from "../../data/source-anchor-resolver";
import type { CardBuilderService, PreviewCardPayload } from "../../services/card-builder-service";
import type { GenerateTemplateInput } from "../../parsing/template-generator";
import type { SourceAnchor } from "../../domain/models";

type DeckOption = { id: string; name: string };
type SaveCardEditInput = {
  cardId: string;
  promptMarkdown: string;
  answerMarkdown: string;
  deckId: string;
};

/**
 * Builder panel — card creation surface mounted inside an Obsidian side pane.
 */
export class BuilderDrawer {
  private el: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private service: CardBuilderService;
  private repository: PluginDataRepository;
  private selectionContext?: SelectionContext;
  private onCreated?: () => void;
  private onOpenSourceNote?: (filePath: string) => void;
  private onPickSourceNote?: (
    modeOverride: GenerateTemplateInput["mode"],
    onAttach: (selectionContext: SelectionContext) => void
  ) => void;
  private onCreateDeck?: (name: string) => Promise<DeckOption>;
  private onSaveCardEdit?: (input: SaveCardEditInput) => Promise<unknown>;
  private onRequestClose?: () => void;
  private previewTimer: number | null = null;

  private editingCardId: string | null = null;
  private editingVariantKey = "";
  private editingSourceAnchor: SourceAnchor | null = null;
  private mode: GenerateTemplateInput["mode"] = "basic";
  private frontMarkdown = "";
  private backMarkdown = "";
  private clozeMarkdown = "";
  private deckId = "";
  private newDeckName = "";
  private isDeckCreatorOpen = false;
  private isCreatingDeck = false;

  constructor(
    service: CardBuilderService,
    repository: PluginDataRepository,
    onCreated?: () => void,
    onOpenSourceNote?: (filePath: string) => void,
    onPickSourceNote?: (
      modeOverride: GenerateTemplateInput["mode"],
      onAttach: (selectionContext: SelectionContext) => void
    ) => void,
    onCreateDeck?: (name: string) => Promise<DeckOption>,
    onSaveCardEdit?: (input: SaveCardEditInput) => Promise<unknown>
  ) {
    this.service = service;
    this.repository = repository;
    this.onCreated = onCreated;
    this.onOpenSourceNote = onOpenSourceNote;
    this.onPickSourceNote = onPickSourceNote;
    this.onCreateDeck = onCreateDeck;
    this.onSaveCardEdit = onSaveCardEdit;
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
    this.editingCardId = null;
    this.editingVariantKey = "";
    this.editingSourceAnchor = null;
    this.selectionContext = selectionContext;

    const settings = this.repository.snapshot().settings;
    this.deckId = settings.defaultDeckId;
    this.mode = modeOverride ?? settings.defaultCardMode;
    this.frontMarkdown = "";
    this.backMarkdown = "";
    this.clozeMarkdown = "";
    this.newDeckName = "";
    this.isDeckCreatorOpen = false;

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

  openForEdit(cardId: string): void {
    const data = this.repository.snapshot();
    const card = data.cards.find((candidate) => candidate.id === cardId);
    if (!card) {
      new Notice("Card not found.");
      return;
    }

    const template = data.templates.find((candidate) => candidate.id === card.templateId) ?? null;
    const settings = data.settings;

    this.editingCardId = card.id;
    this.editingVariantKey = card.variantKey;
    this.editingSourceAnchor = template?.sourceAnchor ?? null;
    this.selectionContext = undefined;
    this.mode = "basic";
    this.deckId = template?.deckId ?? settings.defaultDeckId;
    this.frontMarkdown = card.promptMarkdown;
    this.backMarkdown = card.answerMarkdown;
    this.clozeMarkdown = "";
    this.newDeckName = "";
    this.isDeckCreatorOpen = false;

    this.render();
  }

  private render(): void {
    this.clearRendered();
    if (!this.container) return;

    const drawer = this.container.createDiv({ cls: "srf-builder-drawer" });
    this.el = drawer;
    const isEditing = this.editingCardId !== null;
    const sourceTitle = this.currentSourceTitle();
    const sourceFilePath = this.currentSourceFilePath();

    const header = drawer.createDiv({ cls: "srf-builder-drawer__header" });
    const titleWrap = header.createDiv({ cls: "srf-builder-drawer__title-wrap" });
    titleWrap.createEl("p", { cls: "srf-eyebrow", text: isEditing ? "Edit card" : "Card builder" });
    titleWrap.createEl("h2", {
      cls: "srf-builder-drawer__title",
      text: isEditing ? "Tune this card in the same focused panel." : "Capture the idea while it is still fresh.",
    });
    titleWrap.createEl("p", {
      cls: "srf-builder-drawer__subtitle",
      text: sourceTitle
        ? `Source: ${sourceTitle}`
        : "Manual card. Source is optional; just type and save.",
    });

    const closeBtn = header.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Close",
    });
    closeBtn.setAttribute("aria-label", "Close builder");
    closeBtn.addEventListener("click", () => this.close());

    if (!isEditing) {
      const tabs = drawer.createDiv({ cls: "srf-builder-drawer__mode-tabs" });
      CARD_MODES.forEach(({ mode, label, badge }) => {
        const tab = tabs.createEl("button", {
          cls: `srf-mode-tab${this.mode === mode ? " srf-mode-tab--active" : ""}`,
        });
        tab.createSpan({ cls: "srf-mode-tab__label", text: label });
        tab.createSpan({ cls: "srf-mode-tab__badge", text: badge });
        tab.addEventListener("click", () => this.switchMode(mode));
      });
    }

    const modeInfo = isEditing
      ? {
          title: "Single card edit",
          description: `Save changes back to this ${this.editingVariantKey || "card"} without creating another card.`,
        }
      : getModeInfo(this.mode);
    const modeHelp = drawer.createDiv({ cls: "srf-panel srf-builder-drawer__mode-help" });
    modeHelp.createEl("strong", { text: modeInfo.title });
    modeHelp.createEl("span", { text: modeInfo.description });

    const body = drawer.createDiv({ cls: "srf-builder-drawer__body" });

    const sourceCard = body.createEl("details", { cls: "srf-panel srf-builder-drawer__source-card" });
    sourceCard.createEl("summary", {
      cls: "srf-builder-drawer__source-summary",
      text: sourceTitle
        ? `Source context · ${sourceTitle}`
        : "Source context",
    });
    if (sourceTitle || sourceFilePath) {
      sourceCard.createDiv({
        cls: "srf-builder-drawer__source-note",
        text: sourceTitle || "Source note",
      });
      sourceCard.createDiv({
        cls: "srf-builder-drawer__source-path",
        text: sourceFilePath,
      });
      const excerpt = this.currentSourceExcerpt();
      if (excerpt) {
        sourceCard.createEl("blockquote", {
          cls: "srf-builder-drawer__excerpt",
          text: excerpt,
        });
      }
    } else {
      sourceCard.createDiv({
        cls: "srf-text-tertiary",
        text: "No source selected. This card will live in the deck without linking back to a note.",
      });
      if (this.onPickSourceNote && !isEditing) {
        const attachBtn = sourceCard.createEl("button", {
          cls: "srf-btn srf-btn--ghost srf-builder-drawer__source-action",
          text: "Attach Source Note",
          attr: { type: "button" },
        });
        attachBtn.addEventListener("click", () => {
          this.onPickSourceNote?.(this.mode, (selectionContext) => {
            this.attachSourceContext(selectionContext);
          });
        });
      }
    }

    const workspace = body.createDiv({ cls: "srf-builder-drawer__workspace" });

    const formCol = workspace.createDiv({
      cls: "srf-panel srf-builder-drawer__col srf-builder-drawer__col--form",
    });
    formCol.createEl("h3", { cls: "srf-builder-drawer__col-heading", text: "Card content" });
    const form = formCol.createEl("form", { cls: "srf-builder-drawer__form" });

    const deckField = form.createDiv({ cls: "srf-builder-drawer__deck-field" });
    const deckLabel = deckField.createEl("label", { cls: "srf-form-label" });
    deckLabel.textContent = "Deck";
    const deckRow = deckField.createDiv({ cls: "srf-builder-drawer__deck-row" });
    const deckSelect = deckRow.createEl("select", { cls: "srf-select" }) as HTMLSelectElement;
    this.renderDeckOptions(deckSelect);
    deckSelect.addEventListener("change", () => {
      this.deckId = deckSelect.value;
    });
    const deckToggle = deckRow.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: this.isDeckCreatorOpen ? "Hide" : "New Deck",
      attr: { type: "button" },
    });
    deckToggle.addEventListener("click", () => {
      this.isDeckCreatorOpen = !this.isDeckCreatorOpen;
      this.render();
    });
    if (this.isDeckCreatorOpen) {
      this.renderDeckCreator(deckField);
    }

    if (!isEditing && this.mode === "cloze") {
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
      text: isEditing ? "Save changes" : "Save",
      attr: { type: "button" },
    });
    saveBtn.addEventListener("click", () => this.save());

    if (sourceFilePath) {
      const sourceBtn = actions.createEl("button", {
        cls: "srf-btn srf-btn--ghost",
        text: "Open Source Note",
        attr: { type: "button" },
      });
      sourceBtn.addEventListener("click", () => {
        if (sourceFilePath) {
          const filePath = sourceFilePath;
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

  private currentSourceTitle(): string {
    return this.selectionContext?.noteTitle ?? this.editingSourceAnchor?.noteTitle ?? "";
  }

  private currentSourceFilePath(): string {
    return this.selectionContext?.filePath ?? this.editingSourceAnchor?.filePath ?? "";
  }

  private currentSourceExcerpt(): string {
    if (this.selectionContext) return this.selectedText();
    return this.editingSourceAnchor?.excerpt || this.editingSourceAnchor?.selectedText || "";
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
      payloads = this.editingCardId
        ? [
            {
              variantKey: this.editingVariantKey || "forward",
              promptMarkdown: this.frontMarkdown,
              answerMarkdown: this.backMarkdown,
            },
          ]
        : this.service.previewTemplate({
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

  private async save(): Promise<void> {
    try {
      if (this.editingCardId) {
        if (!this.onSaveCardEdit) {
          new Notice("Card editor is not available.");
          return;
        }

        await this.onSaveCardEdit({
          cardId: this.editingCardId,
          promptMarkdown: this.frontMarkdown,
          answerMarkdown: this.backMarkdown,
          deckId: this.deckId,
        });
        this.onCreated?.();
        new Notice("Card updated.");
        this.render();
        return;
      }

      await this.service.createFromSelection({
        selectionContext: this.selectionContext,
        mode: this.mode,
        deckId: this.deckId,
        tagIds: [],
        frontMarkdown: this.frontMarkdown,
        backMarkdown: this.backMarkdown,
        clozeMarkdown: this.mode === "cloze" ? this.clozeMarkdown : undefined,
      });
      this.onCreated?.();
      new Notice("Card saved.");

      this.frontMarkdown = "";
      this.backMarkdown = "";
      this.clozeMarkdown = "";
      this.render();
    } catch (err) {
      console.error("[SRF] Save card failed:", err);
      const message = err instanceof Error ? err.message : "Could not save card.";
      new Notice(message);
    }
  }

  private renderDeckOptions(select: HTMLSelectElement): void {
    const decks = this.repository.snapshot().decks.filter((deck) => !deck.archived);
    if (!this.deckId || !decks.some((deck) => deck.id === this.deckId)) {
      this.deckId = decks[0]?.id ?? "";
    }
    decks.forEach((deck) => {
      const option = select.createEl("option", { value: deck.id, text: deck.name });
      if (deck.id === this.deckId) option.selected = true;
    });
  }

  private renderDeckCreator(container: HTMLElement): void {
    const form = container.createEl("form", { cls: "srf-deck-editor srf-deck-editor--compact srf-builder-drawer__deck-create" });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.createDeck();
    });
    const input = form.createEl("input", {
      cls: "srf-input srf-deck-editor__input",
      type: "text",
      placeholder: "Deck name",
    }) as HTMLInputElement;
    input.value = this.newDeckName;

    const create = form.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: "Create",
      attr: { type: "button" },
    }) as HTMLButtonElement;
    const syncState = () => {
      create.disabled = this.isCreatingDeck || !input.value.trim() || !this.onCreateDeck;
    };
    input.addEventListener("input", () => {
      this.newDeckName = input.value;
      syncState();
    });
    create.addEventListener("click", () => void this.createDeck());
    syncState();
  }

  private async createDeck(): Promise<void> {
    if (!this.onCreateDeck || this.isCreatingDeck) return;
    const name = this.newDeckName.trim();
    if (!name) {
      new Notice("Deck name is required.");
      return;
    }

    this.isCreatingDeck = true;
    let shouldRender = false;
    try {
      const deck = await this.onCreateDeck(name);
      this.deckId = deck.id;
      this.newDeckName = "";
      this.isDeckCreatorOpen = false;
      new Notice(`Deck created: ${deck.name}`);
      shouldRender = true;
    } catch (error) {
      console.error("[SRF] Create deck failed:", error);
      new Notice(error instanceof Error ? error.message : "Could not create deck.");
      shouldRender = true;
    } finally {
      this.isCreatingDeck = false;
    }

    if (shouldRender) {
      this.render();
    }
  }

  private attachSourceContext(selectionContext: SelectionContext): void {
    this.selectionContext = selectionContext;
    const selectedText = selectionContext.fileContent
      .slice(selectionContext.startOffset, selectionContext.endOffset)
      .trim();

    if (selectedText) {
      if (this.mode === "cloze" && !this.clozeMarkdown.trim()) {
        this.clozeMarkdown = selectedText;
      } else if (this.mode !== "cloze" && !this.frontMarkdown.trim()) {
        this.frontMarkdown = selectedText;
      }
    }

    this.render();
  }

  close(): void {
    this.clearRendered();
    this.onRequestClose?.();
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
