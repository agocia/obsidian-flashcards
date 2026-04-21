import type { ReviewCardRecord, PluginData } from "../domain/models";

// ─── Queue build input ────────────────────────────────────────────────────────

export interface BuildQueueInput {
  deckIds?: string[];
  includeNewCards: boolean;
  now?: Date;
  newCardsPerDay?: number;
  maxReviewsPerDay?: number;
}

// ─── Queue builder ────────────────────────────────────────────────────────────

/**
 * Build an ordered review queue.
 * Order: overdue review cards → due-today review cards → learning/relearning → new cards.
 * Suspended and buried cards are excluded.
 */
export function buildReviewQueue(
  data: Pick<PluginData, "cards" | "templates">,
  input: BuildQueueInput
): ReviewCardRecord[] {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  // Resolve which deckIds to include (empty = all decks)
  const deckFilter = input.deckIds && input.deckIds.length > 0
    ? new Set(input.deckIds)
    : null;

  // Get template-to-deck mapping
  const templateDeckMap = new Map(
    data.templates.map((t) => [t.id, t.deckId])
  );

  // Filter candidates
  const candidates = data.cards.filter((card) => {
    if (card.suspended) return false;
    if (card.buriedUntil && card.buriedUntil > nowIso) return false;
    if (card.state === "suspended") return false;

    if (deckFilter) {
      const deckId = templateDeckMap.get(card.templateId);
      if (!deckId || !deckFilter.has(deckId)) return false;
    }

    return true;
  });

  // Split by category
  const dueReview: ReviewCardRecord[] = [];
  const learningDue: ReviewCardRecord[] = [];
  const newCards: ReviewCardRecord[] = [];

  for (const card of candidates) {
    const isDue = !card.dueAt || card.dueAt <= nowIso;

    if (card.state === "new") {
      if (input.includeNewCards) newCards.push(card);
    } else if (card.state === "learning" || card.state === "relearning") {
      if (isDue) learningDue.push(card);
    } else if (card.state === "review") {
      if (isDue) dueReview.push(card);
    }
  }

  // Sort due review by overdue-ness (most overdue first)
  dueReview.sort((a, b) => {
    const aDate = a.dueAt ?? "";
    const bDate = b.dueAt ?? "";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  // Sort learning by due time
  learningDue.sort((a, b) => {
    const aDate = a.dueAt ?? "";
    const bDate = b.dueAt ?? "";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  // Sort new by createdAt (oldest new first)
  newCards.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // Apply limits
  const maxReview = input.maxReviewsPerDay ?? 200;
  const maxNew = input.newCardsPerDay ?? 20;

  const reviewSlice = [...learningDue, ...dueReview].slice(0, maxReview);
  const newSlice = newCards.slice(0, maxNew);

  return [...reviewSlice, ...newSlice];
}

/** Count cards due today for dashboard metrics. */
export function countDueToday(cards: ReviewCardRecord[], now: Date): number {
  const todayEnd = endOfDay(now).toISOString();
  return cards.filter(
    (c) =>
      !c.suspended &&
      c.state !== "suspended" &&
      c.state !== "new" &&
      c.dueAt !== null &&
      c.dueAt <= todayEnd
  ).length;
}

/** Count cards in "new" state. */
export function countNewCards(cards: ReviewCardRecord[]): number {
  return cards.filter((c) => !c.suspended && c.state === "new").length;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
