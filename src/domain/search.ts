import type { Document } from "./document";

export type TextMatch = {
  start: number;
  end: number;
  text: string;
};

export type GlobalMatch = {
  id: string;
  title: string;
  matchCount: number;
  snippet: string;
};

const SNIPPET_RADIUS = 30;

export function findMatches(text: string, query: string): TextMatch[] {
  if (query.length === 0) {
    return [];
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;

  while (from <= haystack.length) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) {
      break;
    }
    const end = start + needle.length;
    matches.push({ start, end, text: text.slice(start, end) });
    from = start + needle.length;
  }

  return matches;
}

export function searchBody(body: string, query: string, limit: number): { total: number; items: TextMatch[] } {
  const items = findMatches(body, query);
  return { total: items.length, items: items.slice(0, limit) };
}

export function searchDocuments(
  documents: Document[],
  query: string,
  limit: number,
): { total: number; items: GlobalMatch[] } {
  const items: GlobalMatch[] = [];

  for (const document of documents) {
    const titleMatches = findMatches(document.title, query);
    const bodyMatches = findMatches(document.body, query);
    const matchCount = titleMatches.length + bodyMatches.length;
    if (matchCount === 0) {
      continue;
    }
    items.push({
      id: document.id,
      title: document.title,
      matchCount,
      snippet: bodyMatches[0] ? snippetAround(document.body, bodyMatches[0]) : document.title,
    });
  }

  return { total: items.length, items: items.slice(0, limit) };
}

function snippetAround(body: string, match: TextMatch): string {
  const start = Math.max(0, match.start - SNIPPET_RADIUS);
  const end = Math.min(body.length, match.end + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < body.length ? "..." : "";
  return `${prefix}${body.slice(start, end)}${suffix}`;
}
