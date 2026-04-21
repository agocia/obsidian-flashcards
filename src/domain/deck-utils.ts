import { DEFAULT_DECK_ID, type DeckRecord } from "./models";

export interface DeckOption {
  id: string;
  name: string;
  label: string;
  fullPath: string;
  depth: number;
  parentDeckId: string | null;
  archived: boolean;
}

export function normalizeDeckName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Deck name is required.");
  }

  if (normalized.includes("::")) {
    throw new Error("Use the parent deck selector instead of :: in the deck name.");
  }

  return normalized;
}

export function getDeckMap(decks: DeckRecord[]): Map<string, DeckRecord> {
  return new Map(decks.map((deck) => [deck.id, deck]));
}

export function isActiveDeckId(decks: DeckRecord[], deckId: string | null | undefined): boolean {
  if (!deckId) return false;
  return decks.some((deck) => deck.id === deckId && !deck.archived);
}

export function sanitizeDeckSelection(
  decks: DeckRecord[],
  deckIds: string[] | null | undefined
): string[] {
  const activeIds = new Set(
    decks.filter((deck) => !deck.archived).map((deck) => deck.id)
  );
  const seen = new Set<string>();

  return (deckIds ?? []).filter((deckId) => {
    if (!activeIds.has(deckId) || seen.has(deckId)) return false;
    seen.add(deckId);
    return true;
  });
}

export function resolveDefaultDeckId(
  decks: DeckRecord[],
  requestedDeckId: string | null | undefined
): string {
  if (isActiveDeckId(decks, requestedDeckId)) {
    return requestedDeckId!;
  }

  if (isActiveDeckId(decks, DEFAULT_DECK_ID)) {
    return DEFAULT_DECK_ID;
  }

  return decks.find((deck) => !deck.archived)?.id ?? DEFAULT_DECK_ID;
}

export function getDeckFullPath(
  decks: DeckRecord[],
  deckId: string | null | undefined
): string | null {
  if (!deckId) return null;

  const deckMap = getDeckMap(decks);
  const start = deckMap.get(deckId);
  if (!start) return null;

  const seen = new Set<string>();
  const parts: string[] = [];
  let current: DeckRecord | undefined = start;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.push(current.name);
    current = current.parentDeckId ? deckMap.get(current.parentDeckId) : undefined;
  }

  return parts.reverse().join(" :: ");
}

export function getDeckLabel(
  decks: DeckRecord[],
  deckId: string | null | undefined,
  options?: { includeArchivedSuffix?: boolean }
): string {
  const fullPath = getDeckFullPath(decks, deckId);
  const deck = deckId ? getDeckMap(decks).get(deckId) : undefined;

  if (!fullPath) {
    return deckId ?? "No deck";
  }

  if (deck?.archived && options?.includeArchivedSuffix) {
    return `${fullPath} (Archived)`;
  }

  return fullPath;
}

export function getDeckPathMap(
  decks: DeckRecord[],
  options?: { includeArchivedSuffix?: boolean }
): Map<string, string> {
  return new Map(
    decks.map((deck) => [
      deck.id,
      getDeckLabel(decks, deck.id, {
        includeArchivedSuffix: options?.includeArchivedSuffix,
      }),
    ])
  );
}

export function getDeckAncestorIds(decks: DeckRecord[], deckId: string): string[] {
  const deckMap = getDeckMap(decks);
  const ancestors: string[] = [];
  const seen = new Set<string>([deckId]);
  let current = deckMap.get(deckId);

  while (current?.parentDeckId) {
    const parent = deckMap.get(current.parentDeckId);
    if (!parent || seen.has(parent.id)) break;
    ancestors.push(parent.id);
    seen.add(parent.id);
    current = parent;
  }

  return ancestors;
}

export function getDeckDescendantIds(decks: DeckRecord[], deckId: string): string[] {
  const childMap = new Map<string | null, DeckRecord[]>();

  decks.forEach((deck) => {
    const key = deck.parentDeckId ?? null;
    const existing = childMap.get(key) ?? [];
    existing.push(deck);
    childMap.set(key, existing);
  });

  const descendants: string[] = [];
  const queue = [...(childMap.get(deckId) ?? [])];
  const seen = new Set<string>([deckId]);

  while (queue.length > 0) {
    const deck = queue.shift();
    if (!deck || seen.has(deck.id)) continue;
    seen.add(deck.id);
    descendants.push(deck.id);
    queue.push(...(childMap.get(deck.id) ?? []));
  }

  return descendants;
}

export function getDeckSubtreeIds(decks: DeckRecord[], deckId: string): string[] {
  return [deckId, ...getDeckDescendantIds(decks, deckId)];
}

export function isDeckDescendantOf(
  decks: DeckRecord[],
  deckId: string,
  ancestorDeckId: string
): boolean {
  return getDeckAncestorIds(decks, deckId).includes(ancestorDeckId);
}

export function listDeckOptions(
  decks: DeckRecord[],
  options?: { includeArchived?: boolean; includeArchivedSuffix?: boolean }
): DeckOption[] {
  const includeArchived = options?.includeArchived ?? false;

  return decks
    .filter((deck) => includeArchived || !deck.archived)
    .map((deck) => {
      const fullPath = getDeckFullPath(decks, deck.id) ?? deck.name;
      const depth = getDeckAncestorIds(decks, deck.id).length;
      return {
        id: deck.id,
        name: deck.name,
        label:
          deck.archived && options?.includeArchivedSuffix
            ? `${fullPath} (Archived)`
            : fullPath,
        fullPath,
        depth,
        parentDeckId: deck.parentDeckId,
        archived: deck.archived,
      };
    })
    .sort((a, b) =>
      a.fullPath.localeCompare(b.fullPath, undefined, { sensitivity: "base" })
    );
}
