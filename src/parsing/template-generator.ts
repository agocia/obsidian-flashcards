import {
  createId,
  nowIso,
  createReviewCard,
  type CardKind,
  type CardTemplateRecord,
  type ReviewCardRecord,
  type SourceAnchor,
} from "../domain/models";

// ─── Cloze parsing ────────────────────────────────────────────────────────────

/**
 * Parse {{c1::text}} or {{c1::text::hint}} syntax.
 * Returns list of cloze tokens with index, text, and optional hint.
 */
export interface ClozeToken {
  index: number;
  text: string;
  hint: string;
  fullMatch: string;
}

const CLOZE_RE = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;

export function parseClozeTokens(markdown: string): ClozeToken[] {
  const tokens: ClozeToken[] = [];
  let match: RegExpExecArray | null;
  CLOZE_RE.lastIndex = 0;
  while ((match = CLOZE_RE.exec(markdown)) !== null) {
    tokens.push({
      index: parseInt(match[1]!, 10),
      text: match[2]!,
      hint: match[3] ?? "",
      fullMatch: match[0],
    });
  }
  return tokens;
}

/** Render a cloze string for the prompt (mask a specific token). */
export function renderClozePrompt(
  markdown: string,
  activeIndex: number,
  overrideHint: string
): string {
  CLOZE_RE.lastIndex = 0;
  return markdown.replace(CLOZE_RE, (_full, idx, _text, inlineHint) => {
    const i = parseInt(idx, 10);
    if (i === activeIndex) {
      const hint = overrideHint || (inlineHint as string | undefined) || "";
      return hint ? `[${hint}]` : "[...]";
    }
    return _text as string;
  });
}

/** Render a cloze string for the answer (reveal a specific token). */
export function renderClozeAnswer(markdown: string, activeIndex: number): string {
  CLOZE_RE.lastIndex = 0;
  return markdown.replace(CLOZE_RE, (_full, idx, text) => {
    const i = parseInt(idx, 10);
    if (i === activeIndex) {
      return `**${text as string}**`;
    }
    return text as string;
  });
}

// ─── Generate input ───────────────────────────────────────────────────────────

export interface GenerateTemplateInput {
  mode: CardKind;
  deckId: string;
  tagIds: string[];
  sourceAnchor: SourceAnchor;
  frontMarkdown?: string;
  backMarkdown?: string;
  clozeMarkdown?: string;
  hintByClozeIndex?: Record<number, string>;
  customTemplateId?: string | null;
}

export interface GenerateTemplateResult {
  template: CardTemplateRecord;
  cards: ReviewCardRecord[];
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateTemplate(input: GenerateTemplateInput): GenerateTemplateResult {
  const now = nowIso();
  const templateId = createId("tpl");

  const template: CardTemplateRecord = {
    id: templateId,
    kind: input.mode,
    deckId: input.deckId,
    tagIds: input.tagIds,
    sourceAnchor: input.sourceAnchor,
    frontMarkdown: input.frontMarkdown ?? "",
    backMarkdown: input.backMarkdown ?? "",
    clozeMarkdown: input.clozeMarkdown ?? null,
    hintByClozeIndex: input.hintByClozeIndex ?? {},
    customTemplateId: input.customTemplateId ?? null,
    generatedCardIds: [],
    createdAt: now,
    updatedAt: now,
    archived: false,
  };

  const cards = buildGeneratedCards(template);
  template.generatedCardIds = cards.map((c) => c.id);

  return { template, cards };
}

// ─── Card builders per kind ───────────────────────────────────────────────────

function buildGeneratedCards(template: CardTemplateRecord): ReviewCardRecord[] {
  switch (template.kind) {
    case "basic":
      return buildBasicCards(template);
    case "reverse":
      return buildReverseCards(template);
    case "cloze":
      return buildClozeCards(template);
    case "custom":
      return buildBasicCards(template); // custom uses basic layout
    default:
      return [];
  }
}

function buildBasicCards(template: CardTemplateRecord): ReviewCardRecord[] {
  return [
    createReviewCard(template.id, "forward", template.frontMarkdown, template.backMarkdown),
  ];
}

function buildReverseCards(template: CardTemplateRecord): ReviewCardRecord[] {
  return [
    createReviewCard(template.id, "forward", template.frontMarkdown, template.backMarkdown),
    createReviewCard(template.id, "reverse", template.backMarkdown, template.frontMarkdown),
  ];
}

function buildClozeCards(template: CardTemplateRecord): ReviewCardRecord[] {
  if (!template.clozeMarkdown) return [];

  const tokens = parseClozeTokens(template.clozeMarkdown);
  if (tokens.length === 0) {
    throw new Error("ClozeParseError: no cloze markers found in clozeMarkdown");
  }
  const uniqueIndices = [...new Set(tokens.map((t) => t.index))].sort((a, b) => a - b);

  return uniqueIndices.map((idx) => {
    const hint = template.hintByClozeIndex[idx] ?? "";
    const promptMd = renderClozePrompt(template.clozeMarkdown!, idx, hint);
    const answerMd = renderClozeAnswer(template.clozeMarkdown!, idx);
    return createReviewCard(template.id, `cloze:${idx}`, promptMd, answerMd);
  });
}
