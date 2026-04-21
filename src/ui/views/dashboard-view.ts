import type { DashboardService } from "../../services/dashboard-service";
import { renderMetricTile } from "../components/metric-tile";
import { renderStateBanner } from "../components/state-banner";

export const DASHBOARD_VIEW_TYPE = "srf-dashboard";

/**
 * Dashboard view — pure DOM rendering helper.
 * WorkspaceRouter mounts this inside a standard ItemView leaf.
 */
export class DashboardView {
  private container: HTMLElement;
  private service: DashboardService;
  private onStartReview?: (deckIds?: string[]) => void;
  private onCreateCard?: () => void;
  private onOpenLibrary?: () => void;
  private onManageDecks?: () => void;
  private selectedDeckId = "";

  constructor(
    container: HTMLElement,
    service: DashboardService,
    onStartReview?: (deckIds?: string[]) => void,
    onCreateCard?: () => void,
    onOpenLibrary?: () => void,
    onManageDecks?: () => void
  ) {
    this.container = container;
    this.service = service;
    this.onStartReview = onStartReview;
    this.onCreateCard = onCreateCard;
    this.onOpenLibrary = onOpenLibrary;
    this.onManageDecks = onManageDecks;
  }

  async render(): Promise<void> {
    this.container.empty();
    this.container.addClass("srf-view", "srf-dashboard");

    let stats;
    try {
      stats = await this.service.getStats();
    } catch {
      renderStateBanner(this.container, {
        kind: "error",
        headline: "Could not load dashboard",
        body: "Check the plugin data or reload Obsidian.",
      });
      return;
    }

    if (
      this.selectedDeckId &&
      !stats.reviewDecks.some((deck) => deck.id === this.selectedDeckId)
    ) {
      this.selectedDeckId = "";
    }

    if (
      !this.selectedDeckId &&
      stats.continueDeckId &&
      stats.reviewDecks.some((deck) => deck.id === stats.continueDeckId)
    ) {
      this.selectedDeckId = stats.continueDeckId;
    }

    const hero = this.container.createDiv({ cls: "srf-panel srf-dashboard__hero" });
    const heroCopy = hero.createDiv({ cls: "srf-dashboard__hero-copy" });
    heroCopy.createEl("p", { cls: "srf-eyebrow", text: "Flashcards" });
    heroCopy.createEl("h1", {
      cls: "srf-dashboard__title",
      text: stats.dueToday > 0 ? "A focused review session is ready." : "Your memory system is quiet and ready.",
    });
    heroCopy.createEl("p", {
      cls: "srf-dashboard__subtitle",
      text: "Capture ideas, review what matters, and keep the queue clean without leaving Obsidian.",
    });

    const actions = heroCopy.createDiv({ cls: "srf-dashboard__actions" });
    const startBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: stats.dueToday > 0 ? "Start Review" : "Open Review",
    });
    startBtn.addEventListener("click", () => this.startReview());

    const libraryBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--secondary",
      text: "Open Library",
    });
    libraryBtn.addEventListener("click", () => this.onOpenLibrary?.());

    const createBtn = actions.createEl("button", {
      cls: "srf-btn srf-btn--ghost",
      text: "Create Card",
    });
    createBtn.addEventListener("click", () => this.onCreateCard?.());

    const heroAside = hero.createDiv({ cls: "srf-dashboard__hero-aside" });
    heroAside.createDiv({
      cls: "srf-dashboard__hero-stat-label",
      text: "Due right now",
    });
    heroAside.createDiv({
      cls: "srf-dashboard__hero-stat-value",
      text: String(stats.dueToday),
    });
    heroAside.createDiv({
      cls: "srf-dashboard__hero-stat-detail",
      text: stats.continueDeckName
        ? `Continue ${stats.continueDeckName}`
        : stats.newCards > 0
          ? `${stats.newCards} new cards available`
          : "Queue is clear for now",
    });

    const tilesRow = this.container.createDiv({ cls: "srf-dashboard__tiles" });
    renderMetricTile(tilesRow, {
      label: "Due Today",
      value: stats.dueToday,
      tone: stats.dueToday > 0 ? "warning" : "neutral",
    });
    renderMetricTile(tilesRow, {
      label: "New Cards",
      value: stats.newCards,
      tone: "neutral",
    });
    renderMetricTile(tilesRow, {
      label: "Retention",
      value: `${stats.retention30d}%`,
      tone: stats.retention30d >= 85 ? "success" : stats.retention30d >= 70 ? "warning" : "danger",
    });
    renderMetricTile(tilesRow, {
      label: "Streak",
      value: stats.streakDays,
      delta: stats.streakDays > 0 ? `${stats.streakDays}d` : undefined,
      tone: stats.streakDays > 6 ? "success" : "neutral",
    });

    const grid = this.container.createDiv({ cls: "srf-dashboard__grid" });

    const focusCard = grid.createDiv({ cls: "srf-panel srf-dashboard__focus-card" });
    focusCard.createEl("h2", { cls: "srf-dashboard__section-heading", text: "Focus" });
    if (stats.dueToday === 0 && stats.newCards === 0) {
      renderStateBanner(focusCard, {
        kind: "empty",
        headline: "You're all caught up",
        body: "Capture the next idea while the queue is calm.",
        ctaLabel: "Create Card",
        onCta: () => this.onCreateCard?.(),
      });
    } else {
      focusCard.createEl("p", {
        cls: "srf-dashboard__focus-copy",
        text:
          stats.dueToday > 0
            ? `You have ${stats.dueToday} due card${stats.dueToday === 1 ? "" : "s"} waiting.`
            : `No due cards yet, but ${stats.newCards} new card${stats.newCards === 1 ? "" : "s"} can be introduced.`,
      });
      const target = focusCard.createDiv({ cls: "srf-dashboard__target-row" });
      const targetCopy = target.createDiv({ cls: "srf-dashboard__target-copy" });
      targetCopy.createDiv({ cls: "srf-dashboard__target-label", text: "Review target" });
      const targetHint = targetCopy.createDiv({
        cls: "srf-dashboard__target-hint",
        text: this.selectedDeckId
          ? stats.reviewDecks.find((deck) => deck.id === this.selectedDeckId)?.label ?? "Selected deck"
          : "All active decks",
      });
      const targetSelect = target.createEl("select", {
        cls: "srf-select srf-dashboard__target-select",
      }) as HTMLSelectElement;
      const allDecksOption = targetSelect.createEl("option", {
        value: "",
        text: "All decks",
      });
      if (!this.selectedDeckId) allDecksOption.selected = true;
      stats.reviewDecks.forEach((deck) => {
        const option = targetSelect.createEl("option", {
          value: deck.id,
          text: deck.label,
        });
        if (deck.id === this.selectedDeckId) option.selected = true;
      });
      targetSelect.addEventListener("change", () => {
        this.selectedDeckId = targetSelect.value;
        targetHint.textContent = this.selectedDeckId
          ? stats.reviewDecks.find((deck) => deck.id === this.selectedDeckId)?.label ?? "Selected deck"
          : "All active decks";
      });
      const focusActions = focusCard.createDiv({ cls: "srf-dashboard__focus-actions" });
      const reviewBtn = focusActions.createEl("button", {
        cls: "srf-btn srf-btn--primary srf-dashboard__start-btn",
        text: "Start Review",
      });
      reviewBtn.addEventListener("click", () => this.startReview());
      const manageDecksBtn = focusActions.createEl("button", {
        cls: "srf-btn srf-btn--secondary",
        text: "Manage Decks",
      });
      manageDecksBtn.addEventListener("click", () => this.onManageDecks?.());
      const libraryAction = focusActions.createEl("button", {
        cls: "srf-btn srf-btn--ghost",
        text: "Tidy Library",
      });
      libraryAction.addEventListener("click", () => this.onOpenLibrary?.());
    }

    const insightsCard = grid.createDiv({ cls: "srf-panel srf-dashboard__insights-card" });
    insightsCard.createEl("h2", { cls: "srf-dashboard__section-heading", text: "Signals" });
    const insights = insightsCard.createDiv({ cls: "srf-dashboard__insight-list" });
    renderInsight(
      insights,
      "Continue deck",
      stats.continueDeckName ?? "No active deck",
      stats.continueDeckName
        ? "Resume where the last review session left off."
        : "Start a fresh review session from the dashboard."
    );
    renderInsight(
      insights,
      "Next review block",
      stats.nextReviewBlockAt ? formatReviewBlock(stats.nextReviewBlockAt) : "Not scheduled",
      "A quiet cue for the next study window."
    );
    renderInsight(
      insights,
      "Recently added",
      `${stats.recentlyAddedCardIds.length} in the last 7 days`,
      stats.recentlyAddedCardIds.length > 0
        ? "Fresh cards are flowing into the system."
        : "Nothing new has been captured this week."
    );
    renderInsight(
      insights,
      "Needs attention",
      `${stats.needsAttentionCardIds.length} card${stats.needsAttentionCardIds.length === 1 ? "" : "s"}`,
      stats.needsAttentionCardIds.length > 0
        ? "Repeated lapses suggest these cards need editing or splitting."
        : "No problem cards are standing out right now."
    );
  }

  private startReview(): void {
    this.onStartReview?.(this.selectedDeckId ? [this.selectedDeckId] : []);
  }
}

function renderInsight(container: HTMLElement, label: string, value: string, detail: string): void {
  const row = container.createDiv({ cls: "srf-dashboard__insight-row" });
  const text = row.createDiv({ cls: "srf-dashboard__insight-copy" });
  text.createDiv({ cls: "srf-dashboard__insight-label", text: label });
  text.createDiv({ cls: "srf-dashboard__insight-value", text: value });
  text.createDiv({ cls: "srf-dashboard__insight-detail", text: detail });
}

function formatReviewBlock(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
