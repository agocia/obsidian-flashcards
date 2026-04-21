/**
 * Again / Hard / Good / Easy rating button row.
 * Hidden before answer reveal; appears with staggered animation.
 */

export type RatingLabel = "Again" | "Hard" | "Good" | "Easy";
export type RatingValue = 1 | 2 | 3 | 4;

export interface RatingButtonRowOptions {
  schedulePreview?: Record<RatingValue, { intervalDays: number }>;
  showShortcutHints?: boolean;
  onRate: (rating: RatingValue) => void;
}

const RATINGS: Array<{ value: RatingValue; label: RatingLabel; shortcut: string; cls: string }> = [
  { value: 1, label: "Again", shortcut: "1", cls: "srf-btn--again" },
  { value: 2, label: "Hard", shortcut: "2", cls: "srf-btn--hard" },
  { value: 3, label: "Good", shortcut: "3", cls: "srf-btn--good" },
  { value: 4, label: "Easy", shortcut: "4", cls: "srf-btn--easy" },
];

export function renderRatingButtonRow(
  container: HTMLElement,
  opts: RatingButtonRowOptions
): HTMLElement {
  const row = container.createDiv({ cls: "srf-rating-row" });

  RATINGS.forEach((r, i) => {
    const btn = row.createEl("button", {
      cls: `srf-btn srf-btn--rating ${r.cls}`,
    });
    btn.setAttribute("data-rating", String(r.value));
    btn.style.animationDelay = `${i * 24}ms`;

    const labelSpan = btn.createSpan({ cls: "srf-btn__label", text: r.label });

    if (opts.schedulePreview) {
      const preview = opts.schedulePreview[r.value];
      const hint = formatInterval(preview.intervalDays);
      btn.createSpan({ cls: "srf-btn__interval", text: hint });
    }

    if (opts.showShortcutHints) {
      btn.createSpan({ cls: "srf-btn__shortcut", text: r.shortcut });
    }

    btn.addEventListener("click", () => opts.onRate(r.value));
  });

  return row;
}

function formatInterval(days: number): string {
  if (days === 0) return "< 1d";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}yr`;
}
