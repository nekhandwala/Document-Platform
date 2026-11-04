export const MAX_CHANGES = 100;
export const MAX_BODY_LENGTH = 1_000_000;

export type RangeReplace = {
  operation: "replace";
  range: { start: number; end: number };
  text: string;
};

export type ApplySuccess = { ok: true; body: string };
export type ApplyFailure = { ok: false; error: string; index?: number };
export type ApplyResult = ApplySuccess | ApplyFailure;

export function applyChanges(body: string, changes: RangeReplace[]): ApplyResult {
  if (changes.length > MAX_CHANGES) {
    return { ok: false, error: "too many changes" };
  }

  let next = body;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const { start, end } = change.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > next.length) {
      return { ok: false, error: "range is outside the document", index };
    }
    if (start > end) {
      return { ok: false, error: "range start is after end", index };
    }
    const updated = next.slice(0, start) + change.text + next.slice(end);
    if (updated.length > MAX_BODY_LENGTH) {
      return { ok: false, error: "body is too long", index };
    }
    next = updated;
  }

  return { ok: true, body: next };
}
