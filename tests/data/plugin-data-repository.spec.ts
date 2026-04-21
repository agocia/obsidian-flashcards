import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";
import { createDefaultPluginData } from "../../src/domain/models";

function makeAdapter() {
  let stored: unknown = undefined;
  return {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
}

describe("PluginDataRepository", () => {
  it("loads default data when storage is empty", async () => {
    const repo = new PluginDataRepository(makeAdapter());
    const data = await repo.load();
    expect(data.version).toBeGreaterThan(0);
    expect(Array.isArray(data.decks)).toBe(true);
  });

  it("persists data via save mutator", async () => {
    const adapter = makeAdapter();
    const repo = new PluginDataRepository(adapter);
    await repo.load();

    const updated = await repo.save((d) => ({
      ...d,
      decks: [...d.decks, {
        id: "deck-1",
        name: "Test Deck",
        parentDeckId: null,
        newLimitPerDay: null,
        reviewLimitPerDay: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archived: false,
      }],
    }));

    expect(updated.decks.some((d) => d.id === "deck-1")).toBe(true);
  });

  it("snapshot reflects last loaded state", async () => {
    const repo = new PluginDataRepository(makeAdapter());
    await repo.load();
    const snap = repo.snapshot();
    expect(snap.version).toBeGreaterThan(0);
  });

  it("replaces data entirely on replace()", async () => {
    const adapter = makeAdapter();
    const repo = new PluginDataRepository(adapter);
    await repo.load();

    const fresh = createDefaultPluginData();
    fresh.settings.newCardsPerDay = 999;
    await repo.replace(fresh);

    const snap = repo.snapshot();
    expect(snap.settings.newCardsPerDay).toBe(999);
  });

  it("re-loads from storage after invalidate()", async () => {
    const adapter = makeAdapter();
    const repo = new PluginDataRepository(adapter);
    await repo.load();

    // Save a new cards count via adapter directly
    const newData = createDefaultPluginData();
    newData.settings.maxReviewsPerDay = 777;
    await adapter.saveData(newData);

    repo.invalidate();
    const reloaded = await repo.load();
    expect(reloaded.settings.maxReviewsPerDay).toBe(777);
  });
});
