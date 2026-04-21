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
    promptText: "What is spaced repetition?",
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
