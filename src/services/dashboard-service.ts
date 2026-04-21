import type { PluginDataRepository } from "../data/plugin-data-repository";
import type { PluginData, ReviewCardRecord, ReviewLogRecord } from "../domain/models";
import { getDeckLabel, listDeckOptions, sanitizeDeckSelection } from "../domain/deck-utils";
import { countDueToday, countNewCards } from "../scheduling/review-queue";

// ─── Output type ──────────────────────────────────────────────────────────────

export interface DashboardStats {
  dueToday: number;
  newCards: number;
  retention30d: number;
  streakDays: number;
  nextReviewBlockAt: string | null;
  continueDeckId: string | null;
  continueDeckName: string | null;
  reviewDecks: Array<{ id: string; label: string }>;
  recentlyAddedCardIds: string[];
  needsAttentionCardIds: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DashboardService {
  constructor(private readonly repository: PluginDataRepository) {}

  getStats(now: Date = new Date()): DashboardStats {
    const data = this.repository.snapshot();
    const sessionDeckIds = sanitizeDeckSelection(data.decks, data.sessionDraft?.deckIds);
    const continueDeckId = sessionDeckIds[0] ?? null;
    const continueDeckName = data.sessionDraft
      ? sessionDeckIds.length === 0
        ? "All decks"
        : getDeckLabel(data.decks, continueDeckId)
      : null;
    const activeCardIds = getActiveDeckCardIds(data);

    return {
      dueToday: countDueToday(data, now),
      newCards: countNewCards(data),
      retention30d: calculateRetention30d(data.logs, now),
      streakDays: calculateStreakDays(data.logs, now),
      nextReviewBlockAt: nextReviewBlockIso(now, data.settings.nextReviewBlockHour),
      continueDeckId,
      continueDeckName,
      reviewDecks: listDeckOptions(data.decks).map((deck) => ({
        id: deck.id,
        label: deck.label,
      })),
      recentlyAddedCardIds: findRecentlyAdded(data.cards, activeCardIds, now),
      needsAttentionCardIds: findNeedsAttention(data.cards, activeCardIds),
    };
  }
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

function calculateRetention30d(logs: ReviewLogRecord[], now: Date): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString();

  const recent = logs.filter((l) => l.reviewedAt >= cutoffIso);
  if (recent.length === 0) return 0;

  const correct = recent.filter((l) => l.rating !== 1).length;
  return Math.round((correct / recent.length) * 100);
}

function calculateStreakDays(logs: ReviewLogRecord[], now: Date): number {
  if (logs.length === 0) return 0;

  // Build set of unique review dates (YYYY-MM-DD)
  const reviewDates = new Set(
    logs.map((l) => l.reviewedAt.slice(0, 10))
  );

  let streak = 0;
  const cursor = new Date(now);

  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!reviewDates.has(dateStr)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function nextReviewBlockIso(now: Date, blockHour: number): string | null {
  const today = new Date(now);
  today.setHours(blockHour, 0, 0, 0);

  if (today > now) return today.toISOString();

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}

function findRecentlyAdded(
  cards: ReviewCardRecord[],
  activeCardIds: Set<string>,
  now: Date
): string[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffIso = cutoff.toISOString();

  return cards
    .filter((c) => activeCardIds.has(c.id) && c.createdAt >= cutoffIso && !c.suspended)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, 10)
    .map((c) => c.id);
}

function findNeedsAttention(
  cards: ReviewCardRecord[],
  activeCardIds: Set<string>
): string[] {
  return cards
    .filter((c) => activeCardIds.has(c.id) && !c.suspended && c.lapses >= 3)
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, 10)
    .map((c) => c.id);
}

function getActiveDeckCardIds(
  data: Pick<PluginData, "cards" | "templates" | "decks">
): Set<string> {
  if (data.decks.length === 0 || data.templates.length === 0) {
    return new Set(data.cards.map((card) => card.id));
  }

  const activeDeckIds = new Set(
    data.decks.filter((deck) => !deck.archived).map((deck) => deck.id)
  );

  const templatedCardIds = new Set<string>();
  const activeCardIds = new Set<string>();

  data.templates.forEach((template) => {
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
