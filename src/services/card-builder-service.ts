import type { PluginDataRepository } from "../data/plugin-data-repository";
import {
  generateTemplate,
  type GenerateTemplateInput,
  type GenerateTemplateResult,
} from "../parsing/template-generator";
import {
  captureAnchor,
  type SelectionContext,
} from "../data/source-anchor-resolver";
import { nowIso } from "../domain/models";

// ─── I/O types ────────────────────────────────────────────────────────────────

export interface CreateFromSelectionInput {
  selectionContext: SelectionContext;
  mode: GenerateTemplateInput["mode"];
  deckId: string;
  tagIds: string[];
  frontMarkdown?: string;
  backMarkdown?: string;
  clozeMarkdown?: string;
  hintByClozeIndex?: Record<number, string>;
  customTemplateId?: string | null;
}

export interface PreviewCardPayload {
  variantKey: string;
  promptMarkdown: string;
  answerMarkdown: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CardBuilderService {
  constructor(private readonly repository: PluginDataRepository) {}

  async createFromSelection(
    input: CreateFromSelectionInput
  ): Promise<GenerateTemplateResult> {
    if (!input.selectionContext.fileContent.trim()) {
      throw new Error("SelectionEmptyError: file content is empty");
    }

    const selectedText = input.selectionContext.fileContent.slice(
      input.selectionContext.startOffset,
      input.selectionContext.endOffset
    );

    if (!selectedText.trim()) {
      throw new Error("SelectionEmptyError: selected text is empty");
    }

    const anchor = captureAnchor(input.selectionContext);

    const result = generateTemplate({
      mode: input.mode,
      deckId: input.deckId,
      tagIds: input.tagIds,
      sourceAnchor: anchor,
      frontMarkdown: input.frontMarkdown ?? selectedText,
      backMarkdown: input.backMarkdown ?? "",
      clozeMarkdown: input.clozeMarkdown,
      hintByClozeIndex: input.hintByClozeIndex,
      customTemplateId: input.customTemplateId,
    });

    await this.repository.save((data) => ({
      ...data,
      templates: [...data.templates, result.template],
      cards: [...data.cards, ...result.cards],
    }));

    return result;
  }

  previewTemplate(
    input: Omit<GenerateTemplateInput, "sourceAnchor"> & {
      sourceAnchor?: GenerateTemplateInput["sourceAnchor"];
    }
  ): PreviewCardPayload[] {
    const dummyAnchor = input.sourceAnchor ?? {
      filePath: "",
      noteTitle: "",
      startOffset: 0,
      endOffset: 0,
      selectedText: "",
      leadingContext: "",
      trailingContext: "",
      excerpt: "",
      contentHash: "",
      lastResolvedAt: nowIso(),
    };

    const result = generateTemplate({ ...input, sourceAnchor: dummyAnchor });

    return result.cards.map((c) => ({
      variantKey: c.variantKey,
      promptMarkdown: c.promptMarkdown,
      answerMarkdown: c.answerMarkdown,
    }));
  }
}
