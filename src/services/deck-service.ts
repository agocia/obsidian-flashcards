import type { PluginDataRepository } from "../data/plugin-data-repository";
import {
  createDeck,
  DEFAULT_DECK_ID,
  nowIso,
  type DeckRecord,
  type PluginData,
} from "../domain/models";
import {
  getDeckAncestorIds,
  getDeckDescendantIds,
  getDeckSubtreeIds,
  isActiveDeckId,
  isDeckDescendantOf,
  listDeckOptions,
  normalizeDeckName,
  resolveDefaultDeckId,
  sanitizeDeckSelection,
} from "../domain/deck-utils";

export interface DeckMutationInput {
  deckId: string;
  name: string;
  parentDeckId: string | null;
}

export interface CreateDeckInput {
  name: string;
  parentDeckId?: string | null;
}

export interface DeckRecordView extends DeckRecord {
  fullPath: string;
  depth: number;
}

export class DeckService {
  constructor(private readonly repository: PluginDataRepository) {}

  getDefaultDeckId(): string {
    const data = this.repository.snapshot();
    return resolveDefaultDeckId(data.decks, data.settings.defaultDeckId);
  }

  getDeckOptions(includeArchived = false): Array<{
    id: string;
    label: string;
    fullPath: string;
    depth: number;
    archived: boolean;
    parentDeckId: string | null;
  }> {
    return listDeckOptions(this.repository.snapshot().decks, {
      includeArchived,
      includeArchivedSuffix: includeArchived,
    });
  }

  getDeckRecords(includeArchived = true): DeckRecordView[] {
    const data = this.repository.snapshot();
    const options = listDeckOptions(data.decks, {
      includeArchived,
      includeArchivedSuffix: false,
    });

    return options
      .map((option) => {
        const deck = data.decks.find((candidate) => candidate.id === option.id);
        if (!deck) return null;
        return {
          ...deck,
          fullPath: option.fullPath,
          depth: option.depth,
        };
      })
      .filter((deck): deck is DeckRecordView => deck !== null);
  }

  async normalizePersistedReferences(): Promise<void> {
    const current = this.repository.snapshot();
    const normalized = sanitizePluginDeckState(current);
    if (normalized !== current) {
      await this.repository.replace(normalized);
    }
  }

  async createDeck(input: CreateDeckInput): Promise<DeckRecord> {
    let createdDeck: DeckRecord | null = null;

    await this.repository.save((data) => {
      const name = normalizeDeckName(input.name);
      const parentDeckId = normalizeParentDeckId(data.decks, input.parentDeckId ?? null);
      ensureSiblingNameIsUnique(data.decks, name, parentDeckId);

      createdDeck = createDeck({ name, parentDeckId });

      return sanitizePluginDeckState({
        ...data,
        decks: [...data.decks, createdDeck],
      });
    });

    return createdDeck!;
  }

  async updateDeck(input: DeckMutationInput): Promise<DeckRecord> {
    let updatedDeck: DeckRecord | null = null;

    await this.repository.save((data) => {
      const currentDeck = data.decks.find((deck) => deck.id === input.deckId);
      if (!currentDeck) {
        throw new Error("That deck no longer exists.");
      }

      const nextName = normalizeDeckName(input.name);
      const nextParentDeckId = normalizeParentDeckId(data.decks, input.parentDeckId);

      if (currentDeck.id === DEFAULT_DECK_ID && nextParentDeckId !== null) {
        throw new Error("The default deck must stay at the top level.");
      }

      if (nextParentDeckId === currentDeck.id) {
        throw new Error("A deck cannot be its own parent.");
      }

      if (
        nextParentDeckId &&
        isDeckDescendantOf(data.decks, nextParentDeckId, currentDeck.id)
      ) {
        throw new Error("A deck cannot be moved into one of its own subdecks.");
      }

      ensureSiblingNameIsUnique(data.decks, nextName, nextParentDeckId, currentDeck.id);

      const updatedAt = nowIso();
      const decks = data.decks.map((deck) => {
        if (deck.id !== currentDeck.id) return deck;
        updatedDeck = {
          ...deck,
          name: nextName,
          parentDeckId: nextParentDeckId,
          updatedAt,
        };
        return updatedDeck;
      });

      return sanitizePluginDeckState({ ...data, decks });
    });

    return updatedDeck!;
  }

  async setDefaultDeck(deckId: string): Promise<void> {
    await this.repository.save((data) => {
      if (!isActiveDeckId(data.decks, deckId)) {
        throw new Error("Choose an active deck for the default deck.");
      }

      return {
        ...data,
        settings: {
          ...data.settings,
          defaultDeckId: deckId,
        },
      };
    });
  }

