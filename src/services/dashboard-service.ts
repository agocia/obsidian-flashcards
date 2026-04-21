import type { PluginDataRepository } from "../data/plugin-data-repository";
import type { PluginData, ReviewCardRecord, ReviewLogRecord } from "../domain/models";
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
  recentlyAddedCardIds: string[];
  needsAttentionCardIds: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DashboardService {
  constructor(private readonly repository: PluginDataRepository) {}

  getStats(now: Date = new Date()): DashboardStats {
    const data = this.repository.snapshot();
    const continueDeckId = data.sessionDraft?.deckIds?.[0] ?? null;
    const continueDeckName =
      data.decks.find((deck) => deck.id === continueDeckId)?.name ?? continueDeckId;

    return {
      dueToday: countDueToday(data.cards, now),
      newCards: countNewCards(data.cards),
      retention30d: calculateRetention30d(data.logs, now),
      streakDays: calculateStreakDays(data.logs, now),
      nextReviewBlockAt: nextReviewBlockIso(now, data.settings.nextReviewBlockHour),
      continueDeckId,
      continueDeckName,
      recentlyAddedCardIds: findRecentlyAdded(data.cards, now),
      needsAttentionCardIds: findNeedsAttention(data.cards),
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

function findRecentlyAdded(cards: ReviewCardRecord[], now: Date): string[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffIso = cutoff.toISOString();

  return cards
    .filter((c) => c.createdAt >= cutoffIso && !c.suspended)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, 10)
    .map((c) => c.id);
}

function findNeedsAttention(cards: ReviewCardRecord[]): string[] {
  return cards
    .filter((c) => !c.suspended && c.lapses >= 3)
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, 10)
    .map((c) => c.id);
}
