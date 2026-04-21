// ─── Core identifiers ────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2 as const;

let _idCounter = 0;
export function createId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${(++_idCounter).toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface PluginSettings {
  themeMode: "system" | "light" | "dark";
  defaultDeckId: string;
  defaultCardMode: "basic" | "cloze";
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  burySiblings: boolean;
  previewDebounceMs: number;
  revealHotkey: "Space";
  ratingHotkeys: { again: "1"; hard: "2"; good: "3"; easy: "4" };
  nextReviewBlockHour: number;
  showShortcutHints: boolean;
  exportFormat: "json" | "csv";
  autoSyncOnVaultChange: boolean;
}

export function createDefaultSettings(): PluginSettings {
  return {
    themeMode: "system",
    defaultDeckId: "default",
    defaultCardMode: "basic",
    newCardsPerDay: 20,
    maxReviewsPerDay: 200,
    burySiblings: true,
    previewDebounceMs: 300,
    revealHotkey: "Space",
    ratingHotkeys: { again: "1", hard: "2", good: "3", easy: "4" },
    nextReviewBlockHour: 20,
    showShortcutHints: true,
    exportFormat: "json",
    autoSyncOnVaultChange: true,
  };
}

// ─── Deck ─────────────────────────────────────────────────────────────────────

export interface DeckRecord {
  id: string;
  name: string;
  parentDeckId: string | null;
  newLimitPerDay: number | null;
  reviewLimitPerDay: number | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export function createDefaultDeck(): DeckRecord {
  const now = nowIso();
  return {
    id: "default",
    name: "Default",
    parentDeckId: null,
    newLimitPerDay: null,
    reviewLimitPerDay: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

export function createDeck(partial: Partial<DeckRecord> & { name: string }): DeckRecord {
  const now = nowIso();
  return {
    id: partial.id ?? createId("deck"),
    name: partial.name,
    parentDeckId: partial.parentDeckId ?? null,
    newLimitPerDay: partial.newLimitPerDay ?? null,
    reviewLimitPerDay: partial.reviewLimitPerDay ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    archived: partial.archived ?? false,
  };
}

// ─── Tag ──────────────────────────────────────────────────────────────────────

export interface TagRecord {
  id: string;
  label: string;
  createdAt: string;
}

export function createTag(label: string): TagRecord {
  return { id: createId("tag"), label, createdAt: nowIso() };
}

// ─── Source Anchor ────────────────────────────────────────────────────────────

export interface SourceAnchor {
  filePath: string;
  noteTitle: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  leadingContext: string;
  trailingContext: string;
  excerpt: string;
  contentHash: string;
  lastResolvedAt: string;
}

// ─── Card Template ────────────────────────────────────────────────────────────

export type CardKind = "basic" | "reverse" | "cloze" | "custom";

export interface CardTemplateRecord {
  id: string;
  kind: CardKind;
  deckId: string;
  tagIds: string[];
  sourceAnchor: SourceAnchor;
  frontMarkdown: string;
  backMarkdown: string;
  clozeMarkdown: string | null;
  hintByClozeIndex: Record<number, string>;
  customTemplateId: string | null;
  generatedCardIds: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

// ─── Review Card ──────────────────────────────────────────────────────────────

export type ReviewCardState = "new" | "learning" | "review" | "relearning" | "suspended";

export interface ReviewCardRecord {
  id: string;
  templateId: string;
  variantKey: string;
  promptMarkdown: string;
  answerMarkdown: string;
  promptText: string;
  answerText: string;
  state: ReviewCardState;
  dueAt: string | null;
  lastReviewedAt: string | null;
  stability: number | null;
  difficulty: number | null;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  reviewCount: number;
  correctCount: number;
  suspended: boolean;
  stateBeforeSuspension: ReviewCardState | null;
  buriedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createReviewCard(
  templateId: string,
  variantKey: string,
  promptMarkdown: string,
  answerMarkdown: string
): ReviewCardRecord {
  const now = nowIso();
  return {
    id: createId("card"),
    templateId,
    variantKey,
    promptMarkdown,
    answerMarkdown,
    promptText: stripMarkdown(promptMarkdown),
    answerText: stripMarkdown(answerMarkdown),
    state: "new",
    dueAt: null,
    lastReviewedAt: null,
    stability: null,
    difficulty: null,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    reviewCount: 0,
    correctCount: 0,
    suspended: false,
    stateBeforeSuspension: null,
    buriedUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

// ─── Review Log ───────────────────────────────────────────────────────────────

export type ReviewRating = 1 | 2 | 3 | 4;

export interface ReviewLogRecord {
  id: string;
  sessionId: string;
  cardId: string;
  rating: ReviewRating;
  reviewedAt: string;
  previousState: ReviewCardState;
  nextState: ReviewCardState;
  previousDueAt: string | null;
  nextDueAt: string | null;
}

export function createReviewLog(
  partial: Omit<ReviewLogRecord, "id">
): ReviewLogRecord {
  return { id: createId("log"), ...partial };
}

// ─── Review Session Draft ─────────────────────────────────────────────────────

export interface ReviewSessionDraft {
  id: string;
  deckIds: string[];
  queuedCardIds: string[];
  completedCardIds: string[];
  currentCardId: string | null;
  revealed: boolean;
  startedAt: string;
  updatedAt: string;
}

export function createSessionDraft(
  queuedCardIds: string[],
  deckIds: string[] = []
): ReviewSessionDraft {
  const now = nowIso();
  return {
    id: createId("session"),
    deckIds,
    queuedCardIds,
    completedCardIds: [],
    currentCardId: queuedCardIds[0] ?? null,
    revealed: false,
    startedAt: now,
    updatedAt: now,
  };
}

// ─── Plugin Data (top-level store) ───────────────────────────────────────────

export interface PluginData {
  version: number;
  settings: PluginSettings;
  decks: DeckRecord[];
  tags: TagRecord[];
  templates: CardTemplateRecord[];
  cards: ReviewCardRecord[];
  logs: ReviewLogRecord[];
  sessionDraft: ReviewSessionDraft | null;
}

export function createDefaultPluginData(): PluginData {
  return {
    version: SCHEMA_VERSION,
    settings: createDefaultSettings(),
    decks: [createDefaultDeck()],
    tags: [],
    templates: [],
    cards: [],
    logs: [],
    sessionDraft: null,
  };
}
