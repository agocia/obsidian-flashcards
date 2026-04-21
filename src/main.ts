import {
  Plugin,
  WorkspaceLeaf,
  ItemView,
  PluginSettingTab,
  App,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  FuzzySuggestModal,
  TFile,
  type Editor,
  type MarkdownFileInfo,
} from "obsidian";

import { PluginDataRepository } from "./data/plugin-data-repository";
import { CardBuilderService } from "./services/card-builder-service";
import { DashboardService } from "./services/dashboard-service";
import { ReviewSessionService } from "./services/review-session-service";
import { LibraryService } from "./services/library-service";
import { SettingsService } from "./services/settings-service";
import { DeckService } from "./services/deck-service";
import { FSRSScheduler } from "./scheduling/fsrs-scheduler";
import { WorkspaceRouter } from "./ui/router/workspace-router";
import { DashboardView } from "./ui/views/dashboard-view";
import { ReviewView } from "./ui/views/review-view";
import { LibraryView } from "./ui/views/library-view";
import { BuilderDrawer } from "./ui/builder/builder-drawer";
import { PluginSettingsTab as SRFPluginSettingsTab } from "./ui/settings/plugin-settings-tab";
import { resolveSelectionContext, type SelectionContext } from "./data/source-anchor-resolver";
import type { GenerateTemplateInput } from "./parsing/template-generator";

const DASHBOARD_VIEW_TYPE = "srf-dashboard";
const REVIEW_VIEW_TYPE = "srf-review";
const LIBRARY_VIEW_TYPE = "srf-library";
const BUILDER_VIEW_TYPE = "srf-builder";

class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setTitle("Pick Source Note");
    this.setPlaceholder("Search notes...");
    this.emptyStateText = "No note found.";
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }

  renderSuggestion(match: { item: TFile }, el: HTMLElement): void {
    el.createEl("div", { text: match.item.basename });
    el.createEl("small", { text: match.item.path });
  }
}

// ─── View wrappers ─────────────────────────────────────────────────────────

class SRFDashboardLeaf extends ItemView {
  private view!: DashboardView;

  constructor(
    leaf: WorkspaceLeaf,
    private service: DashboardService,
    private onStartReview: (deckIds?: string[]) => void,
    private onCreateCard: () => void,
    private onOpenLibrary: () => void,
    private onManageDecks: () => void
  ) {
    super(leaf);
  }

  getViewType() { return DASHBOARD_VIEW_TYPE; }
  getDisplayText() { return "Flashcards"; }

  async onOpen() {
    this.contentEl.empty();
    try {
      this.view = new DashboardView(
        this.contentEl,
        this.service,
        (deckIds) => this.onStartReview(deckIds),
        () => this.onCreateCard(),
        () => this.onOpenLibrary(),
        () => this.onManageDecks()
      );
      await this.view.render();
    } catch (error) {
      console.error("[SRF] Dashboard leaf failed to open:", error);
      this.renderLeafError(
        "Could not open Flashcards dashboard.",
        "Use the command palette to reopen it after Obsidian finishes loading."
      );
    }
  }

  async refresh() {
    await this.view?.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private renderLeafError(headline: string, body: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "srf-view srf-dashboard" });
    wrap.createEl("h2", { text: headline });
    wrap.createEl("p", { text: body });
  }
}

class SRFReviewLeaf extends ItemView {
  private view!: ReviewView;

  constructor(
    leaf: WorkspaceLeaf,
    private sessionService: ReviewSessionService,
    private scheduler: FSRSScheduler,
    private repository: PluginDataRepository,
    private app2: App,
    private router: WorkspaceRouter,
    private consumePendingDeckIds: () => string[] | undefined
  ) {
    super(leaf);
  }

  getViewType() { return REVIEW_VIEW_TYPE; }
  getDisplayText() { return "Review" }

  async onOpen() {
    this.contentEl.empty();
    try {
      this.view = new ReviewView(
        this.contentEl,
        this.sessionService,
        this.scheduler,
        this.repository,
        (src, el) => MarkdownRenderer.render(this.app2, src, el, "", this),
        () => this.router.openDashboard()
      );
      await this.view.start(this.consumePendingDeckIds());
    } catch (error) {
      console.error("[SRF] Review leaf failed to open:", error);
      this.renderLeafError(
        "Could not open review session.",
        "Try reopening Review from the command palette."
      );
    }
  }

