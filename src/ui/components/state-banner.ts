/**
 * Empty / loading / error banner for all views.
 */

export type BannerKind = "empty" | "loading" | "error";

export interface StateBannerOptions {
  kind: BannerKind;
  headline: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function renderStateBanner(container: HTMLElement, opts: StateBannerOptions): HTMLElement {
  const banner = container.createDiv({ cls: `srf-state-banner srf-state-banner--${opts.kind}` });

  if (opts.kind === "loading") {
    const shimmer = banner.createDiv({ cls: "srf-shimmer" });
    shimmer.createDiv({ cls: "srf-shimmer-block" });
    return banner;
  }

  const iconWrap = banner.createDiv({ cls: "srf-state-banner__icon" });
  // Icon is set via CSS; 56px container
  iconWrap.textContent = opts.kind === "error" ? "⚠" : "✦";

  const headline = banner.createEl("h2", { cls: "srf-state-banner__headline" });
  headline.textContent = opts.headline;

  if (opts.body) {
    const body = banner.createEl("p", { cls: "srf-state-banner__body" });
    body.textContent = opts.body;
  }

  if (opts.ctaLabel && opts.onCta) {
    const cta = banner.createEl("button", {
      cls: "srf-btn srf-btn--primary",
      text: opts.ctaLabel,
    });
    cta.addEventListener("click", opts.onCta);
  }

  return banner;
}
