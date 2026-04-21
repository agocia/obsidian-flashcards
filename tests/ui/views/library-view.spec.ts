import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryRow } from "../../../src/services/library-service";
import { LibraryView } from "../../../src/ui/views/library-view";

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

function makeRow(overrides: Partial<LibraryRow> = {}): LibraryRow {
  return {
    cardId: "card-1",
    variantKey: "forward",
    templateKind: "basic",
    promptMarkdown: "What is spaced repetition?",
    answerMarkdown: "Reviewing information at expanding intervals.",
    promptText: "What is spaced repetition?",
    answerText: "Reviewing information at expanding intervals.",
    deckName: "Default",
    tags: ["biology"],
    sourceNoteTitle: "Cell",
    sourceFile: "notes/Cell.md",
    dueAt: null,
    difficulty: 3.2,
    state: "new",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("LibraryView", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers unsuspend for selected suspended cards", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow({ cardId: "card-suspended", state: "suspended" })],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 1 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [{ id: "tag-1", label: "biology" }],
      ["notes/Cell.md"]
    );

    await view.render();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const unsuspendButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unsuspend"
    ) as HTMLButtonElement | undefined;

    expect(unsuspendButton).toBeDefined();

    unsuspendButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.bulkUpdate).toHaveBeenCalledWith({
      action: "suspend",
      cardIds: ["card-suspended"],
      suspended: false,
    });
  });

  it("keeps the selected-card action tray above the card list", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      []
    );

    await view.render();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const bulkHost = container.querySelector(".srf-library__bulk-host") as HTMLElement;
    const list = container.querySelector(".srf-library__list") as HTMLElement;

    expect(bulkHost).toBeDefined();
    expect(list).toBeDefined();
    expect(
      Boolean(bulkHost.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it("keeps card content out of the library list and opens the side editor", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const row = makeRow({
      cardId: "card-edit",
      promptMarkdown: "Private **Prompt**",
      answerMarkdown: "Private answer",
      promptText: "Private Prompt",
      answerText: "Private answer",
    });
    const service = {
      query: vi.fn().mockImplementation(async () => ({
        total: 1,
        rows: [row],
      })),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };
    const onEditCard = vi.fn();

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      onEditCard
    );

    await view.render();

    expect(container.textContent).not.toContain("Private Prompt");
    expect(container.textContent).not.toContain("Private answer");
    expect(container.textContent).toContain("Basic · Forward");

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Edit"
    ) as HTMLButtonElement | undefined;
    editButton?.click();

    expect(onEditCard).toHaveBeenCalledWith("card-edit");
  });

  it("reloads library filter metadata on every render", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };

    const loadOptions = vi
      .fn()
      .mockResolvedValueOnce({
        decks: [{ id: "default", name: "Default" }],
        tags: [{ id: "tag-1", label: "biology" }],
        sourceFiles: ["notes/Cell.md"],
      })
      .mockResolvedValueOnce({
        decks: [{ id: "default", name: "Default" }],
        tags: [
          { id: "tag-1", label: "biology" },
          { id: "tag-2", label: "chemistry" },
        ],
        sourceFiles: ["notes/Cell.md", "notes/Chemistry.md"],
      });

    const view = new (LibraryView as any)(
      container,
      service,
      [],
      [],
      [],
      undefined,
      undefined,
      loadOptions
    );

    await view.render();
    await view.render();

    expect(loadOptions).toHaveBeenCalledTimes(2);

    const optionLabels = Array.from(container.querySelectorAll("option")).map((option) => ({
      label: option.textContent?.trim(),
      value: option.getAttribute("value"),
    }));

    expect(optionLabels.some((option) => option.label === "chemistry")).toBe(true);
    expect(optionLabels.some((option) => option.value === "notes/Chemistry.md")).toBe(true);
  });

  it("renders the deck directory and filters by deck without source requirements", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [
        { id: "default", name: "Default" },
        { id: "deck-2", name: "Exam Deck" },
      ],
      [],
      []
    );

    await view.render();

    const deckButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Exam Deck"
    ) as HTMLButtonElement | undefined;
    deckButton?.click();
    await flushDom();

    expect(service.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deckIds: ["deck-2"],
        limit: 100,
        offset: 0,
      })
    );
  });

  it("renames the selected deck from the directory", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const options = {
      decks: [
        { id: "default", name: "Default" },
        { id: "deck-2", name: "Exam Deck" },
      ],
      tags: [],
      sourceFiles: [],
    };
    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow({ deckName: "Exam Deck" })],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
      renameDeck: vi.fn().mockImplementation(async ({ deckId, name }) => {
        options.decks = options.decks.map((deck) =>
          deck.id === deckId ? { ...deck, name } : deck
        );
        return { id: deckId, name };
      }),
    };

    const view = new LibraryView(
      container,
      service as any,
      options.decks,
      options.tags,
      options.sourceFiles,
      undefined,
      undefined,
      () => options
    );

    await view.render();

    const deckButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Exam Deck"
    ) as HTMLButtonElement | undefined;
    deckButton?.click();
    await flushDom();

    const renameButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rename Deck"
    ) as HTMLButtonElement | undefined;
    renameButton?.click();
    await flushDom();

    const input = container.querySelector(".srf-library__rename-deck-form input") as HTMLInputElement;
    input.value = "Renamed Deck";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save name"
    ) as HTMLButtonElement | undefined;
    saveButton?.click();
    await flushDom();

    expect(service.renameDeck).toHaveBeenCalledWith({
      deckId: "deck-2",
      name: "Renamed Deck",
    });
    expect(container.textContent).toContain("Renamed Deck");
  });

  it("offers a direct way back to the dashboard", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onOpenDashboard = vi.fn();

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      [],
      undefined,
      undefined,
      undefined,
      onOpenDashboard
    );

    await view.render();

    const dashboardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Dashboard"
    ) as HTMLButtonElement | undefined;
    dashboardButton?.click();

    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });

  it("paginates the library instead of rendering every card at once", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockImplementation(async (input: { offset?: number }) => ({
        total: 101,
        rows: [
          makeRow({
            cardId: input.offset === 100 ? "card-101" : "card-1",
            promptText: input.offset === 100 ? "Last card" : "First card",
            sourceFile: input.offset === 100 ? "notes/Last.md" : "notes/First.md",
            sourceNoteTitle: input.offset === 100 ? "Last" : "First",
          }),
        ],
      })),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      []
    );

    await view.render();

    expect(service.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 100,
        offset: 0,
      })
    );

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Next"
    ) as HTMLButtonElement | undefined;
    nextButton?.click();
    await flushDom();

    expect(service.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 100,
        offset: 100,
      })
    );
    expect(container.textContent).toContain("Last.md");
    expect(container.textContent).not.toContain("Last card");
  });

  it("moves selected cards from the inline bulk tray", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 1 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [
        { id: "default", name: "Default" },
        { id: "deck-2", name: "Exam Deck" },
      ],
      [],
      []
    );

    await view.render();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const moveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Move"
    ) as HTMLButtonElement | undefined;
    moveButton?.click();

    const deckSelect = container.querySelector(".srf-library__bulk-select") as HTMLSelectElement;
    deckSelect.value = "deck-2";
    deckSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply move"
    ) as HTMLButtonElement | undefined;
    applyButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.bulkUpdate).toHaveBeenCalledWith({
      action: "move",
      cardIds: ["card-1"],
      deckId: "deck-2",
    });
  });

  it("creates a deck from the library hero", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 0 }),
      createDeck: vi.fn().mockResolvedValue({ id: "deck-new", name: "Exam Deck" }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      []
    );

    await view.render();

    const newDeckButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "New Deck"
    ) as HTMLButtonElement | undefined;
    newDeckButton?.click();
    await flushDom();

    const input = container.querySelector(".srf-deck-editor__input") as HTMLInputElement;
    input.value = "Exam Deck";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create deck"
    ) as HTMLButtonElement | undefined;
    createButton?.click();
    await flushDom();

    expect(service.createDeck).toHaveBeenCalledWith({ name: "Exam Deck" });
  });

  it("creates a deck from the move tray and moves the selected card to it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const options = {
      decks: [{ id: "default", name: "Default" }],
      tags: [],
      sourceFiles: [],
    };
    const createdDeck = { id: "deck-created", name: "Exam Deck" };
    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 1 }),
      createDeck: vi.fn().mockImplementation(async () => {
        options.decks = [...options.decks, createdDeck];
        return createdDeck;
      }),
    };

    const view = new LibraryView(
      container,
      service as any,
      options.decks,
      options.tags,
      options.sourceFiles,
      undefined,
      undefined,
      () => options
    );

    await view.render();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const moveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Move"
    ) as HTMLButtonElement | undefined;
    moveButton?.click();

    const input = container.querySelector(".srf-deck-editor__input") as HTMLInputElement;
    input.value = "Exam Deck";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create & select"
    ) as HTMLButtonElement | undefined;
    createButton?.click();
    await flushDom();

    const deckSelect = container.querySelector(".srf-library__bulk-select") as HTMLSelectElement;
    expect(deckSelect.value).toBe("deck-created");

    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply move"
    ) as HTMLButtonElement | undefined;
    applyButton?.click();
    await flushDom();

    expect(service.createDeck).toHaveBeenCalledWith({ name: "Exam Deck" });
    expect(service.bulkUpdate).toHaveBeenCalledWith({
      action: "move",
      cardIds: ["card-1"],
      deckId: "deck-created",
    });
  });

  it("adds tags to selected cards from the inline bulk tray", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const service = {
      query: vi.fn().mockResolvedValue({
        total: 1,
        rows: [makeRow()],
      }),
      bulkUpdate: vi.fn().mockResolvedValue({ updatedCount: 1 }),
    };

    const view = new LibraryView(
      container,
      service as any,
      [{ id: "default", name: "Default" }],
      [],
      []
    );

    await view.render();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const tagButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add tags"
    ) as HTMLButtonElement | undefined;
    tagButton?.click();

    const tagInput = container.querySelector(".srf-library__bulk-input") as HTMLInputElement;
    tagInput.value = "biology, exam";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));

    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply tags"
    ) as HTMLButtonElement | undefined;
    applyButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.bulkUpdate).toHaveBeenCalledWith({
      action: "tag",
      cardIds: ["card-1"],
      tagIds: ["biology", "exam"],
      createMissingTags: true,
    });
  });
});
