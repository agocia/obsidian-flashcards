import type { PluginDataRepository } from "../../data/plugin-data-repository";
import type { ReviewSessionService } from "../../services/review-session-service";
import type { FSRSScheduler } from "../../scheduling/fsrs-scheduler";
import { renderRatingButtonRow, type RatingValue } from "../components/rating-button-row";
import { renderReviewCardPanel } from "../components/review-card-panel";
import { renderStateBanner } from "../components/state-banner";

export const REVIEW_VIEW_TYPE = "srf-review";

/**
 * Review session view — the plugin's core interaction loop.
 * Keyboard: Space = reveal, 1-4 = rating.
 */
export class ReviewView {
  private container: HTMLElement;
  private sessionService: ReviewSessionService;
  private scheduler: FSRSScheduler;
  private repository: PluginDataRepository;
  private sessionId: string | null = null;
  private revealed = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private renderMarkdown?: (src: string, el: HTMLElement) => void;
  private onBackToDashboard?: () => void;

  constructor(
    container: HTMLElement,
    sessionService: ReviewSessionService,
    scheduler: FSRSScheduler,
    repository: PluginDataRepository,
    renderMarkdown?: (src: string, el: HTMLElement) => void,
    onBackToDashboard?: () => void
  ) {
    this.container = container;
    this.sessionService = sessionService;
    this.scheduler = scheduler;
    this.repository = repository;
    this.renderMarkdown = renderMarkdown;
    this.onBackToDashboard = onBackToDashboard;
  }

  async start(deckIds?: string[]): Promise<void> {
    const payload = await this.sessionService.start({
      deckIds: deckIds ?? [],
      includeNewCards: true,
    });
    this.sessionId = payload.session.id;
    this.revealed = false;
    this.bindKeyboard();
    await this.render();
  }

  private async render(): Promise<void> {
    this.container.empty();
    this.container.addClass("srf-view", "srf-review");

    if (!this.sessionId) return;

    const data = this.repository.snapshot();
    const session = data.sessionDraft;
    if (!session) return;

    const total = session.queuedCardIds.length + session.completedCardIds.length;
    const completed = session.completedCardIds.length;
    const progressPct = total > 0 ? (completed / total) * 100 : 100;

    const header = this.container.createDiv({ cls: "srf-review__header" });
    const copy = header.createDiv({ cls: "srf-review__header-copy" });
    copy.createEl("p", { cls: "srf-eyebrow", text: "Review session" });
    copy.createEl("h1", {
      cls: "srf-review__title",
      text: this.revealed ? "Commit to an answer." : "Take one calm beat before you reveal.",
    });
    copy.createEl("p", {
      cls: "srf-review__subtitle",
      text: this.revealed
        ? "Rate the card with 1–4 or click a choice."
        : "Press Space or click the card to reveal the answer.",
    });

    const metaCard = header.createDiv({ cls: "srf-panel srf-review__meta-card" });
    metaCard.createDiv({ cls: "srf-review__meta-card-label", text: "Progress" });
    metaCard.createDiv({
      cls: "srf-review__meta-card-value",
      text: total > 0 ? `${completed + (this.revealed ? 0 : 0)}/${total}` : "0/0",
    });
    metaCard.createDiv({
      cls: "srf-review__meta-card-detail",
      text: `${session.queuedCardIds.length} remaining`,
    });

    const progressBar = this.container.createDiv({ cls: "srf-review__progress-wrap" });
    const track = progressBar.createDiv({ cls: "srf-review__progress-track" });
    const fill = track.createDiv({ cls: "srf-review__progress-fill" });
    fill.style.width = `${progressPct}%`;

    const currentCardId = session.currentCardId;
    if (!currentCardId) {
      renderStateBanner(this.container, {
        kind: "empty",
        headline: "All done",
        body: "You've reviewed everything due in this session.",
        ctaLabel: "Back to Dashboard",
        onCta: () => {
          this.unbindKeyboard();
          this.onBackToDashboard?.();
        },
      });
      return;
    }

    const card = data.cards.find((candidate) => candidate.id === currentCardId);
    if (!card) return;

    const template = data.templates.find((candidate) => candidate.id === card.templateId);
    const deck = data.decks.find((candidate) => candidate.id === template?.deckId);

    const topBar = this.container.createDiv({ cls: "srf-review__top-bar" });
    topBar.createDiv({
      cls: "srf-review__deck-pill srf-tag-pill",
      text: deck?.name ?? "Deck",
    });
    topBar.createDiv({
      cls: "srf-review__top-meta",
      text: this.revealed ? "1–4 to rate" : "Space to reveal",
    });

    const cardWrap = this.container.createDiv({ cls: "srf-review__card-wrap" });
    renderReviewCardPanel(cardWrap, {
      promptMarkdown: card.promptMarkdown,
      answerMarkdown: card.answerMarkdown,
      revealed: this.revealed,
      variantKey: card.variantKey,
      renderMarkdown: this.renderMarkdown,
    });

    if (!this.revealed) {
      cardWrap.addEventListener("click", () => this.reveal());
    }

    if (this.revealed) {
      const preview = this.scheduler.previewSchedule(card, new Date());
      const previewMap: Record<RatingValue, { intervalDays: number }> = {
        1: { intervalDays: preview.again.scheduledDays },
        2: { intervalDays: preview.hard.scheduledDays },
        3: { intervalDays: preview.good.scheduledDays },
        4: { intervalDays: preview.easy.scheduledDays },
      };

      const actionZone = this.container.createDiv({
        cls: "srf-review__action-zone srf-action-zone--revealed",
      });
      renderRatingButtonRow(actionZone, {
        schedulePreview: previewMap,
        showShortcutHints: true,
        onRate: (rating) => this.rate(rating),
      });
    }

    const footer = this.container.createDiv({ cls: "srf-review__footer" });
    footer.createDiv({
      cls: "srf-review__footer-line",
      text: this.revealed
        ? `Rate now · ${session.queuedCardIds.length} remaining`
        : `Reveal when ready · ${session.queuedCardIds.length} remaining`,
    });
  }

  private async reveal(): Promise<void> {
    if (!this.sessionId || this.revealed) return;
    await this.sessionService.reveal(this.sessionId);
    this.revealed = true;
    await this.render();
  }

  private async rate(rating: RatingValue): Promise<void> {
    if (!this.sessionId || !this.revealed) return;
    const snap = this.repository.snapshot();
    const cardId = snap.sessionDraft?.currentCardId ?? "";
    if (!cardId) return;
    await this.sessionService.rate({
      sessionId: this.sessionId,
      cardId,
      rating,
      reviewedAt: new Date().toISOString(),
    });
    this.revealed = false;
    await this.render();
  }

  bindHotkeys(): void {
    this.bindKeyboard();
  }

  private bindKeyboard(): void {
    this.unbindKeyboard();
    this.keyHandler = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === "Space" && !this.revealed) {
        e.preventDefault();
        await this.reveal();
        return;
      }

      if (this.revealed) {
        const ratingMap: Record<string, RatingValue> = {
          Digit1: 1,
          "1": 1,
          Digit2: 2,
          "2": 2,
          Digit3: 3,
          "3": 3,
          Digit4: 4,
          "4": 4,
        };
        const rating = ratingMap[e.code] ?? ratingMap[e.key];
        if (rating) {
          e.preventDefault();
          await this.rate(rating);
        }
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  unbindKeyboard(): void {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }

  destroy(): void {
    this.unbindKeyboard();
  }
}
