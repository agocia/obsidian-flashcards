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
  private onStartReview?: () => void;
  private onCreateCard?: () => void;
  private onOpenLibrary?: () => void;

  constructor(
    container: HTMLElement,
    service: DashboardService,
    onStartReview?: () => void,
    onCreateCard?: () => void,
    onOpenLibrary?: () => void
  ) {
    this.container = container;
    this.service = service;
    this.onStartReview = onStartReview;
    this.onCreateCard = onCreateCard;
    this.onOpenLibrary = onOpenLibrary;
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
    startBtn.addEventListener("click", () => this.onStartReview?.());

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
      const focusActions = focusCard.createDiv({ cls: "srf-dashboard__focus-actions" });
      const reviewBtn = focusActions.createEl("button", {
        cls: "srf-btn srf-btn--primary srf-dashboard__start-btn",
        text: "Start Review",
      });
      reviewBtn.addEventListener("click", () => this.onStartReview?.());
      const libraryAction = focusActions.createEl("button", {
        cls: "srf-btn srf-btn--secondary",
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
