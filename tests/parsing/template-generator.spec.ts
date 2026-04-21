import { describe, it, expect } from "vitest";
import { generateTemplate } from "../../src/parsing/template-generator";
import { nowIso } from "../../src/domain/models";

const anchor = {
  filePath: "notes/test.md",
  noteTitle: "test",
  startOffset: 0,
  endOffset: 10,
  selectedText: "test text",
  leadingContext: "",
  trailingContext: "",
  excerpt: "test text",
  contentHash: "abc123",
  lastResolvedAt: nowIso(),
};

describe("generateTemplate — basic", () => {
  it("generates exactly 1 review card for basic mode", () => {
    const result = generateTemplate({
      mode: "basic",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      frontMarkdown: "What is photosynthesis?",
      backMarkdown: "The process by which plants make food.",
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].variantKey).toBe("forward");
    expect(result.cards[0].promptMarkdown).toBe("What is photosynthesis?");
    expect(result.cards[0].answerMarkdown).toBe("The process by which plants make food.");
  });

  it("links generated card id back to template", () => {
    const result = generateTemplate({
      mode: "basic",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      frontMarkdown: "Q",
      backMarkdown: "A",
    });
    expect(result.template.generatedCardIds).toContain(result.cards[0].id);
  });
});

describe("generateTemplate — reverse", () => {
  it("generates 2 review cards for reverse mode", () => {
    const result = generateTemplate({
      mode: "reverse",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      frontMarkdown: "Capital of France",
      backMarkdown: "Paris",
    });

    expect(result.cards).toHaveLength(2);
    const keys = result.cards.map((c) => c.variantKey);
    expect(keys).toContain("forward");
    expect(keys).toContain("reverse");
  });

  it("swaps prompt and answer for reverse card", () => {
    const result = generateTemplate({
      mode: "reverse",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      frontMarkdown: "Capital of France",
      backMarkdown: "Paris",
    });
    const rev = result.cards.find((c) => c.variantKey === "reverse")!;
    expect(rev.promptMarkdown).toBe("Paris");
    expect(rev.answerMarkdown).toBe("Capital of France");
  });
});

describe("generateTemplate — cloze", () => {
  it("generates 1 card per unique cloze index", () => {
    const result = generateTemplate({
      mode: "cloze",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      clozeMarkdown: "{{c1::Paris}} is the capital of {{c2::France}}.",
    });

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].variantKey).toBe("cloze:1");
    expect(result.cards[1].variantKey).toBe("cloze:2");
  });

  it("masks active cloze in prompt and reveals in answer", () => {
    const result = generateTemplate({
      mode: "cloze",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      clozeMarkdown: "The sky is {{c1::blue}}.",
    });

    const card = result.cards[0];
    expect(card.promptMarkdown).toContain("[...]");
    expect(card.answerMarkdown).toContain("blue");
  });

  it("renders other cloze fields visibly in prompt", () => {
    const result = generateTemplate({
      mode: "cloze",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      clozeMarkdown: "{{c1::A}} and {{c2::B}} are letters.",
    });

    const card1 = result.cards.find((c) => c.variantKey === "cloze:1")!;
    // c2 should be revealed in card1's prompt
    expect(card1.promptMarkdown).toContain("B");
    expect(card1.promptMarkdown).toContain("[...]");
  });

  it("throws if no cloze markers present", () => {
    expect(() =>
      generateTemplate({
        mode: "cloze",
        deckId: "deck-1",
        tagIds: [],
        sourceAnchor: anchor,
        clozeMarkdown: "No markers here.",
      })
    ).toThrow();
  });

  it("uses hint text in prompt when provided", () => {
    const result = generateTemplate({
      mode: "cloze",
      deckId: "deck-1",
      tagIds: [],
      sourceAnchor: anchor,
      clozeMarkdown: "{{c1::Paris::city name}}",
    });

    const card = result.cards[0];
    expect(card.promptMarkdown).toContain("city name");
  });
});
