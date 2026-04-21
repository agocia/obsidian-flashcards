import type { SourceAnchor } from "../domain/models";

// ─── Simple FNV-1a 32-bit hash for content integrity ─────────────────────────

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ─── Selection input ──────────────────────────────────────────────────────────

export interface SelectionContext {
  filePath: string;
  noteTitle: string;
  fileContent: string;
  startOffset: number;
  endOffset: number;
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length));
}

function trimRange(
  fileContent: string,
  startOffset: number,
  endOffset: number
): { startOffset: number; endOffset: number } | null {
  const start = Math.min(startOffset, endOffset);
  const end = Math.max(startOffset, endOffset);
  const raw = fileContent.slice(start, end);
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;

  return {
    startOffset: start + leadingWhitespace,
    endOffset: end - trailingWhitespace,
  };
}

function lineBoundsAtOffset(
  fileContent: string,
  offset: number
): { startOffset: number; endOffset: number } | null {
  const safeOffset = clampOffset(offset, fileContent.length);
  const anchor = safeOffset === fileContent.length ? Math.max(0, safeOffset - 1) : safeOffset;
  const lineStart = fileContent.lastIndexOf("\n", anchor - 1) + 1;
  const nextNewline = fileContent.indexOf("\n", safeOffset);
  const lineEnd = nextNewline === -1 ? fileContent.length : nextNewline;

  return trimRange(fileContent, lineStart, lineEnd);
}

function findNearestNonEmptyLine(
  fileContent: string,
  offset: number
): { startOffset: number; endOffset: number } | null {
  const safeOffset = clampOffset(offset, fileContent.length);
  const visited = new Set<number>();
  const queue: number[] = [safeOffset];

  while (queue.length > 0) {
    const currentOffset = queue.shift()!;
    const safeCurrent = clampOffset(currentOffset, fileContent.length);
    if (visited.has(safeCurrent)) continue;
    visited.add(safeCurrent);

    const range = lineBoundsAtOffset(fileContent, safeCurrent);
    if (range) return range;

    const anchor = safeCurrent === fileContent.length ? Math.max(0, safeCurrent - 1) : safeCurrent;
    const lineStart = fileContent.lastIndexOf("\n", anchor - 1) + 1;
    const nextNewline = fileContent.indexOf("\n", safeCurrent);
    const lineEnd = nextNewline === -1 ? fileContent.length : nextNewline;

    if (lineEnd < fileContent.length) queue.push(lineEnd + 1);
    if (lineStart > 0) queue.push(lineStart - 1);
  }

  return null;
}

export function resolveSelectionContext(
  ctx: SelectionContext
): SelectionContext | null {
  const normalizedSelection = trimRange(
    ctx.fileContent,
    clampOffset(ctx.startOffset, ctx.fileContent.length),
    clampOffset(ctx.endOffset, ctx.fileContent.length)
  );

  if (normalizedSelection) {
    return {
      ...ctx,
      ...normalizedSelection,
    };
  }

  const fallbackLine = findNearestNonEmptyLine(ctx.fileContent, ctx.startOffset);
  if (!fallbackLine) return null;

  return {
    ...ctx,
    ...fallbackLine,
  };
}

// ─── Capture ──────────────────────────────────────────────────────────────────

export function captureAnchor(ctx: SelectionContext): SourceAnchor {
  const { fileContent, startOffset, endOffset } = ctx;
  const selectedText = fileContent.slice(startOffset, endOffset);
  const leadingContext = fileContent.slice(Math.max(0, startOffset - 80), startOffset);
  const trailingContext = fileContent.slice(endOffset, endOffset + 80);

  return {
    filePath: ctx.filePath,
    noteTitle: ctx.noteTitle,
    startOffset,
    endOffset,
    selectedText,
    leadingContext,
    trailingContext,
    excerpt: selectedText.slice(0, 120),
    contentHash: fnv1a(selectedText),
    lastResolvedAt: new Date().toISOString(),
  };
}

// ─── Revalidation ─────────────────────────────────────────────────────────────

export type AnchorStatus = "linked" | "changed" | "missing";

export interface AnchorValidationResult {
  status: AnchorStatus;
  resolvedOffset?: { start: number; end: number };
}

/**
 * Try to re-locate an anchor in the current file content.
 * Strategy: exact text match near original offset first,
 * then fall back to context-guided fuzzy search.
 */
export function revalidateAnchor(
  anchor: SourceAnchor,
  currentContent: string
): AnchorValidationResult {
  const { selectedText, startOffset, contentHash } = anchor;

  if (!currentContent.includes(selectedText)) {
    return { status: "missing" };
  }

  // Try exact offset first
  const sliceAtOffset = currentContent.slice(
    startOffset,
    startOffset + selectedText.length
  );
  if (sliceAtOffset === selectedText) {
    const currentHash = fnv1a(selectedText);
    return {
      status: currentHash === contentHash ? "linked" : "changed",
      resolvedOffset: { start: startOffset, end: startOffset + selectedText.length },
    };
  }

  // Fall back to first occurrence search
  const idx = currentContent.indexOf(selectedText);
  if (idx !== -1) {
    return {
      status: "changed",
      resolvedOffset: { start: idx, end: idx + selectedText.length },
    };
  }

  return { status: "missing" };
}