  async onClose() {
    this.view?.destroy();
    this.contentEl.empty();
  }

  async startReview(deckIds?: string[]): Promise<void> {
    await this.view.start(deckIds);
  }

  private renderLeafError(headline: string, body: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "srf-view srf-review" });
    wrap.createEl("h2", { text: headline });
    wrap.createEl("p", { text: body });
  }
}

class SRFLibraryLeaf extends ItemView {
  private view!: LibraryView;

  constructor(
    leaf: WorkspaceLeaf,
    private service: LibraryService,
    private repository: PluginDataRepository,
    private plugin: FlashcardsPlugin,
    private onCreateCard: () => void,
    private onOpenSourceNote: (filePath: string) => void
  ) {
    super(leaf);
  }

  getViewType() { return LIBRARY_VIEW_TYPE; }
  getDisplayText() { return "Card Library"; }

  async onOpen() {
    this.contentEl.empty();
    try {
      const data = this.repository.snapshot();
      const decks = this.plugin.getActiveDeckSelectOptions();
      const tags = data.tags.map((t) => ({ id: t.id, label: t.label }));
      const sourceFiles = [
        ...new Set(data.templates.map((t) => t.sourceAnchor.filePath).filter(Boolean)),
      ];
      this.view = new LibraryView(
        this.contentEl,
        this.service,
        decks,
        tags,
        sourceFiles,
        () => this.onCreateCard(),
        (filePath) => this.onOpenSourceNote(filePath),
        () => {
          const latest = this.repository.snapshot();
          return {
            decks: this.plugin.getActiveDeckSelectOptions(),
            tags: latest.tags.map((tag) => ({ id: tag.id, label: tag.label })),
            sourceFiles: [
              ...new Set(
                latest.templates
                  .map((template) => template.sourceAnchor.filePath)
                  .filter(Boolean)
              ),
            ],
          };
        }
      );
      await this.view.render();
    } catch (error) {
      console.error("[SRF] Library leaf failed to open:", error);
      this.renderLeafError(
        "Could not open card library.",
        "Try reopening Card Library after Obsidian finishes loading."
      );
    }
  }

  async refresh() {
    await this.view?.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private renderLeafError(headline: string, body: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: "srf-view srf-library" });
    wrap.createEl("h2", { text: headline });
    wrap.createEl("p", { text: body });
  }
}

class SRFBuilderLeaf extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private builderDrawer: BuilderDrawer
  ) {
    super(leaf);
  }

  getViewType() { return BUILDER_VIEW_TYPE; }
  getDisplayText() { return "New Card"; }
  getIcon() { return "square-pen"; }

  async onOpen() {
    this.contentEl.empty();
    this.builderDrawer.mount(this.contentEl, () => this.leaf.detach());
  }

  openBuilder(
    selectionContext?: SelectionContext,
    modeOverride?: GenerateTemplateInput["mode"]
  ): void {
    this.builderDrawer.open(selectionContext, modeOverride);
  }

  async onClose() {
    this.builderDrawer.unmount();
    this.contentEl.empty();
  }
}

class SRFSettingsTab extends PluginSettingTab {
  private inner!: SRFPluginSettingsTab;

  constructor(
    app: App,
    plugin: Plugin,
    private service: SettingsService,
    private deckService: DeckService,
    private onDidChange?: () => void | Promise<void>
  ) {
    super(app, plugin);
  }

  display() {
    this.inner = new SRFPluginSettingsTab(
      this.containerEl,
      this.service,
      this.deckService,
      this.onDidChange
    );
    this.inner.display();
  }
}

// ─── Main plugin ───────────────────────────────────────────────────────────

export default class FlashcardsPlugin extends Plugin {
  private repository!: PluginDataRepository;
  private scheduler!: FSRSScheduler;
  private cardBuilder!: CardBuilderService;
  private dashboardService!: DashboardService;
  private sessionService!: ReviewSessionService;
  private libraryService!: LibraryService;
  private settingsService!: SettingsService;
  private deckService!: DeckService;
  private router!: WorkspaceRouter;
  private builderDrawer!: BuilderDrawer;
  private pendingReviewDeckIds: string[] | null = null;

