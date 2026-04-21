import {
  createSessionDraft,
  createReviewLog,
  nowIso,
  type ReviewCardRecord,
  type ReviewSessionDraft,
  type ReviewRating,
} from "../domain/models";
import type { PluginDataRepository } from "../data/plugin-data-repository";
import { buildReviewQueue } from "../scheduling/review-queue";
import { scheduleReview, previewSchedule } from "../scheduling/fsrs-scheduler";

// ─── I/O types ────────────────────────────────────────────────────────────────

export interface StartReviewInput {
  deckIds?: string[];
  includeNewCards?: boolean;
}

export interface ReviewSessionPayload {
  session: ReviewSessionDraft;
  currentCard: ReviewCardRecord | null;
  remainingCount: number;
  progressPercent: number;
}

export interface RevealCardPayload {
  cardId: string;
  answerMarkdown: string;
  schedule: Record<ReviewRating, { state: string; intervalDays: number }>;
  shortcuts: { again: "1"; hard: "2"; good: "3"; easy: "4" };
}

export interface RateCardInput {
  sessionId: string;
  cardId: string;
  rating: ReviewRating;
  reviewedAt?: string;
}

export interface RateCardResult {
  updatedCard: ReviewCardRecord;
  nextCard: ReviewCardRecord | null;
  remainingCount: number;
  progressPercent: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ReviewSessionService {
  constructor(private readonly repository: PluginDataRepository) {}

  async start(input: StartReviewInput = {}): Promise<ReviewSessionPayload> {
    const data = await this.repository.load();
    const queue = buildReviewQueue(data, {
      deckIds: input.deckIds,
      includeNewCards: input.includeNewCards ?? true,
      now: new Date(),
      newCardsPerDay: data.settings.newCardsPerDay,
      maxReviewsPerDay: data.settings.maxReviewsPerDay,
    });

    const session = createSessionDraft(queue.map((c) => c.id), input.deckIds ?? []);

    await this.repository.save((d) => ({ ...d, sessionDraft: session }));

    const currentCard = queue[0] ?? null;
    return {
      session,
      currentCard,
      remainingCount: queue.length,
      progressPercent: 0,
    };
  }

  async reveal(sessionId: string): Promise<RevealCardPayload> {
    const data = await this.repository.load();
    const session = data.sessionDraft;

    if (!session || session.id !== sessionId) {
      throw new Error("Session not found");
    }

    const cardId = session.currentCardId;
    if (!cardId) throw new Error("No current card");

    const card = data.cards.find((c) => c.id === cardId);
    if (!card) throw new Error("Card not found");

    await this.repository.save((d) => ({
      ...d,
      sessionDraft: d.sessionDraft
        ? { ...d.sessionDraft, revealed: true, updatedAt: nowIso() }
        : null,
    }));

    const schedulePreview = previewSchedule(card, nowIso());

    return {
      cardId,
      answerMarkdown: card.answerMarkdown,
      schedule: {
        1: { state: schedulePreview[1].state, intervalDays: schedulePreview[1].intervalDays },
        2: { state: schedulePreview[2].state, intervalDays: schedulePreview[2].intervalDays },
        3: { state: schedulePreview[3].state, intervalDays: schedulePreview[3].intervalDays },
        4: { state: schedulePreview[4].state, intervalDays: schedulePreview[4].intervalDays },
      },
      shortcuts: { again: "1", hard: "2", good: "3", easy: "4" },
    };
  }

  async rate(input: RateCardInput): Promise<RateCardResult> {
    const reviewedAt = input.reviewedAt ?? nowIso();
    const data = await this.repository.load();
    const session = data.sessionDraft;

    if (!session || session.id !== input.sessionId) {
      throw new Error("Session not found");
    }

    if (!session.revealed) {
      throw new Error("Cannot rate before revealing the answer");
    }

    const cardIndex = data.cards.findIndex((c) => c.id === input.cardId);
    if (cardIndex === -1) throw new Error("Card not found");

    const card = data.cards[cardIndex]!;
    const updatedCard = scheduleReview(card, input.rating, reviewedAt);

    // Bury siblings if setting is enabled
    const siblingIds = data.templates
      .find((t) => t.id === card.templateId)
      ?.generatedCardIds.filter((id) => id !== card.id) ?? [];

    const buryUntil = data.settings.burySiblings ? endOfDayIso(reviewedAt) : null;

    // Build next session state
    const remainingQueue = session.queuedCardIds.filter((id) => id !== card.id);
    const nextCardId = remainingQueue[0] ?? null;

    const log = createReviewLog({
      sessionId: session.id,
      cardId: card.id,
      rating: input.rating,
      reviewedAt,
      previousState: card.state,
      nextState: updatedCard.state,
      previousDueAt: card.dueAt,
      nextDueAt: updatedCard.dueAt,
    });

    const updatedSession: ReviewSessionDraft = {
      ...session,
      queuedCardIds: remainingQueue,
      completedCardIds: [...session.completedCardIds, card.id],
      currentCardId: nextCardId,
      revealed: false,
      updatedAt: reviewedAt,
    };

    await this.repository.save((d) => ({
      ...d,
      cards: d.cards.map((c) => {
        if (c.id === updatedCard.id) return updatedCard;
        if (buryUntil && siblingIds.includes(c.id)) {
          return { ...c, buriedUntil: buryUntil, updatedAt: reviewedAt };
        }
        return c;
      }),
      logs: [...d.logs, log],
      sessionDraft: updatedSession,
    }));

    const nextCard = nextCardId
      ? (await this.repository.load()).cards.find((c) => c.id === nextCardId) ?? null
      : null;

    const total = session.completedCardIds.length + session.queuedCardIds.length;
    const completed = session.completedCardIds.length + 1;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 100;

    return {
      updatedCard,
      nextCard,
      remainingCount: remainingQueue.length,
      progressPercent,
    };
  }
}

function endOfDayIso(isoString: string): string {
  const d = new Date(isoString);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
