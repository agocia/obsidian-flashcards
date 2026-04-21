import type { ReviewCardRecord, PluginData } from "../domain/models";
import { sanitizeDeckSelection } from "../domain/deck-utils";

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
  data: Pick<PluginData, "cards" | "templates" | "decks">,
  input: BuildQueueInput
): ReviewCardRecord[] {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const decks = data.decks ?? [];
  const templates = data.templates ?? [];
  const activeDeckIds = new Set(
    decks.filter((deck) => !deck.archived).map((deck) => deck.id)
  );

  // Resolve which deckIds to include (empty = all decks)
  const requestedDeckIds = sanitizeDeckSelection(decks, input.deckIds);
  const deckFilter = requestedDeckIds.length > 0
    ? new Set(requestedDeckIds)
    : null;

  // Get template-to-deck mapping
  const templateDeckMap = new Map(
    templates.map((t) => [t.id, t.deckId])
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

    const deckId = templateDeckMap.get(card.templateId);
    if (deckId && activeDeckIds.size > 0 && !activeDeckIds.has(deckId)) return false;

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
export function countDueToday(
  data: Pick<PluginData, "cards" | "templates" | "decks"> | ReviewCardRecord[],
  now: Date
): number {
  const cards = Array.isArray(data) ? data : data.cards;
  const activeCardIds = Array.isArray(data) ? null : getActiveDeckCardIds(data);
  const todayEnd = endOfDay(now).toISOString();
  return cards.filter(
    (c) =>
      (!activeCardIds || activeCardIds.has(c.id)) &&
      !c.suspended &&
      c.state !== "suspended" &&
      c.state !== "new" &&
      c.dueAt !== null &&
      c.dueAt <= todayEnd
  ).length;
}

/** Count cards in "new" state. */
export function countNewCards(
  data: Pick<PluginData, "cards" | "templates" | "decks"> | ReviewCardRecord[]
): number {
  const cards = Array.isArray(data) ? data : data.cards;
  const activeCardIds = Array.isArray(data) ? null : getActiveDeckCardIds(data);
  return cards.filter(
    (c) => (!activeCardIds || activeCardIds.has(c.id)) && !c.suspended && c.state === "new"
  ).length;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getActiveDeckCardIds(
  data: Pick<PluginData, "cards" | "templates" | "decks">
): Set<string> | null {
  const decks = data.decks ?? [];
  const templates = data.templates ?? [];
  if (decks.length === 0 || templates.length === 0) return null;

  const activeDeckIds = new Set(
    decks.filter((deck) => !deck.archived).map((deck) => deck.id)
  );
  const templatedCardIds = new Set<string>();
  const activeCardIds = new Set<string>();

  templates.forEach((template) => {
    template.generatedCardIds.forEach((cardId) => {
      templatedCardIds.add(cardId);
      if (activeDeckIds.has(template.deckId)) {
        activeCardIds.add(cardId);
      }
    });
  });

  data.cards.forEach((card) => {
    if (!templatedCardIds.has(card.id)) {
      activeCardIds.add(card.id);
    }
  });

  return activeCardIds;
}
