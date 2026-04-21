import { describe, it, expect, beforeEach } from "vitest";
import { DashboardService } from "../../src/services/dashboard-service";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";
import { createReviewCard } from "../../src/domain/models";
import type { ReviewCardRecord } from "../../src/domain/models";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

const past = new Date(Date.now() - 86400000).toISOString();

describe("DashboardService.getStats", () => {
  let repo: PluginDataRepository;
  let service: DashboardService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new DashboardService(repo);
  });

  it("returns zero counts when no cards exist", async () => {
    const stats = await service.getStats();
    expect(stats.dueToday).toBe(0);
    expect(stats.newCards).toBe(0);
  });

  it("counts due cards correctly", async () => {
    const due = { ...createReviewCard("t1", "forward", "Q", "A"), state: "review" as const, dueAt: past };
    await repo.save((d) => ({ ...d, cards: [due] }));
    const stats = await service.getStats();
    expect(stats.dueToday).toBe(1);
  });

  it("counts new cards correctly", async () => {
    const newCard = createReviewCard("t1", "forward", "Q", "A"); // state = "new"
    await repo.save((d) => ({ ...d, cards: [newCard] }));
    const stats = await service.getStats();
    expect(stats.newCards).toBe(1);
  });

  it("returns retention30d as a percentage between 0 and 100", async () => {
    const stats = await service.getStats();
    expect(stats.retention30d).toBeGreaterThanOrEqual(0);
    expect(stats.retention30d).toBeLessThanOrEqual(100);
  });

  it("returns streakDays as a non-negative number", async () => {
    const stats = await service.getStats();
    expect(stats.streakDays).toBeGreaterThanOrEqual(0);
  });

  it("includes recentlyAddedCardIds and needsAttentionCardIds arrays", async () => {
    const stats = await service.getStats();
    expect(Array.isArray(stats.recentlyAddedCardIds)).toBe(true);
    expect(Array.isArray(stats.needsAttentionCardIds)).toBe(true);
  });
});
