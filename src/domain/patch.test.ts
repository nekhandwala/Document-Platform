import { describe, expect, it } from "vitest";
import { applyChanges, MAX_BODY_LENGTH, MAX_CHANGES, type RangeReplace } from "./patch";

function replace(start: number, end: number, text: string): RangeReplace {
  return { operation: "replace", range: { start, end }, text };
}

describe("applyChanges", () => {
  it("replaces a range", () => {
    const result = applyChanges("abcdefghij", [replace(0, 3, "XYZ")]);
    expect(result).toEqual({ ok: true, body: "XYZdefghij" });
  });

  it("applies each change to the body produced by the previous change", () => {
    const result = applyChanges("abcdefghij", [replace(0, 3, "XYZ"), replace(3, 6, "123")]);
    expect(result).toEqual({ ok: true, body: "XYZ123ghij" });
  });

  it("inserts when the range is empty", () => {
    const result = applyChanges("ac", [replace(1, 1, "b")]);
    expect(result).toEqual({ ok: true, body: "abc" });
  });

  it("deletes when the replacement is empty", () => {
    const result = applyChanges("abcdef", [replace(2, 4, "")]);
    expect(result).toEqual({ ok: true, body: "abef" });
  });

  it("rejects a range outside the document and reports the change index", () => {
    const result = applyChanges("abc", [replace(0, 1, "Z"), replace(0, 9, "nope")]);
    expect(result).toEqual({ ok: false, error: "range is outside the document", index: 1 });
  });

  it("rejects a range whose start is after its end", () => {
    const result = applyChanges("abc", [replace(2, 1, "nope")]);
    expect(result).toEqual({ ok: false, error: "range start is after end", index: 0 });
  });

  it("rejects a body that would grow past the limit", () => {
    const result = applyChanges("a", [replace(1, 1, "b".repeat(MAX_BODY_LENGTH))]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("body is too long");
      expect(result.index).toBe(0);
    }
  });

  it("rejects more than the maximum number of changes", () => {
    const changes = Array.from({ length: MAX_CHANGES + 1 }, () => replace(0, 0, ""));
    const result = applyChanges("abc", changes);
    expect(result).toEqual({ ok: false, error: "too many changes" });
  });
});
