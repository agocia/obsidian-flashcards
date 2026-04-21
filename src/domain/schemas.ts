import { z } from "zod";
import {
  createDefaultPluginData,
  SCHEMA_VERSION,
  type PluginData,
  type PluginSettings,
  type DeckRecord,
  type TagRecord,
  type SourceAnchor,
  type CardTemplateRecord,
  type ReviewCardRecord,
  type ReviewLogRecord,
  type ReviewSessionDraft,
} from "./models";

// ─── Primitive schemas ────────────────────────────────────────────────────────

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

// ─── Settings ────────────────────────────────────────────────────────────────

export const PluginSettingsSchema: z.ZodType<PluginSettings> = z.object({
  themeMode: z.enum(["system", "light", "dark"]),
  defaultDeckId: z.string(),
  defaultCardMode: z.enum(["basic", "cloze"]),
  newCardsPerDay: z.number().int().nonnegative(),
  maxReviewsPerDay: z.number().int().nonnegative(),
  burySiblings: z.boolean(),
  previewDebounceMs: z.number().int().nonnegative(),
  revealHotkey: z.literal("Space"),
  ratingHotkeys: z.object({
    again: z.literal("1"),
    hard: z.literal("2"),
    good: z.literal("3"),
    easy: z.literal("4"),
  }),
  nextReviewBlockHour: z.number().int().min(0).max(23),
  showShortcutHints: z.boolean(),
  exportFormat: z.enum(["json", "csv"]),
  autoSyncOnVaultChange: z.boolean(),
});

// ─── Deck ─────────────────────────────────────────────────────────────────────

export const DeckRecordSchema: z.ZodType<DeckRecord> = z.object({
  id: z.string(),
  name: z.string().min(1),
  parentDeckId: z.string().nullable(),
  newLimitPerDay: z.number().int().nonnegative().nullable(),
  reviewLimitPerDay: z.number().int().nonnegative().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  archived: z.boolean(),
});

// ─── Tag ──────────────────────────────────────────────────────────────────────

export const TagRecordSchema: z.ZodType<TagRecord> = z.object({
  id: z.string(),
  label: z.string().min(1),
  createdAt: isoDateSchema,
});

// ─── Source Anchor ────────────────────────────────────────────────────────────

export const SourceAnchorSchema: z.ZodType<SourceAnchor> = z.object({
  filePath: z.string(),
  noteTitle: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  selectedText: z.string(),
  leadingContext: z.string(),
  trailingContext: z.string(),
  excerpt: z.string(),
  contentHash: z.string(),
  lastResolvedAt: isoDateSchema,
});

// ─── Card Template ────────────────────────────────────────────────────────────

export const CardTemplateRecordSchema: z.ZodType<CardTemplateRecord> = z.object({
  id: z.string(),
  kind: z.enum(["basic", "reverse", "cloze", "custom"]),
  deckId: z.string(),
  tagIds: z.array(z.string()),
  sourceAnchor: SourceAnchorSchema,
  frontMarkdown: z.string(),
  backMarkdown: z.string(),
  clozeMarkdown: z.string().nullable(),
  hintByClozeIndex: z.record(z.number(), z.string()),
  customTemplateId: z.string().nullable(),
  generatedCardIds: z.array(z.string()),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  archived: z.boolean(),
});

// ─── Review Card ──────────────────────────────────────────────────────────────

export const ReviewCardRecordSchema: z.ZodType<ReviewCardRecord> = z.object({
  id: z.string(),
  templateId: z.string(),
  variantKey: z.string(),
  promptMarkdown: z.string(),
  answerMarkdown: z.string(),
  promptText: z.string(),
  answerText: z.string(),
  state: z.enum(["new", "learning", "review", "relearning", "suspended"]),
  dueAt: isoDateSchema.nullable(),
  lastReviewedAt: isoDateSchema.nullable(),
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  elapsedDays: z.number().int().nonnegative(),
  scheduledDays: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  suspended: z.boolean(),
  stateBeforeSuspension: z
    .enum(["new", "learning", "review", "relearning", "suspended"])
    .nullable(),
  buriedUntil: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

// ─── Review Log ───────────────────────────────────────────────────────────────

export const ReviewLogRecordSchema: z.ZodType<ReviewLogRecord> = z.object({
  id: z.string(),
  sessionId: z.string(),
  cardId: z.string(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: isoDateSchema,
  previousState: z.enum(["new", "learning", "review", "relearning", "suspended"]),
  nextState: z.enum(["new", "learning", "review", "relearning", "suspended"]),
  previousDueAt: isoDateSchema.nullable(),
  nextDueAt: isoDateSchema.nullable(),
});

// ─── Session Draft ────────────────────────────────────────────────────────────

export const ReviewSessionDraftSchema: z.ZodType<ReviewSessionDraft> = z.object({
  id: z.string(),
  deckIds: z.array(z.string()),
  queuedCardIds: z.array(z.string()),
  completedCardIds: z.array(z.string()),
  currentCardId: z.string().nullable(),
  revealed: z.boolean(),
  startedAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

// ─── Plugin Data ──────────────────────────────────────────────────────────────

export const PluginDataSchema: z.ZodType<PluginData> = z.object({
  version: z.number().int().positive(),
  settings: PluginSettingsSchema,
  decks: z.array(DeckRecordSchema),
  tags: z.array(TagRecordSchema),
  templates: z.array(CardTemplateRecordSchema),
  cards: z.array(ReviewCardRecordSchema),
  logs: z.array(ReviewLogRecordSchema),
  sessionDraft: ReviewSessionDraftSchema.nullable(),
});

// ─── Parse helpers ────────────────────────────────────────────────────────────

export function safeParsePluginData(raw: unknown): PluginData {
  const result = PluginDataSchema.safeParse(raw);
  if (result.success) return result.data;
  return createDefaultPluginData();
}

export function validatePluginData(raw: unknown): PluginData {
  return PluginDataSchema.parse(raw);
}
