import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "../../../src/ui/views/dashboard-view";

function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    empty?: () => void;
    addClass?: (...classes: string[]) => void;
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
          if (attrValue != null) el.setAttribute(attrKey, String(attrValue));
        }
        continue;
      }
      (el as Record<string, unknown>)[key] = value;
    }
  }
  parent.appendChild(el);
  return el;
}

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("DashboardView", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    document.body.innerHTML = "";
  });

  it("starts review for the selected deck", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onStartReview = vi.fn();
    const service = {
      getStats: vi.fn().mockResolvedValue({
        dueToday: 3,
        newCards: 4,
        retention30d: 80,
        streakDays: 2,
        nextReviewBlockAt: null,
        continueDeckId: null,
        continueDeckName: null,
        recentlyAddedCardIds: [],
        needsAttentionCardIds: [],
        decks: [
          { id: "deck-a", name: "Deck A", dueToday: 1, newCards: 0, totalCards: 5 },
          { id: "deck-b", name: "Deck B", dueToday: 2, newCards: 1, totalCards: 8 },
        ],
      }),
    };

    const view = new DashboardView(container, service as any, onStartReview);
    await view.render();

    const select = container.querySelector(".srf-dashboard__deck-picker select") as HTMLSelectElement;
    select.value = "deck-b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushDom();

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start Review"
    ) as HTMLButtonElement | undefined;
    startButton?.click();

    expect(onStartReview).toHaveBeenCalledWith(["deck-b"]);
  });
});
