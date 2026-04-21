import { describe, it, expect, beforeEach } from "vitest";
import { ReviewSessionService } from "../../src/services/review-session-service";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";
import { createReviewCard } from "../../src/domain/models";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

const past = new Date(Date.now() - 86400000).toISOString();

describe("ReviewSessionService", () => {
  let repo: PluginDataRepository;
  let service: ReviewSessionService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new ReviewSessionService(repo);
  });

  it("starts a session with at least 1 card", async () => {
    const due = { ...createReviewCard("t1", "forward", "Q", "A"), state: "review" as const, dueAt: past };
    await repo.save((d) => ({ ...d, cards: [due] }));

    const payload = await service.start({ deckIds: [], includeNewCards: true });
    expect(payload.currentCard).not.toBeNull();
    expect(payload.session.queuedCardIds.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty session when no due cards", async () => {
    const payload = await service.start({ deckIds: [], includeNewCards: false });
    expect(payload.currentCard).toBeNull();
    expect(payload.remainingCount).toBe(0);
  });

  it("marks session as revealed after reveal()", async () => {
    const due = { ...createReviewCard("t1", "forward", "Q", "A"), state: "review" as const, dueAt: past };
    await repo.save((d) => ({ ...d, cards: [due] }));

    const { session } = await service.start({ deckIds: [], includeNewCards: true });
    await service.reveal(session.id);

    const snap = repo.snapshot();
    expect(snap.sessionDraft!.revealed).toBe(true);
  });

  it("rejects rating before reveal", async () => {
    const due = { ...createReviewCard("t1", "forward", "Q", "A"), state: "review" as const, dueAt: past };
    await repo.save((d) => ({ ...d, cards: [due] }));

    const { session } = await service.start({ deckIds: [], includeNewCards: true });

    await expect(
      service.rate({ sessionId: session.id, cardId: due.id, rating: 3, reviewedAt: new Date().toISOString() })
    ).rejects.toThrow(/reveal/i);
  });

  it("advances to next card after rating", async () => {
    const cards = [
      { ...createReviewCard("t1", "forward", "Q1", "A1"), state: "review" as const, dueAt: past },
      { ...createReviewCard("t2", "forward", "Q2", "A2"), state: "review" as const, dueAt: past },
    ];
    await repo.save((d) => ({ ...d, cards }));

    const { session, currentCard } = await service.start({ deckIds: [], includeNewCards: true });
    expect(currentCard).not.toBeNull();

    await service.reveal(session.id);
    const result = await service.rate({
      sessionId: session.id,
      cardId: currentCard!.id,
      rating: 3,
      reviewedAt: new Date().toISOString(),
    });

    expect(result.nextCard?.id).not.toBe(currentCard?.id);
    expect(result.nextCard).not.toBeNull();
  });

  it("writes a review log entry for each rating", async () => {
    const due = { ...createReviewCard("t1", "forward", "Q", "A"), state: "review" as const, dueAt: past };
    await repo.save((d) => ({ ...d, cards: [due] }));

    const { session } = await service.start({ deckIds: [], includeNewCards: true });
    await service.reveal(session.id);
    await service.rate({ sessionId: session.id, cardId: due.id, rating: 3, reviewedAt: new Date().toISOString() });

    const snap = repo.snapshot();
    expect(snap.logs.length).toBeGreaterThanOrEqual(1);
    expect(snap.logs[0].sessionId).toBe(session.id);
  });
});
