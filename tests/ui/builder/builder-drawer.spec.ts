import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionContext } from "../../../src/data/source-anchor-resolver";
import { createReviewCard, type CardTemplateRecord } from "../../../src/domain/models";
import { BuilderDrawer } from "../../../src/ui/builder/builder-drawer";

vi.mock("obsidian", () => ({
  Notice: class Notice {
    constructor(_message: string) {}
  },
}));

function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    empty?: () => void;
    addClass?: (...classes: string[]) => void;
    removeClass?: (...classes: string[]) => void;
    createDiv?: (opts?: Record<string, unknown>) => HTMLDivElement;
    createSpan?: (opts?: Record<string, unknown>) => HTMLSpanElement;
    createEl?: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      opts?: Record<string, unknown>
    ) => HTMLElementTagNameMap[K];
  };

  proto.empty ??= function empty() {
    this.innerHTML = "";
  };

  proto.addClass ??= function addClass(...classes: string[]) {
    this.classList.add(...classes);
  };

  proto.removeClass ??= function removeClass(...classes: string[]) {
    this.classList.remove(...classes);
  };

  proto.createDiv ??= function createDiv(opts?: Record<string, unknown>) {
    return createElement(this, "div", opts);
  };

  proto.createSpan ??= function createSpan(opts?: Record<string, unknown>) {
    return createElement(this, "span", opts);
  };

  proto.createEl ??= function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: Record<string, unknown>
  ) {
    return createElement(this, tag, opts);
  };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  opts?: Record<string, unknown>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts) {
    for (const [key, value] of Object.entries(opts)) {
      if (value == null) continue;
      if (key === "cls") {
        el.className = String(value);
        continue;
      }
      if (key === "text") {
        el.textContent = String(value);
        continue;
      }
      if (key === "attr") {
        for (const [attrKey, attrValue] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (attrValue != null) {
            el.setAttribute(attrKey, String(attrValue));
          }
        }
        continue;
      }
      (el as Record<string, unknown>)[key] = value;
    }
  }
  parent.appendChild(el);
  return el;
}

