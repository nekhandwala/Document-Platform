import type { RangeReplace } from "./api";

/**
 * Describe the edit from `before` to `after` as one range replacement.
 *
 * Keeps the longest common prefix and suffix and replaces whatever is between
 * them. Typing, pasting, deleting a selection or replacing a selection is always
 * a single contiguous change, so this is exact for normal editing. Indexes are
 * UTF-16 code units, the same as the API.
 */
export function diffToChange(before: string, after: string): RangeReplace | null {
  if (before === after) {
    return null;
  }

  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
    start += 1;
  }

  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return {
    operation: "replace",
    range: { start, end: endBefore },
    text: after.slice(start, endAfter),
  };
}
