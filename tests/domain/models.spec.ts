import { describe, it, expect } from "vitest";
import {
  createId,
  nowIso,
  createDefaultPluginData,
  createReviewCard,
  createSessionDraft,
  SCHEMA_VERSION,
} from "../../src/domain/models";

describe("createId", () => {
  it("returns a non-empty string", () => {
    expect(typeof createId()).toBe("string");
    expect(createId().length).toBeGreaterThan(0);
  });

  it("returns unique values each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId()));
    expect(ids.size).toBe(100);
  });
});

describe("nowIso", () => {
  it("returns a valid ISO datetime string", () => {
    const iso = nowIso();
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});

describe("createDefaultPluginData", () => {
  it("returns data at the expected schema version", () => {
    const data = createDefaultPluginData();
    expect(data.version).toBe(SCHEMA_VERSION);
  });

  it("includes empty collection arrays", () => {
    const data = createDefaultPluginData();
    expect(data.decks).toBeInstanceOf(Array);
    expect(data.tags).toBeInstanceOf(Array);
    expect(data.templates).toBeInstanceOf(Array);
    expect(data.cards).toBeInstanceOf(Array);
    expect(data.logs).toBeInstanceOf(Array);
  });

  it("includes non-empty default deck", () => {
    const data = createDefaultPluginData();
    expect(data.decks.length).toBeGreaterThanOrEqual(1);
  });

  it("has valid settings with required fields", () => {
    const s = createDefaultPluginData().settings;
    expect(s.newCardsPerDay).toBeGreaterThan(0);
    expect(s.maxReviewsPerDay).toBeGreaterThan(0);
    expect(["basic", "cloze"]).toContain(s.defaultCardMode);
    expect(["system", "light", "dark"]).toContain(s.themeMode);
  });
});

describe("createReviewCard", () => {
  it("creates a card with the given template id and variant key", () => {
    const card = createReviewCard("tpl-1", "forward", "Prompt", "Answer");
    expect(card.templateId).toBe("tpl-1");
    expect(card.variantKey).toBe("forward");
    expect(card.promptMarkdown).toBe("Prompt");
    expect(card.answerMarkdown).toBe("Answer");
  });

  it("initializes scheduling fields to zeroed/null values", () => {
    const card = createReviewCard("tpl-1", "forward", "P", "A");
    expect(card.state).toBe("new");
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.stability).toBeNull();
    expect(card.difficulty).toBeNull();
    expect(card.dueAt).toBeNull();
  });
});

describe("createSessionDraft", () => {
  it("creates a draft with ordered queue", () => {
    const draft = createSessionDraft(["c-1", "c-2", "c-3"]);
    expect(draft.queuedCardIds).toEqual(["c-1", "c-2", "c-3"]);
    expect(draft.completedCardIds).toEqual([]);
    expect(draft.currentCardId).toBe("c-1");
    expect(draft.revealed).toBe(false);
  });

  it("sets currentCardId to null for empty queue", () => {
    const draft = createSessionDraft([]);
    expect(draft.currentCardId).toBeNull();
  });
});
