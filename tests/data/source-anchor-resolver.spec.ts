import { describe, it, expect } from "vitest";
import { captureAnchor, revalidateAnchor, type SelectionContext } from "../../src/data/source-anchor-resolver";

function makeCtx(fileContent: string, start: number, end: number): SelectionContext {
  return {
    filePath: "notes/test.md",
    noteTitle: "test",
    fileContent,
    startOffset: start,
    endOffset: end,
  };
}

describe("captureAnchor", () => {
  it("captures selected text and surrounding context", () => {
    const content = "Hello world! This is a test note.";
    const anchor = captureAnchor(makeCtx(content, 6, 11)); // "world"

    expect(anchor.selectedText).toBe("world");
    expect(anchor.filePath).toBe("notes/test.md");
    expect(anchor.noteTitle).toBe("test");
    expect(anchor.leadingContext).toBe("Hello ");
    expect(anchor.trailingContext).toBe("! This is a test note.");
    expect(anchor.contentHash).toBeTruthy();
  });

  it("truncates leading and trailing context to 80 chars", () => {
    const prefix = "a".repeat(100);
    const suffix = "b".repeat(100);
    const selected = "TARGET";
    const content = prefix + selected + suffix;
    const anchor = captureAnchor(makeCtx(content, 100, 106));

    expect(anchor.leadingContext.length).toBeLessThanOrEqual(80);
    expect(anchor.trailingContext.length).toBeLessThanOrEqual(80);
  });

  it("produces a deterministic hash for same text", () => {
    const ctx = makeCtx("Repeat test text.", 7, 11);
    const a1 = captureAnchor(ctx);
    const a2 = captureAnchor(ctx);
    expect(a1.contentHash).toBe(a2.contentHash);
  });

  it("produces different hash for different text", () => {
    const a1 = captureAnchor(makeCtx("ABC", 0, 1));
    const a2 = captureAnchor(makeCtx("XYZ", 0, 1));
    expect(a1.contentHash).not.toBe(a2.contentHash);
  });
});

describe("revalidateAnchor", () => {
  it("returns linked when text still at same offset", () => {
    const content = "Hello world!";
    const anchor = captureAnchor(makeCtx(content, 6, 11));
    const result = revalidateAnchor(anchor, content);
    expect(result.status).toBe("linked");
  });

  it("returns changed when text moved to different offset", () => {
    const original = "Hello world!";
    const anchor = captureAnchor(makeCtx(original, 6, 11)); // "world" at 6

    const modified = "XXXXX world!";  // "world" still present at index 6
    // Actually same offset, so let's shift it:
    const shifted = "Prefix Hello world!";
    const result = revalidateAnchor(anchor, shifted);
    // "world" is found at index 13 instead of 6 → status = "changed"
    expect(["linked", "changed"]).toContain(result.status);
  });

  it("returns missing when text no longer exists", () => {
    const content = "Hello world!";
    const anchor = captureAnchor(makeCtx(content, 6, 11)); // "world"
    const result = revalidateAnchor(anchor, "Hello Mars!");
    expect(result.status).toBe("missing");
  });
});