  async setArchived(deckId: string, archived: boolean): Promise<void> {
    await this.repository.save((data) => {
      const deck = data.decks.find((candidate) => candidate.id === deckId);
      if (!deck) {
        throw new Error("That deck no longer exists.");
      }

      if (deck.id === DEFAULT_DECK_ID && archived) {
        throw new Error("The default deck cannot be archived.");
      }

      const affectedIds = archived
        ? getDeckSubtreeIds(data.decks, deckId)
        : [
            ...new Set([
              ...getDeckAncestorIds(data.decks, deckId),
              ...getDeckSubtreeIds(data.decks, deckId),
            ]),
          ];

      const affectedSet = new Set(affectedIds);
      const updatedAt = nowIso();

      const decks = data.decks.map((candidate) => (
        affectedSet.has(candidate.id)
          ? { ...candidate, archived, updatedAt }
          : candidate
      ));

      return sanitizePluginDeckState({ ...data, decks });
    });
  }

  async deleteDeck(deckId: string, fallbackDeckId?: string): Promise<void> {
    await this.repository.save((data) => {
      const deck = data.decks.find((candidate) => candidate.id === deckId);
      if (!deck) {
        throw new Error("That deck no longer exists.");
      }

      if (deck.id === DEFAULT_DECK_ID) {
        throw new Error("The default deck cannot be deleted.");
      }

      const removedIds = new Set(getDeckSubtreeIds(data.decks, deckId));
      const fallbackId = resolveFallbackDeckId(data.decks, removedIds, fallbackDeckId);
      const updatedAt = nowIso();

      const decks = data.decks.filter((candidate) => !removedIds.has(candidate.id));
      const templates = data.templates.map((template) => (
        removedIds.has(template.deckId)
          ? { ...template, deckId: fallbackId, updatedAt }
          : template
      ));

      return sanitizePluginDeckState({
        ...data,
        decks,
        templates,
      });
    });
  }
}

function normalizeParentDeckId(
  decks: DeckRecord[],
  parentDeckId: string | null
): string | null {
  if (!parentDeckId) return null;

  const parent = decks.find((deck) => deck.id === parentDeckId);
  if (!parent) {
    throw new Error("Choose a valid parent deck.");
  }

  return parent.id;
}

function ensureSiblingNameIsUnique(
  decks: DeckRecord[],
  name: string,
  parentDeckId: string | null,
  excludeDeckId?: string
): void {
  const duplicate = decks.find((deck) => (
    deck.id !== excludeDeckId &&
    (deck.parentDeckId ?? null) === (parentDeckId ?? null) &&
    deck.name.trim().toLowerCase() === name.toLowerCase()
  ));

  if (duplicate) {
    throw new Error("A deck with that name already exists at this level.");
  }
}

function resolveFallbackDeckId(
  decks: DeckRecord[],
  removedIds: Set<string>,
  requestedFallbackId?: string
): string {
  const remainingDecks = decks.filter((deck) => !removedIds.has(deck.id));

  if (
    requestedFallbackId &&
    remainingDecks.some((deck) => deck.id === requestedFallbackId && !deck.archived)
  ) {
    return requestedFallbackId;
  }

  if (
    remainingDecks.some((deck) => deck.id === DEFAULT_DECK_ID && !deck.archived)
  ) {
    return DEFAULT_DECK_ID;
  }

  const firstActiveDeck = remainingDecks.find((deck) => !deck.archived);
  if (!firstActiveDeck) {
    throw new Error("Cannot delete the last active deck.");
  }

  return firstActiveDeck.id;
}

function sanitizePluginDeckState(data: PluginData): PluginData {
  const nextDefaultDeckId = resolveDefaultDeckId(
    data.decks,
    data.settings.defaultDeckId
  );
  const nextSessionDeckIds = sanitizeDeckSelection(
    data.decks,
    data.sessionDraft?.deckIds
  );

  let next = data;

  if (nextDefaultDeckId !== data.settings.defaultDeckId) {
    next = {
      ...next,
      settings: {
        ...next.settings,
        defaultDeckId: nextDefaultDeckId,
      },
    };
  }

  if (
    data.sessionDraft &&
    !sameStringArray(nextSessionDeckIds, data.sessionDraft.deckIds)
  ) {
    next = {
      ...next,
      sessionDraft: {
        ...data.sessionDraft,
        deckIds: nextSessionDeckIds,
        updatedAt: nowIso(),
      },
    };
  }

  return next;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
