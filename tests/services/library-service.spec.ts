import { describe, it, expect, beforeEach } from "vitest";
import { LibraryService } from "../../src/services/library-service";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";
import { createDeck, createReviewCard } from "../../src/domain/models";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

const emptyQuery = {
  search: "",
  deckIds: [],
  tagIds: [],
  sourceFile: null,
  states: [] as any[],
  sortBy: "due" as const,
  sortDirection: "asc" as const,
};

describe("LibraryService.query", () => {
  let repo: PluginDataRepository;
  let service: LibraryService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new LibraryService(repo);
  });

  it("returns all cards with empty filters", async () => {
    const cards = [
      createReviewCard("t1", "forward", "Prompt A", "Answer A"),
      createReviewCard("t2", "forward", "Prompt B", "Answer B"),
    ];
    await repo.save((d) => ({ ...d, cards }));

    const result = await service.query(emptyQuery);
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it("paginates rows without changing the filtered total", async () => {
    const cards = Array.from({ length: 3 }, (_, index) =>
      createReviewCard(`t${index}`, "forward", `Prompt ${index}`, `Answer ${index}`)
    );
    await repo.save((d) => ({ ...d, cards }));

    const result = await service.query({
      ...emptyQuery,
      limit: 1,
      offset: 1,
      sortBy: "updated",
    });

    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].promptText).toBe("Prompt 1");
  });

  it("filters by text search", async () => {
    const cards = [
      createReviewCard("t1", "forward", "Photosynthesis", "Answer"),
      createReviewCard("t2", "forward", "Mitosis", "Cell division"),
    ];
    await repo.save((d) => ({ ...d, cards }));

    const result = await service.query({ ...emptyQuery, search: "photo" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].promptText).toMatch(/Photosynthesis/i);
  });

  it("filters by state", async () => {
    const newCard = createReviewCard("t1", "forward", "New Q", "A");
    const reviewCard = {
      ...createReviewCard("t2", "forward", "Review Q", "A"),
      state: "review" as const,
      dueAt: new Date().toISOString(),
    };
    await repo.save((d) => ({ ...d, cards: [newCard, reviewCard] }));

    const result = await service.query({ ...emptyQuery, states: ["new"] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].state).toBe("new");
  });

  it("filters by partial source file path", async () => {
    const card = createReviewCard("t1", "forward", "Prompt", "Answer");
    const template = {
      id: "t1",
      kind: "basic" as const,
      deckId: "default",
      tagIds: [],
      sourceAnchor: {
        filePath: "folder/Cell.md",
        noteTitle: "Cell",
        startOffset: 0,
        endOffset: 4,
        selectedText: "Cell",
        leadingContext: "",
        trailingContext: "",
        excerpt: "Cell",
        contentHash: "hash",
        lastResolvedAt: new Date().toISOString(),
      },
      frontMarkdown: "Prompt",
      backMarkdown: "Answer",
      clozeMarkdown: null,
      hintByClozeIndex: {},
      customTemplateId: null,
      generatedCardIds: [card.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
    };

    await repo.save((d) => ({ ...d, cards: [card], templates: [template] }));

    const result = await service.query({ ...emptyQuery, sourceFile: "Cell" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sourceFile).toBe("folder/Cell.md");
  });
});

