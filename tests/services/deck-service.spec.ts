import { beforeEach, describe, expect, it } from "vitest";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";
import { createDeck, createReviewCard, createSessionDraft } from "../../src/domain/models";
import { DeckService } from "../../src/services/deck-service";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

describe("DeckService", () => {
  let repo: PluginDataRepository;
  let service: DeckService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new DeckService(repo);
  });

  it("creates nested decks with full-path labels", async () => {
    const parent = await service.createDeck({ name: "Science" });
    const child = await service.createDeck({
      name: "Biology",
      parentDeckId: parent.id,
    });

    const option = service.getDeckOptions().find((deck) => deck.id === child.id);
    expect(option?.label).toBe("Science :: Biology");
  });

  it("rejects duplicate sibling deck names", async () => {
    await service.createDeck({ name: "Science" });

    await expect(service.createDeck({ name: "science" })).rejects.toThrow(/already exists/i);
  });

  it("rejects cyclic reparenting", async () => {
    const parent = await service.createDeck({ name: "Science" });
    const child = await service.createDeck({
      name: "Biology",
      parentDeckId: parent.id,
    });

    await expect(
      service.updateDeck({
        deckId: parent.id,
        name: parent.name,
        parentDeckId: child.id,
      })
    ).rejects.toThrow(/subdecks/i);
  });

  it("archives a subtree and resets invalid default/session deck references", async () => {
    const parent = await service.createDeck({ name: "Science" });
    const child = await service.createDeck({
      name: "Biology",
      parentDeckId: parent.id,
    });
    await service.setDefaultDeck(child.id);

    await repo.save((data) => ({
      ...data,
      sessionDraft: createSessionDraft([], [child.id]),
    }));

    await service.setArchived(parent.id, true);

    const snap = repo.snapshot();
    expect(snap.settings.defaultDeckId).toBe("default");
    expect(snap.sessionDraft?.deckIds).toEqual([]);
    expect(snap.decks.find((deck) => deck.id === parent.id)?.archived).toBe(true);
    expect(snap.decks.find((deck) => deck.id === child.id)?.archived).toBe(true);
  });

  it("deletes a subtree and moves templates to the fallback deck", async () => {
    const parent = await service.createDeck({ name: "Science" });
    const child = await service.createDeck({
      name: "Biology",
      parentDeckId: parent.id,
    });
    const card = createReviewCard("template-1", "forward", "Q", "A");

    await repo.save((data) => ({
      ...data,
      decks: [...data.decks, createDeck({ id: "history", name: "History" })],
      templates: [
        {
          id: "template-1",
          kind: "basic",
          deckId: child.id,
          tagIds: [],
          sourceAnchor: {
            filePath: "notes/Biology.md",
            noteTitle: "Biology",
            startOffset: 0,
            endOffset: 1,
            selectedText: "Q",
            leadingContext: "",
            trailingContext: "",
            excerpt: "Q",
            contentHash: "hash",
            lastResolvedAt: new Date().toISOString(),
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
        },
      ],
      cards: [card],
    }));

    await service.deleteDeck(parent.id, "default");

    const snap = repo.snapshot();
    expect(snap.decks.some((deck) => deck.id === parent.id)).toBe(false);
    expect(snap.decks.some((deck) => deck.id === child.id)).toBe(false);
    expect(snap.templates[0]?.deckId).toBe("default");
  });
});
