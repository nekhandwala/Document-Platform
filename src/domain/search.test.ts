import { describe, expect, it } from "vitest";
import type { Document } from "./document";
import { searchBody, searchDocuments } from "./search";

function document(partial: Pick<Document, "id" | "title" | "body">): Document {
  return {
    ...partial,
    createdBy: "tester",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

describe("searchBody", () => {
  it("matches without regard to case and keeps the original text", () => {
    const result = searchBody("The Contract and another contract.", "contract", 10);
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      { start: 4, end: 12, text: "Contract" },
      { start: 25, end: 33, text: "contract" },
    ]);
  });

  it("returns only the first limit matches and still reports the full total", () => {
    const result = searchBody("aa aa aa", "aa", 2);
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ start: 0, end: 2, text: "aa" });
  });
});

describe("searchDocuments", () => {
  const documents = [
    document({ id: "1", title: "Notes", body: "See the contract terms." }),
    document({ id: "2", title: "Contract addendum", body: "Nothing here." }),
    document({ id: "3", title: "Other", body: "Unrelated." }),
  ];

  it("matches title or body and limits the returned documents", () => {
    const result = searchDocuments(documents, "contract", 1);
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      {
        id: "1",
        title: "Notes",
        matchCount: 1,
        snippet: "See the contract terms.",
      },
    ]);
  });
});
