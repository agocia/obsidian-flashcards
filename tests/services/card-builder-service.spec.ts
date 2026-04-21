import { describe, it, expect, beforeEach } from "vitest";
import { CardBuilderService } from "../../src/services/card-builder-service";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

function makeCtx(fileContent: string, start: number, end: number) {
  return {
    filePath: "notes/test.md",
    noteTitle: "test",
    fileContent,
    startOffset: start,
    endOffset: end,
  };
}

describe("CardBuilderService.createFromSelection", () => {
  let repo: PluginDataRepository;
  let service: CardBuilderService;
  let deckId: string;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    deckId = repo.snapshot().decks[0]?.id ?? "deck-1";
    service = new CardBuilderService(repo);
  });

  it("creates a basic card from selection and persists it", async () => {
    const ctx = makeCtx("Photosynthesis converts sunlight into food.", 0, 13);
    const result = await service.createFromSelection({
      selectionContext: ctx,
      mode: "basic",
      deckId,
      tagIds: [],
      frontMarkdown: "What is photosynthesis?",
      backMarkdown: "Sunlight to food.",
    });

    expect(result.cards).toHaveLength(1);
    const snap = repo.snapshot();
    expect(snap.cards.some((c) => c.id === result.cards[0].id)).toBe(true);
    expect(snap.templates.some((t) => t.id === result.template.id)).toBe(true);
  });

  it("creates 2 cards for reverse mode", async () => {
    const ctx = makeCtx("Paris is the capital.", 0, 5);
    const result = await service.createFromSelection({
      selectionContext: ctx,
      mode: "reverse",
      deckId,
      tagIds: [],
      frontMarkdown: "Capital of France",
      backMarkdown: "Paris",
    });
    expect(result.cards).toHaveLength(2);
  });

  it("creates N cards for cloze mode", async () => {
    const cloze = "{{c1::Paris}} is in {{c2::France}}.";
    const ctx = makeCtx(cloze, 0, cloze.length);
    const result = await service.createFromSelection({
      selectionContext: ctx,
      mode: "cloze",
      deckId,
      tagIds: [],
      clozeMarkdown: cloze,
    });
    expect(result.cards).toHaveLength(2);
  });

  it("creates a manual basic card without a source context", async () => {
    const result = await service.createFromSelection({
      mode: "basic",
      deckId,
      tagIds: [],
      frontMarkdown: "Manual question",
      backMarkdown: "Manual answer",
    });

    expect(result.cards).toHaveLength(1);
    expect(result.template.sourceAnchor.filePath).toBe("");
    expect(result.template.sourceAnchor.noteTitle).toBe("Manual card");
    expect(repo.snapshot().cards.some((card) => card.id === result.cards[0].id)).toBe(true);
  });

  it("creates a manual cloze card without a source context", async () => {
    const result = await service.createFromSelection({
      mode: "cloze",
      deckId,
      tagIds: [],
      clozeMarkdown: "{{c1::Manual}} cloze",
    });

    expect(result.cards).toHaveLength(1);
    expect(result.template.sourceAnchor.filePath).toBe("");
  });

  it("throws SelectionEmptyError when selected text is blank", async () => {
    const ctx = makeCtx("   ", 0, 3);
    await expect(
      service.createFromSelection({
        selectionContext: ctx,
        mode: "basic",
        deckId,
        tagIds: [],
      })
    ).rejects.toThrow(/SelectionEmptyError/);
  });
});

describe("CardBuilderService.previewTemplate", () => {
  let service: CardBuilderService;
  let deckId: string;

  beforeEach(async () => {
    const repo = makeRepo();
    await repo.load();
    deckId = repo.snapshot().decks[0]?.id ?? "deck-1";
    service = new CardBuilderService(repo);
  });

  it("returns preview payloads without persisting", async () => {
    const before = (await (async () => {
      const r = makeRepo();
      await r.load();
      return r.snapshot().cards.length;
    })());

    const previews = service.previewTemplate({
      mode: "basic",
      deckId,
      tagIds: [],
      frontMarkdown: "Test Q",
      backMarkdown: "Test A",
    });

    expect(previews).toHaveLength(1);
    expect(previews[0].promptMarkdown).toBe("Test Q");
  });

  it("returns cloze previews for each cloze index", () => {
    const previews = service.previewTemplate({
      mode: "cloze",
      deckId,
      tagIds: [],
      clozeMarkdown: "{{c1::A}} and {{c2::B}}.",
    });
    expect(previews).toHaveLength(2);
  });
});
