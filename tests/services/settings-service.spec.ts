import { describe, it, expect, beforeEach } from "vitest";
import { SettingsService, themeTokensForMode } from "../../src/services/settings-service";
import { PluginDataRepository } from "../../src/data/plugin-data-repository";

function makeRepo() {
  let stored: unknown = undefined;
  const adapter = {
    loadData: async () => (stored === undefined ? null : stored),
    saveData: async (data: unknown) => { stored = data; },
  };
  return new PluginDataRepository(adapter);
}

describe("SettingsService", () => {
  let repo: PluginDataRepository;
  let service: SettingsService;

  beforeEach(async () => {
    repo = makeRepo();
    await repo.load();
    service = new SettingsService(repo);
  });

  it("getSettings returns current settings", () => {
    const settings = service.getSettings();
    expect(settings).toBeDefined();
    expect(typeof settings.newCardsPerDay).toBe("number");
  });

  it("updateSettings persists a change", async () => {
    const updated = await service.updateSettings({ newCardsPerDay: 42 });
    expect(updated.newCardsPerDay).toBe(42);
    expect(service.getSettings().newCardsPerDay).toBe(42);
  });

  it("exportJson returns parseable JSON with cards array", async () => {
    const json = await service.exportJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.cards)).toBe(true);
  });

  it("importJson restores data and returns imported card count", async () => {
    const json = await service.exportJson();
    const result = await service.importJson(json);
    expect(typeof result.importedCards).toBe("number");
  });
});

describe("themeTokensForMode", () => {
  it("light mode returns accent-primary #6C5CE7", () => {
    const tokens = themeTokensForMode("light");
    expect(tokens["--srf-accent-primary"]).toBe("#6C5CE7");
  });

  it("dark mode returns accent-primary #8B7CFF", () => {
    const tokens = themeTokensForMode("dark");
    expect(tokens["--srf-accent-primary"]).toBe("#8B7CFF");
  });

  it("light mode danger is #C84C3A", () => {
    expect(themeTokensForMode("light")["--srf-danger"]).toBe("#C84C3A");
  });

  it("dark mode danger is #F06D5E", () => {
    expect(themeTokensForMode("dark")["--srf-danger"]).toBe("#F06D5E");
  });

  it("light mode success is #1F8A5B", () => {
    expect(themeTokensForMode("light")["--srf-success"]).toBe("#1F8A5B");
  });

  it("dark mode success is #4CC38A", () => {
    expect(themeTokensForMode("dark")["--srf-success"]).toBe("#4CC38A");
  });

  it("returns a new object each call (no shared ref)", () => {
    const a = themeTokensForMode("light");
    const b = themeTokensForMode("light");
    expect(a).not.toBe(b);
  });
});
