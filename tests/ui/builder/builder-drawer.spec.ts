import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionContext } from "../../../src/data/source-anchor-resolver";
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
});
