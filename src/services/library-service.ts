import type { PluginDataRepository } from "../data/plugin-data-repository";
import type {
  DeckRecord,
  ReviewCardState,
  TagRecord,
} from "../domain/models";
import { nowIso, createDeck, createTag } from "../domain/models";

// ─── I/O types ────────────────────────────────────────────────────────────────

export interface LibraryQueryInput {
  search: string;
  deckIds: string[];
  tagIds: string[];
  sourceFile: string | null;
  states: ReviewCardState[];
  sortBy: "due" | "updated" | "deck" | "ease";
  sortDirection: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface LibraryRow {
  cardId: string;
  promptText: string;
  deckName: string;
  tags: string[];
  sourceNoteTitle: string;
  sourceFile: string;
  dueAt: string | null;
  difficulty: number | null;
  state: ReviewCardState;
  updatedAt: string;
}

export interface LibraryQueryResult {
  total: number;
  rows: LibraryRow[];
}

export interface CreateDeckInput {
  name: string;
}

export type BulkUpdateCardsInput =
  | { action: "move"; cardIds: string[]; deckId: string }
  | { action: "tag"; cardIds: string[]; tagIds: string[]; createMissingTags?: boolean }
  | { action: "suspend"; cardIds: string[]; suspended: boolean }
  | { action: "delete"; cardIds: string[] };

// ─── Service ──────────────────────────────────────────────────────────────────

export class LibraryService {
  constructor(private readonly repository: PluginDataRepository) {}

  async createDeck(input: CreateDeckInput): Promise<DeckRecord> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("DeckNameRequiredError: deck name is required");
    }

    let created: DeckRecord | null = null;
    await this.repository.save((data) => {
      const duplicate = data.decks.find(
        (deck) => deck.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        throw new Error("DeckAlreadyExistsError: deck name already exists");
      }

      created = createDeck({ name });
      return {
        ...data,
        decks: [...data.decks, created],
      };
    });

