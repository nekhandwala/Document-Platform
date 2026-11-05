import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/domain/patch";
import { diffToChange } from "./diff";

function roundTrip(before: string, after: string) {
  const change = diffToChange(before, after);
  expect(change).not.toBeNull();
  expect(applyChanges(before, [change!])).toEqual({ ok: true, body: after });
  return change!;
}

describe("diffToChange", () => {
  it("returns null when nothing changed", () => {
    expect(diffToChange("same", "same")).toBeNull();
  });

  it("describes an insertion as an empty range", () => {
    expect(roundTrip("hello world", "hello brave world")).toEqual({
      operation: "replace",
      range: { start: 6, end: 6 },
      text: "brave ",
    });
  });

  it("describes a deletion as empty text", () => {
    expect(roundTrip("hello brave world", "hello world")).toEqual({
      operation: "replace",
      range: { start: 6, end: 12 },
      text: "",
    });
  });

  it("describes a replaced selection", () => {
    expect(roundTrip("The contract is final.", "The lease is final.")).toEqual({
      operation: "replace",
      range: { start: 4, end: 12 },
      text: "lease",
    });
  });

  it("handles edits at either end and from or to an empty body", () => {
    roundTrip("abc", "Xabc");
    roundTrip("abc", "abcX");
    roundTrip("", "new body");
    roundTrip("old body", "");
  });

  it("does not let the prefix and suffix overlap on repeated characters", () => {
    expect(roundTrip("aa", "aaa")).toEqual({ operation: "replace", range: { start: 2, end: 2 }, text: "a" });
    roundTrip("aaa", "a");
  });

  it("round-trips non-BMP characters", () => {
    roundTrip("a😀b", "a😃b");
    roundTrip("😀", "😀😀");
  });
});