  async onload() {
    // ── Initialise services ───────────────────────────────────────────────
    this.repository = new PluginDataRepository({
      loadData: () => this.loadData(),
      saveData: (d) => this.saveData(d),
    });

    await this.repository.load();

    this.scheduler = new FSRSScheduler();
    this.cardBuilder = new CardBuilderService(this.repository);
    this.dashboardService = new DashboardService(this.repository);
    this.sessionService = new ReviewSessionService(this.repository);
    this.libraryService = new LibraryService(this.repository);
    this.settingsService = new SettingsService(this.repository);
    this.deckService = new DeckService(this.repository);
    await this.deckService.normalizePersistedReferences();

    this.router = new WorkspaceRouter(this.app.workspace as any);
    this.builderDrawer = new BuilderDrawer(
      this.cardBuilder,
      this.repository,
      this.deckService,
      () => {
        void this.refreshOpenViews();
      },
      (filePath) => void this.openSourceNote(filePath),
      () => this.openPluginSettings()
    );

    // ── Register views ────────────────────────────────────────────────────
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) =>
      new SRFDashboardLeaf(
        leaf,
        this.dashboardService,
        (deckIds) => void this.openReviewSession(deckIds),
        () => this.openBuilderFromActiveNote(),
        () => void this.router.openLibrary(),
        () => this.openPluginSettings()
      )
    );

    this.registerView(REVIEW_VIEW_TYPE, (leaf) =>
      new SRFReviewLeaf(
        leaf,
        this.sessionService,
        this.scheduler,
        this.repository,
        this.app,
        this.router,
        () => this.consumePendingReviewDeckIds()
      )
    );

    this.registerView(LIBRARY_VIEW_TYPE, (leaf) =>
      new SRFLibraryLeaf(
        leaf,
        this.libraryService,
        this.repository,
        this,
        () => this.openBuilderFromActiveNote(),
        (filePath) => void this.openSourceNote(filePath)
      )
    );

    this.registerView(BUILDER_VIEW_TYPE, (leaf) =>
      new SRFBuilderLeaf(leaf, this.builderDrawer)
    );

    // ── Settings tab ──────────────────────────────────────────────────────
    this.addSettingTab(
      new SRFSettingsTab(
        this.app,
        this,
        this.settingsService,
        this.deckService,
        () => this.refreshOpenViews()
      )
    );

    // ── Ribbon icon ───────────────────────────────────────────────────────
    this.addRibbonIcon("layers", "Flashcards", async () => {
      await this.router.openDashboard();
    });

    // ── Commands ──────────────────────────────────────────────────────────
    this.addCommand({
      id: "open-dashboard",
      name: "Open Dashboard",
      callback: () => this.router.openDashboard(),
    });

    this.addCommand({
      id: "start-review",
      name: "Start Review Session",
      callback: () => void this.openReviewSession(),
    });

    this.addCommand({
      id: "open-library",
      name: "Open Card Library",
      callback: () => this.router.openLibrary(),
    });

    this.addCommand({
      id: "create-card-from-selection",
      name: "Create Card from Selection or Current Line",
      editorCallback: (editor, ctx) => {
        this.openBuilderFromEditor(editor, ctx);
      },
    });

    this.addCommand({
      id: "create-cloze-card-from-selection",
      name: "Create Cloze Card from Selection or Current Line",
      editorCallback: (editor, ctx) => {
        this.openBuilderFromEditor(editor, ctx, "cloze");
      },
    });

    this.addCommand({
      id: "create-card-from-active-note",
      name: "Create Card from Active Note",
      callback: () => this.openBuilderFromActiveNote(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const selectionContext = this.buildSelectionContext(editor, info);
        if (!selectionContext) return;

        menu.addItem((item) => {
          item.setTitle("Create Card").onClick(() => {
            void this.openBuilderPane(selectionContext);
          });
        });

        menu.addItem((item) => {
          item.setTitle("Create Cloze Card").onClick(() => {
            void this.openBuilderPane(selectionContext, "cloze");
          });
        });
      })
    );

    // ── Auto-reload dashboard on data change ──────────────────────────────
    this.registerEvent(
      this.app.vault.on("modify", (file: TFile) => {
        const settings = this.repository.snapshot().settings;
        if (settings.autoSyncOnVaultChange) {
          // Revalidate anchor references for this file (fire and forget)
          this.revalidateAnchorsForFile(file.path);
        }
      })
    );

    // ── Load styles ───────────────────────────────────────────────────────
    this.loadStyles();

    // ── Open dashboard automatically only for a clean first-run state ────
    if (this.app.workspace.layoutReady) {
      await this.maybeOpenInitialDashboard();
    } else {
      this.app.workspace.onLayoutReady(() => {
        void this.maybeOpenInitialDashboard();
      });
    }
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LIBRARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(BUILDER_VIEW_TYPE);
    this.builderDrawer.unmount();
  }

  private loadStyles(): void {
    try {
      const adapter = this.app.vault.adapter as {
        getResourcePath?: (path: string) => string;
      };
      const pluginDir =
        this.manifest.dir ??
        `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
      const href = adapter.getResourcePath?.call(adapter, `${pluginDir}/styles.css`);
      if (!href) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      this.register(() => link.remove());
    } catch (error) {
      // Obsidian also auto-loads styles.css for plugins; CSS should never block startup.
      console.warn("[SRF] Stylesheet load skipped:", error);
    }
  }

  private buildSelectionContext(
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo
  ): SelectionContext | null {
    const file = ctx.file;
    if (!file) return null;

    return resolveSelectionContext({
      filePath: file.path,
      noteTitle: file.basename,
      fileContent: editor.getValue(),
      startOffset: editor.posToOffset(editor.getCursor("from")),
      endOffset: editor.posToOffset(editor.getCursor("to")),
    });
  }

  private openBuilderFromEditor(
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo,
    modeOverride?: GenerateTemplateInput["mode"]
  ): void {
    const selectionContext = this.buildSelectionContext(editor, ctx);
    if (!selectionContext) {
      new Notice("Select text or place the cursor on a non-empty line first.");
      return;
    }

    void this.openBuilderPane(selectionContext, modeOverride);
  }

  private openBuilderFromActiveNote(
    modeOverride?: GenerateTemplateInput["mode"]
  ): void {
    const activeEditor = this.app.workspace.activeEditor;
    if (activeEditor?.editor) {
      const selectionContext = this.buildSelectionContext(
        activeEditor.editor,
        activeEditor
      );
      if (selectionContext) {
        void this.openBuilderPane(selectionContext, modeOverride);
        return;
      }
    }

    const activeFile = this.app.workspace.getActiveFile();
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");

    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (
        view instanceof MarkdownView &&
        view.file &&
        (!activeFile || view.file.path === activeFile.path)
      ) {
        const selectionContext = this.buildSelectionContext(view.editor, view);
        if (selectionContext) {
          void this.openBuilderPane(selectionContext, modeOverride);
          return;
        }
      }
    }

    if (activeFile) {
      void this.openBuilderFromFile(activeFile, modeOverride);
      return;
    }

    this.pickSourceNote(modeOverride);
  }

  private async refreshOpenViews(): Promise<void> {
    const dashboardLeaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
    for (const leaf of dashboardLeaves) {
      const view = leaf.view as SRFDashboardLeaf;
      if (typeof view.refresh === "function") {
        await view.refresh();
      }
    }

    const libraryLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    for (const leaf of libraryLeaves) {
      const view = leaf.view as SRFLibraryLeaf;
      if (typeof view.refresh === "function") {
        await view.refresh();
      }
    }
  }

  getActiveDeckSelectOptions(): Array<{ id: string; name: string }> {
    return this.deckService.getDeckOptions().map((deck) => ({
      id: deck.id,
      name: deck.label,
    }));
  }

  private consumePendingReviewDeckIds(): string[] | undefined {
    const pending = this.pendingReviewDeckIds ?? undefined;
    this.pendingReviewDeckIds = null;
    return pending;
  }

  private async openReviewSession(deckIds: string[] = []): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE)[0];
    if (existingLeaf?.view instanceof SRFReviewLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      await existingLeaf.view.startReview(deckIds);
      return;
    }

    this.pendingReviewDeckIds = deckIds;
    await this.router.openReview();
  }

  private openPluginSettings(): void {
    const settingApp = this.app as App & {
      setting?: {
        open(): void;
        openTabById?(id: string): void;
      };
    };

    settingApp.setting?.open();
    settingApp.setting?.openTabById?.(this.manifest.id);
  }

  private async openSourceNote(filePath: string): Promise<void> {
    if (!filePath) {
      new Notice("This card does not have a source note yet.");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      new Notice(`Source note not found: ${filePath}`);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  private pickSourceNote(
    modeOverride?: GenerateTemplateInput["mode"]
  ): void {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new Notice("No Markdown notes found in this vault.");
      return;
    }

    new NotePickerModal(this.app, files, (file) => {
      void this.openBuilderFromFile(file, modeOverride);
    }).open();
  }

  private async openBuilderFromFile(
    file: TFile,
    modeOverride?: GenerateTemplateInput["mode"]
  ): Promise<void> {
    try {
      const fileContent = await this.app.vault.read(file);
      const selectionContext = resolveSelectionContext({
        filePath: file.path,
        noteTitle: file.basename,
        fileContent,
        startOffset: 0,
        endOffset: 0,
      });

      if (!selectionContext) {
        new Notice("Pick a note with some non-empty content first.");
        return;
      }

      void this.openBuilderPane(selectionContext, modeOverride);
    } catch (error) {
      console.error("[SRF] Open builder from file failed:", error);
      new Notice("Could not open that note for card creation.");
    }
  }

  private async openBuilderPane(
    selectionContext?: SelectionContext,
    modeOverride?: GenerateTemplateInput["mode"]
  ): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(BUILDER_VIEW_TYPE)[0] ?? null;

    if (!leaf) {
      const workspace = this.app.workspace as typeof this.app.workspace & {
        ensureSideLeaf?: (
          type: string,
          side: "left" | "right",
          options?: { active?: boolean; split?: boolean; reveal?: boolean; state?: unknown }
        ) => Promise<WorkspaceLeaf>;
      };

      if (typeof workspace.ensureSideLeaf === "function") {
        leaf = await workspace.ensureSideLeaf(BUILDER_VIEW_TYPE, "right", {
          active: true,
          reveal: true,
        });
      } else {
        leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: BUILDER_VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
      }
    } else {
      await this.app.workspace.revealLeaf(leaf);
    }

    if (leaf.view instanceof SRFBuilderLeaf) {
      leaf.view.openBuilder(selectionContext, modeOverride);
    } else {
      this.builderDrawer.open(selectionContext, modeOverride);
    }
  }

  private async revalidateAnchorsForFile(filePath: string): Promise<void> {
    const data = this.repository.snapshot();
    const affected = data.templates.filter(
      (t) => t.sourceAnchor.filePath === filePath
    );
    if (affected.length === 0) return;

    try {
      const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
      if (!file) return;
      const content = await this.app.vault.read(file);

      const { revalidateAnchor } = await import("./data/source-anchor-resolver");
      await this.repository.save((d) => ({
        ...d,
        templates: d.templates.map((t) => {
          if (t.sourceAnchor.filePath !== filePath) return t;
          const result = revalidateAnchor(t.sourceAnchor, content);
          if (result.status === "missing") return t;
          const updated: typeof t = {
            ...t,
            sourceAnchor: {
              ...t.sourceAnchor,
              startOffset: result.resolvedOffset?.start ?? t.sourceAnchor.startOffset,
              endOffset: result.resolvedOffset?.end ?? t.sourceAnchor.endOffset,
              lastResolvedAt: new Date().toISOString(),
            },
          };
          return updated;
        }),
      }));
    } catch {
      // Non-fatal
    }
  }

  private async maybeOpenInitialDashboard(): Promise<void> {
    const hasFlashcardsLeaf =
      this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE).length > 0 ||
      this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE).length > 0 ||
      this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE).length > 0 ||
      this.app.workspace.getLeavesOfType(BUILDER_VIEW_TYPE).length > 0;
    if (hasFlashcardsLeaf) return;

    const data = this.repository.snapshot();
    const isFirstRun = data.cards.length === 0 && data.templates.length === 0;
    if (!isFirstRun) return;

    try {
      await this.router.openDashboard();
    } catch (error) {
      console.error("[SRF] Initial dashboard open failed:", error);
    }
  }
}