describe("LibraryService.bulkUpdate", () => {
  let repo: PluginDataRepository;
  let service: LibraryService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new LibraryService(repo);
  });

  it("suspends selected cards", async () => {
    const card = createReviewCard("t1", "forward", "Q", "A");
    await repo.save((d) => ({ ...d, cards: [card] }));

    const { updatedCount } = await service.bulkUpdate({
      action: "suspend",
      cardIds: [card.id],
      suspended: true,
    });

    expect(updatedCount).toBe(1);
    const snap = repo.snapshot();
    expect(snap.cards[0].suspended).toBe(true);
  });

  it("restores the prior learning state after unsuspending", async () => {
    const learningCard = {
      ...createReviewCard("t1", "forward", "Q", "A"),
      state: "learning" as const,
      dueAt: new Date().toISOString(),
    };
    await repo.save((data) => ({ ...data, cards: [learningCard] }));

    await service.bulkUpdate({
      action: "suspend",
      cardIds: [learningCard.id],
      suspended: true,
    });

    await service.bulkUpdate({
      action: "suspend",
      cardIds: [learningCard.id],
      suspended: false,
    });

    const snap = repo.snapshot();
    expect(snap.cards[0].suspended).toBe(false);
    expect(snap.cards[0].state).toBe("learning");
  });

  it("deletes selected cards", async () => {
    const card = createReviewCard("t1", "forward", "Q", "A");
    await repo.save((d) => ({ ...d, cards: [card] }));

    await service.bulkUpdate({ action: "delete", cardIds: [card.id] });

    const snap = repo.snapshot();
    expect(snap.cards.some((c) => c.id === card.id)).toBe(false);
  });

  it("moves card to new deck", async () => {
    const card = createReviewCard("t1", "forward", "Q", "A");
    const newDeck = createDeck({ id: "new-deck", name: "New Deck" });
    const template = {
      id: "t1",
      kind: "basic" as const,
      deckId: "old-deck",
      tagIds: [],
      sourceAnchor: {
        filePath: "", noteTitle: "", startOffset: 0, endOffset: 0,
        selectedText: "", leadingContext: "", trailingContext: "",
        excerpt: "", contentHash: "", lastResolvedAt: new Date().toISOString(),
      },
      frontMarkdown: "Q",
      backMarkdown: "A",
      clozeMarkdown: null,
      hintByClozeIndex: {},
      customTemplateId: null,
      generatedCardIds: [card.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
    };
    await repo.save((d) => ({
      ...d,
      decks: [...d.decks, newDeck],
      cards: [card],
      templates: [template],
    }));

    await service.bulkUpdate({ action: "move", cardIds: [card.id], deckId: "new-deck" });

    const snap = repo.snapshot();
    const updatedTemplate = snap.templates[0];
    expect(updatedTemplate.deckId).toBe("new-deck");
  });

  it("rejects moves to a missing deck", async () => {
    const card = createReviewCard("t1", "forward", "Q", "A");
    const template = {
      id: "t1",
      kind: "basic" as const,
      deckId: "default",
      tagIds: [],
      sourceAnchor: {
        filePath: "", noteTitle: "", startOffset: 0, endOffset: 0,
        selectedText: "", leadingContext: "", trailingContext: "",
        excerpt: "", contentHash: "", lastResolvedAt: new Date().toISOString(),
      },
      frontMarkdown: "Q",
      backMarkdown: "A",
      clozeMarkdown: null,
      hintByClozeIndex: {},
      customTemplateId: null,
      generatedCardIds: [card.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
    };
    await repo.save((d) => ({ ...d, cards: [card], templates: [template] }));

    await expect(
      service.bulkUpdate({
        action: "move",
        cardIds: [card.id],
        deckId: "missing-deck",
      })
    ).rejects.toThrow(/DeckNotFoundError/);
  });

  it("creates missing tags when bulk tagging", async () => {
    const card = createReviewCard("t1", "forward", "Q", "A");
    const template = {
      id: "t1",
      kind: "basic" as const,
      deckId: "old-deck",
      tagIds: [],
      sourceAnchor: {
        filePath: "", noteTitle: "", startOffset: 0, endOffset: 0,
        selectedText: "", leadingContext: "", trailingContext: "",
        excerpt: "", contentHash: "", lastResolvedAt: new Date().toISOString(),
      },
      frontMarkdown: "Q",
      backMarkdown: "A",
      clozeMarkdown: null,
      hintByClozeIndex: {},
      customTemplateId: null,
      generatedCardIds: [card.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
    };
    await repo.save((d) => ({ ...d, cards: [card], templates: [template] }));

    await service.bulkUpdate({
      action: "tag",
      cardIds: [card.id],
      tagIds: ["biology"],
      createMissingTags: true,
    });

    const snap = repo.snapshot();
    expect(snap.tags.some((tag) => tag.label === "biology")).toBe(true);
    expect(snap.templates[0]?.tagIds).toHaveLength(1);
  });
});

describe("LibraryService.createDeck", () => {
  let repo: PluginDataRepository;
  let service: LibraryService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new LibraryService(repo);
  });

  it("creates a deck with a trimmed name", async () => {
    const deck = await service.createDeck({ name: "  Exam Deck  " });

    expect(deck.name).toBe("Exam Deck");
    expect(repo.snapshot().decks.some((candidate) => candidate.id === deck.id)).toBe(true);
  });

  it("rejects duplicate deck names case-insensitively", async () => {
    await service.createDeck({ name: "Biology" });

    await expect(service.createDeck({ name: " biology " })).rejects.toThrow(
      /DeckAlreadyExistsError/
    );
  });
});
