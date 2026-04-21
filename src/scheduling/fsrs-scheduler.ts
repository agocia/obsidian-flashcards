import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";
import {
  nowIso,
  type ReviewCardRecord,
  type ReviewCardState,
  type ReviewRating,
} from "../domain/models";

// ─── FSRS state mapping ───────────────────────────────────────────────────────

const FSRS_STATE_TO_DOMAIN: Record<number, ReviewCardState> = {
  0: "new",
  1: "learning",
  2: "review",
  3: "relearning",
};

function domainStateToFsrs(state: ReviewCardState): number {
  switch (state) {
    case "new": return 0;
    case "learning": return 1;
    case "review": return 2;
    case "relearning": return 3;
    case "suspended": return 0; // treat suspended as new for scheduling
    default: return 0;
  }
}

function fsrsStateToDomain(state: number): ReviewCardState {
  return FSRS_STATE_TO_DOMAIN[state] ?? "new";
}

const RATING_MAP: Record<ReviewRating, Rating> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

// ─── Scheduler ────────────────────────────────────────────────────────────────

const scheduler = fsrs();

/** Convert a domain ReviewCardRecord to a ts-fsrs Card shape. */
function toFsrsCard(card: ReviewCardRecord): FsrsCard {
  const base = createEmptyCard();
  return {
    ...base,
    state: domainStateToFsrs(card.state) as FsrsCard["state"],
    stability: card.stability ?? base.stability,
    difficulty: card.difficulty ?? base.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.lastReviewedAt ? new Date(card.lastReviewedAt) : base.last_review,
    due: card.dueAt ? new Date(card.dueAt) : base.due,
  };
}

/** Apply a rating to a card and return the updated ReviewCardRecord. */
export function scheduleReview(
  card: ReviewCardRecord,
  rating: ReviewRating,
  reviewedAt: string
): ReviewCardRecord {
  const fsrsCard = toFsrsCard(card);
  const now = new Date(reviewedAt);

  const fsrsRating = RATING_MAP[rating] as Grade;
  const output = scheduler.next(fsrsCard, now, fsrsRating);
  const next = output.card;

  const nextState = fsrsStateToDomain(next.state as number);
  const isCorrect = rating !== 1;

  return {
    ...card,
    state: nextState,
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    dueAt: next.due.toISOString(),
    lastReviewedAt: reviewedAt,
    reviewCount: card.reviewCount + 1,
    correctCount: card.correctCount + (isCorrect ? 1 : 0),
    updatedAt: reviewedAt,
  };
}

/** Preview all 4 rating outcomes without committing. */
export function previewSchedule(
  card: ReviewCardRecord,
  now: string
): Record<ReviewRating, { state: ReviewCardState; dueAt: string; intervalDays: number }> {
  const fsrsCard = toFsrsCard(card);
  const nowDate = new Date(now);

  return {
    1: makePreview(fsrsCard, Rating.Again, nowDate),
    2: makePreview(fsrsCard, Rating.Hard, nowDate),
    3: makePreview(fsrsCard, Rating.Good, nowDate),
    4: makePreview(fsrsCard, Rating.Easy, nowDate),
  };
}

function makePreview(
  fsrsCard: FsrsCard,
  rating: Rating,
  now: Date
): { state: ReviewCardState; dueAt: string; intervalDays: number } {
  const output = scheduler.next(fsrsCard, now, rating as Grade);
  return {
    state: fsrsStateToDomain(output.card.state as number),
    dueAt: output.card.due.toISOString(),
    intervalDays: output.card.scheduled_days,
  };
}

// ─── Thin class wrapper (for DI / UI use) ────────────────────────────────────

export class FSRSScheduler {
  schedule(
    card: ReviewCardRecord,
    rating: ReviewRating,
    reviewedAt: string
  ): ReviewCardRecord {
    return scheduleReview(card, rating, reviewedAt);
  }

  previewSchedule(
    card: ReviewCardRecord,
    now: Date
  ): {
    again: { scheduledDays: number };
    hard: { scheduledDays: number };
    good: { scheduledDays: number };
    easy: { scheduledDays: number };
  } {
    const result = previewSchedule(card, now.toISOString());
    return {
      again: { scheduledDays: result[1].intervalDays },
      hard:  { scheduledDays: result[2].intervalDays },
      good:  { scheduledDays: result[3].intervalDays },
      easy:  { scheduledDays: result[4].intervalDays },
    };
  }
}
