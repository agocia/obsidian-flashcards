/**
 * Metric tile for the dashboard.
 * Shows a large numeric value + label, with optional delta chip.
 */

export interface MetricTileOptions {
  label: string;
  value: number | string;
  delta?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export function renderMetricTile(container: HTMLElement, opts: MetricTileOptions): HTMLElement {
  const tile = container.createDiv({ cls: "srf-metric-tile" });
  if (opts.tone) tile.addClass(`srf-metric-tile--${opts.tone}`);

  if (opts.delta !== undefined) {
    const chip = tile.createDiv({ cls: "srf-metric-delta" });
    chip.textContent = opts.delta;
  }

  const valueEl = tile.createDiv({ cls: "srf-metric-value" });
  valueEl.textContent = String(opts.value);

  const labelEl = tile.createDiv({ cls: "srf-metric-label" });
  labelEl.textContent = opts.label;

  return tile;
}
