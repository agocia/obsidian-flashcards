import { createDefaultPluginData, type PluginData } from "../domain/models";
import { migratePluginData } from "./migrations";

// ─── Adapter interface (injected by Obsidian plugin) ─────────────────────────

export interface PluginDataAdapter {
  loadData(): Promise<unknown>;
  saveData(data: PluginData): Promise<void>;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class PluginDataRepository {
  private _cache: PluginData | null = null;

  constructor(private readonly adapter: PluginDataAdapter) {}

  /** Load and migrate data; result is cached for the lifetime of this call. */
  async load(): Promise<PluginData> {
    const raw = await this.adapter.loadData();
    const data = migratePluginData(raw);
    this._cache = data;
    return data;
  }

  /** Returns a synchronous snapshot of the last loaded data or defaults. */
  snapshot(): PluginData {
    return this._cache ?? createDefaultPluginData();
  }

  /**
   * Apply a mutation and persist. Returns the updated data.
   * The mutator receives the current data and must return a new object.
   */
  async save(mutator: (current: PluginData) => PluginData): Promise<PluginData> {
    const current = this._cache ?? (await this.load());
    const next = mutator(current);
    this._cache = next;
    await this.adapter.saveData(next);
    return next;
  }

  /** Replace the entire data store (used for import). */
  async replace(data: PluginData): Promise<void> {
    this._cache = data;
    await this.adapter.saveData(data);
  }

  /** Invalidate the in-memory cache (force reload on next access). */
  invalidate(): void {
    this._cache = null;
  }
}
