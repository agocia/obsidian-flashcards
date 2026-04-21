import { describe, it, expect } from "vitest";
import { buildReviewQueue, countDueToday, countNewCards } from "../../src/scheduling/review-queue";
import { createReviewCard } from "../../src/domain/models";
import type { ReviewCardRecord } from "../../src/domain/models";

function makeCard(overrides: Partial<ReviewCardRecord> = {}): ReviewCardRecord {
  return {
    ...createReviewCard("tpl-1", "forward", "Prompt", "Answer"),
    ...overrides,
  };
}

const past  = new Date(Date.now() - 86400000).toISOString();  // yesterday
const future = new Date(Date.now() + 86400000).toISOString(); // tomorrow

const LIMITS = { includeNewCards: true, maxReviewsPerDay: 100, newCardsPerDay: 20 };

describe("buildReviewQueue", () => {
  it("includes overdue review cards", () => {
    const card = makeCard({ state: "review", dueAt: past });
    const queue = buildReviewQueue({ cards: [card], templates: [] }, { ...LIMITS, now: new Date() });
    expect(queue.map((c) => c.id)).toContain(card.id);
  });

  it("excludes future due cards", () => {
    const card = makeCard({ state: "review", dueAt: future });
    const queue = buildReviewQueue({ cards: [card], templates: [] }, { ...LIMITS, now: new Date() });
    expect(queue.map((c) => c.id)).not.toContain(card.id);
  });

  it("excludes suspended cards", () => {
    const card = makeCard({ state: "suspended", suspended: true, dueAt: past });
    const queue = buildReviewQueue({ cards: [card], templates: [] }, { ...LIMITS, now: new Date() });
    expect(queue).toHaveLength(0);
  });

  it("excludes buried cards", () => {
    const card = makeCard({ dueAt: past, state: "review", buriedUntil: future });
    const queue = buildReviewQueue({ cards: [card], templates: [] }, { ...LIMITS, now: new Date() });
    expect(queue).toHaveLength(0);
  });

  it("respects maxReviewsPerDay limit", () => {
    const cards = Array.from({ length: 10 }, () => makeCard({ state: "review", dueAt: past }));
    const queue = buildReviewQueue(
      { cards, templates: [] },
      { includeNewCards: true, maxReviewsPerDay: 3, newCardsPerDay: 20, now: new Date() }
    );
    expect(queue.length).toBeLessThanOrEqual(3);
  });

  it("respects newCardsPerDay limit", () => {
    const cards = Array.from({ length: 20 }, () => makeCard({ state: "new" }));
    const queue = buildReviewQueue(
      { cards, templates: [] },
      { includeNewCards: true, maxReviewsPerDay: 100, newCardsPerDay: 5, now: new Date() }
    );
    const newCount = queue.filter((c) => c.state === "new").length;
    expect(newCount).toBeLessThanOrEqual(5);
  });

  it("orders overdue/learning before new cards", () => {
    const newCard = makeCard({ state: "new" });
    const overdueCard = makeCard({ state: "review", dueAt: past });
    const queue = buildReviewQueue(
      { cards: [newCard, overdueCard], templates: [] },
      { ...LIMITS, now: new Date() }
    );
    expect(queue[0].id).toBe(overdueCard.id);
  });
});

describe("countDueToday", () => {
  it("counts overdue and learning cards due now", () => {
    const cards = [
      makeCard({ state: "review", dueAt: past }),
      makeCard({ state: "learning", dueAt: past }),
      makeCard({ state: "new" }),
    ];
    expect(countDueToday(cards, new Date())).toBe(2);
  });
});

describe("countNewCards", () => {
  it("counts cards in new state", () => {
    const cards = [
      makeCard({ state: "new" }),
      makeCard({ state: "new" }),
      makeCard({ state: "review", dueAt: past }),
    ];
    expect(countNewCards(cards)).toBe(2);
  });
});
