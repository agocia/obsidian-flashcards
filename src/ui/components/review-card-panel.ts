/**
 * Review card face — renders prompt or answer content.
 */

export interface ReviewCardPanelOptions {
  promptMarkdown: string;
  answerMarkdown?: string;
  revealed: boolean;
  variantKey?: string;
  /** Called by the Obsidian MarkdownRenderer adapter. Falls back to plain text. */
  renderMarkdown?: (source: string, container: HTMLElement) => void;
}

export function renderReviewCardPanel(
  container: HTMLElement,
  opts: ReviewCardPanelOptions
): HTMLElement {
  container.empty();

  const card = container.createDiv({ cls: "srf-review-card" });

  const face = card.createDiv({ cls: "srf-review-card__face" });

  if (opts.variantKey === "reverse") {
    face.addClass("srf-review-card__face--reverse");
  }

  const promptEl = face.createDiv({ cls: "srf-review-card__prompt" });
  if (opts.renderMarkdown) {
    opts.renderMarkdown(opts.promptMarkdown, promptEl);
  } else {
    promptEl.textContent = opts.promptMarkdown;
  }

  if (opts.revealed && opts.answerMarkdown !== undefined) {
    const divider = face.createDiv({ cls: "srf-review-card__divider" });
    divider.setAttribute("aria-hidden", "true");

    const answerEl = face.createDiv({ cls: "srf-review-card__answer srf-answer-reveal" });
    if (opts.renderMarkdown) {
      opts.renderMarkdown(opts.answerMarkdown, answerEl);
    } else {
      answerEl.textContent = opts.answerMarkdown;
    }
  } else if (!opts.revealed) {
    const hint = face.createDiv({ cls: "srf-review-card__hint" });
    hint.textContent = "Press Space to reveal";
  }

  return card;
}