    if (!created) {
      throw new Error("DeckCreateError: could not create deck");
    }
    return created;
  }

  async query(input: LibraryQueryInput): Promise<LibraryQueryResult> {
    const data = await this.repository.load();

    const deckMap = new Map(data.decks.map((d) => [d.id, d.name]));
    const tagMap = new Map(data.tags.map((t) => [t.id, t.label]));
    const templateMap = new Map(data.templates.map((t) => [t.id, t]));

    const deckFilter = new Set(input.deckIds);
    const tagFilter = new Set(input.tagIds);
    const stateFilter = new Set(input.states);
    const searchLower = input.search.toLowerCase();
    const sourceFileLower = input.sourceFile?.trim().toLowerCase() ?? "";

    let rows: LibraryRow[] = [];

    for (const card of data.cards) {
      const template = templateMap.get(card.templateId);

      // If template missing, use defaults so card still appears
      const effectiveDeckId = template?.deckId ?? "";
      const effectiveTagIds = template?.tagIds ?? [];
      const effectiveSourceFile = template?.sourceAnchor.filePath ?? "";
      const effectiveSourceNoteTitle = template?.sourceAnchor.noteTitle ?? "";
      const effectiveState = card.suspended ? "suspended" : card.state;

      // Deck filter
      if (deckFilter.size > 0 && !deckFilter.has(effectiveDeckId)) continue;

      // Tag filter
      if (tagFilter.size > 0 && !effectiveTagIds.some((id) => tagFilter.has(id))) continue;

      // Source file filter
      if (sourceFileLower && !effectiveSourceFile.toLowerCase().includes(sourceFileLower)) {
        continue;
      }

      // State filter
      if (stateFilter.size > 0 && !stateFilter.has(effectiveState)) continue;

      // Search filter
      if (
        searchLower &&
        !card.promptText.toLowerCase().includes(searchLower) &&
        !card.answerText.toLowerCase().includes(searchLower) &&
        !effectiveSourceFile.toLowerCase().includes(searchLower) &&
        !effectiveSourceNoteTitle.toLowerCase().includes(searchLower) &&
        !(deckMap.get(effectiveDeckId) ?? effectiveDeckId).toLowerCase().includes(searchLower) &&
        !effectiveTagIds.some((id) => (tagMap.get(id) ?? id).toLowerCase().includes(searchLower))
      )
        continue;

      rows.push({
        cardId: card.id,
        promptText: card.promptText,
        deckName: deckMap.get(effectiveDeckId) ?? effectiveDeckId,
        tags: effectiveTagIds.map((id) => tagMap.get(id) ?? id),
        sourceNoteTitle: effectiveSourceNoteTitle,
        sourceFile: effectiveSourceFile,
        dueAt: card.dueAt,
        difficulty: card.difficulty,
        state: effectiveState,
        updatedAt: card.updatedAt,
      });
    }

    rows = sortLibraryRows(rows, input.sortBy, input.sortDirection);

    const total = rows.length;
    const offset = Math.max(0, input.offset ?? 0);
    const limit = input.limit && input.limit > 0 ? input.limit : null;
    if (limit !== null) {
      rows = rows.slice(offset, offset + limit);
    } else if (offset > 0) {
      rows = rows.slice(offset);
    }

    return { total, rows };
  }

  async bulkUpdate(input: BulkUpdateCardsInput): Promise<{ updatedCount: number }> {
    const idSet = new Set(
      input.action !== "delete" ? input.cardIds : input.cardIds
    );
    const now = nowIso();
    let updatedCount = 0;

    await this.repository.save((data) => {
      if (input.action === "delete") {
        const before = data.cards.length;
        const cards = data.cards.filter((c) => !idSet.has(c.id));
        updatedCount = before - cards.length;
        // Also clean up template references
        const templates = data.templates.map((t) => ({
          ...t,
          generatedCardIds: t.generatedCardIds.filter((id) => !idSet.has(id)),
        }));
        return { ...data, cards, templates };
      }

      const cards = data.cards.map((card) => {
        if (!idSet.has(card.id)) return card;
        updatedCount++;

        if (input.action === "suspend") {
          const fallbackState: ReviewCardState = card.dueAt ? "review" : "new";
          const nextState: ReviewCardState = input.suspended
            ? "suspended"
            : card.stateBeforeSuspension ?? fallbackState;
          return {
            ...card,
            suspended: input.suspended,
            state: nextState,
            stateBeforeSuspension: input.suspended
              ? (card.state === "suspended" ? card.stateBeforeSuspension : card.state)
              : null,
            updatedAt: now,
          };
        }

        return card;
      });

      if (input.action === "move") {
        const targetDeck = data.decks.find((deck) => deck.id === input.deckId && !deck.archived);
        if (!targetDeck) {
          throw new Error("DeckNotFoundError: target deck does not exist");
        }

        const templates = data.templates.map((t) => {
          const hasMatchingCard = t.generatedCardIds.some((id) => idSet.has(id));
          if (!hasMatchingCard) return t;
          return { ...t, deckId: input.deckId, updatedAt: now };
        });
        return { ...data, cards, templates };
      }

      if (input.action === "tag") {
        const nextTags = ensureTags(
          data.tags,
          input.tagIds,
          input.createMissingTags ?? false
        );
        const templates = data.templates.map((t) => {
          const hasMatchingCard = t.generatedCardIds.some((id) => idSet.has(id));
          if (!hasMatchingCard) return t;
          const requestedIds = input.tagIds.map((tagValue) => {
            const match = nextTags.find(
              (tag) =>
                tag.id === tagValue ||
                tag.label.toLowerCase() === tagValue.trim().toLowerCase()
            );
            return match?.id ?? tagValue;
          });
          const merged = [...new Set([...t.tagIds, ...requestedIds])];
          return { ...t, tagIds: merged, updatedAt: now };
        });
        return { ...data, cards, templates, tags: nextTags };
      }

      return { ...data, cards };
    });

    return { updatedCount };
  }
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

function sortLibraryRows(
  rows: LibraryRow[],
  sortBy: LibraryQueryInput["sortBy"],
  direction: LibraryQueryInput["sortDirection"]
): LibraryRow[] {
  const dir = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "due":
        return compareNullable(a.dueAt, b.dueAt) * dir;
      case "updated":
        return compareNullable(a.updatedAt, b.updatedAt) * dir;
      case "deck":
        return a.deckName.localeCompare(b.deckName) * dir;
      case "ease":
        return compareNullable(a.difficulty, b.difficulty) * dir;
      default:
        return 0;
    }
  });
}

function compareNullable<T extends string | number>(
  a: T | null,
  b: T | null
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function ensureTags(
  existingTags: TagRecord[],
  requestedTagValues: string[],
  createMissingTags: boolean
): TagRecord[] {
  const tags = [...existingTags];

  for (const rawValue of requestedTagValues) {
    const normalized = rawValue.trim();
    if (!normalized) continue;

    const existingMatch = tags.find(
      (tag) => tag.id === normalized || tag.label.toLowerCase() === normalized.toLowerCase()
    );
    if (existingMatch) continue;

    if (createMissingTags) {
      tags.push(createTag(normalized));
    }
  }

  return tags;
}