function makeSelectionContext(): SelectionContext {
  return {
    filePath: "notes/Biology.md",
    noteTitle: "Biology",
    fileContent: "Cell membrane context",
    startOffset: 0,
    endOffset: 13,
  };
}

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("BuilderDrawer", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    document.body.innerHTML = "";
  });

  it("can attach source context to a manual card without wiping typed content", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      previewTemplate: vi.fn((input) => [
        {
          variantKey: "forward",
          promptMarkdown: input.frontMarkdown ?? input.clozeMarkdown ?? "",
          answerMarkdown: input.backMarkdown ?? "",
        },
      ]),
      createFromSelection: vi.fn(),
    };
    const repository = {
      snapshot: () => ({
        settings: {
          defaultDeckId: "default",
          defaultCardMode: "basic",
          previewDebounceMs: 0,
        },
        decks: [{ id: "default", name: "Default", archived: false }],
      }),
    };
    const onPickSourceNote = vi.fn((_mode, onAttach) => {
      onAttach(makeSelectionContext());
    });

    const drawer = new BuilderDrawer(
      service as any,
      repository as any,
      undefined,
      undefined,
      onPickSourceNote
    );
    drawer.mount(container);
    drawer.open(undefined, "basic");

    const frontArea = container.querySelector("textarea") as HTMLTextAreaElement;
    frontArea.value = "Manual prompt";
    frontArea.dispatchEvent(new Event("input", { bubbles: true }));

    const attachButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Attach Source Note"
    ) as HTMLButtonElement | undefined;
    attachButton?.click();

    const updatedFrontArea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(onPickSourceNote).toHaveBeenCalledWith("basic", expect.any(Function));
    expect(container.textContent).toContain("Source: Biology");
    expect(container.textContent).toContain("Source context · Biology");
    expect(updatedFrontArea.value).toBe("Manual prompt");
  });

  it("keeps the builder open after saving and clears content for the next card", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      previewTemplate: vi.fn((input) => [
        {
          variantKey: "forward",
          promptMarkdown: input.frontMarkdown ?? "",
          answerMarkdown: input.backMarkdown ?? "",
        },
      ]),
      createFromSelection: vi.fn().mockResolvedValue({ cards: [] }),
    };
    const repository = {
      snapshot: () => ({
        settings: {
          defaultDeckId: "default",
          defaultCardMode: "basic",
          previewDebounceMs: 0,
        },
        decks: [{ id: "default", name: "Default", archived: false }],
      }),
    };

    const drawer = new BuilderDrawer(service as any, repository as any);
    drawer.mount(container);
    drawer.open(undefined, "basic");

    const [frontArea, backArea] = Array.from(container.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    frontArea.value = "Question";
    frontArea.dispatchEvent(new Event("input", { bubbles: true }));
    backArea.value = "Answer";
    backArea.dispatchEvent(new Event("input", { bubbles: true }));

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((button) => button.textContent === "Save & Add Another")).toBe(false);
    const saveButton = buttons.find((button) => button.textContent === "Save") as HTMLButtonElement | undefined;
    saveButton?.click();
    await flushDom();

    expect(service.createFromSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        frontMarkdown: "Question",
        backMarkdown: "Answer",
      })
    );
    expect(container.textContent).toContain("Capture the idea while it is still fresh.");
    const [nextFrontArea, nextBackArea] = Array.from(container.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    expect(nextFrontArea.value).toBe("");
    expect(nextBackArea.value).toBe("");
  });

  it("opens an existing card in edit mode and saves changes through the drawer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const card = createReviewCard("tpl-1", "forward", "Old prompt", "Old answer");
    card.id = "card-1";
    const template: CardTemplateRecord = {
      id: "tpl-1",
      kind: "basic",
      deckId: "default",
      tagIds: [],
      sourceAnchor: {
        filePath: "notes/Biology.md",
        noteTitle: "Biology",
        startOffset: 0,
        endOffset: 0,
        selectedText: "Cell",
        leadingContext: "",
        trailingContext: "",
        excerpt: "Cell",
        contentHash: "",
        lastResolvedAt: "2026-04-21T00:00:00.000Z",
      },
      frontMarkdown: "Old prompt",
      backMarkdown: "Old answer",
      clozeMarkdown: null,
      hintByClozeIndex: {},
      customTemplateId: null,
      generatedCardIds: ["card-1"],
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      archived: false,
    };

    const service = {
      previewTemplate: vi.fn(() => []),
      createFromSelection: vi.fn(),
    };
    const repository = {
      snapshot: () => ({
        settings: {
          defaultDeckId: "default",
          defaultCardMode: "basic",
          previewDebounceMs: 0,
        },
        decks: [{ id: "default", name: "Default", archived: false }],
        cards: [card],
        templates: [template],
      }),
    };
    const onSaveCardEdit = vi.fn().mockResolvedValue({});

    const drawer = new BuilderDrawer(
      service as any,
      repository as any,
      undefined,
      undefined,
      undefined,
      undefined,
      onSaveCardEdit
    );
    drawer.mount(container);
    drawer.openForEdit("card-1");

    expect(container.textContent).toContain("Edit card");
    expect(container.textContent).toContain("Source: Biology");

    const [frontArea, backArea] = Array.from(container.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    expect(frontArea.value).toBe("Old prompt");
    expect(backArea.value).toBe("Old answer");

    frontArea.value = "New prompt";
    frontArea.dispatchEvent(new Event("input", { bubbles: true }));
    backArea.value = "New answer";
    backArea.dispatchEvent(new Event("input", { bubbles: true }));

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save changes"
    ) as HTMLButtonElement | undefined;
    saveButton?.click();
    await flushDom();

    expect(onSaveCardEdit).toHaveBeenCalledWith({
      cardId: "card-1",
      promptMarkdown: "New prompt",
      answerMarkdown: "New answer",
      deckId: "default",
    });
    expect(service.createFromSelection).not.toHaveBeenCalled();
  });
});
