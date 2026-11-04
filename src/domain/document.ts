export type Document = {
  id: string;
  title: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StoreMiss = "not_found" | "conflict";

export type StoreResult = Document | StoreMiss;

export function isDocument(result: StoreResult): result is Document {
  return typeof result !== "string";
}

export interface DocumentStore {
  create(input: { title: string; body: string }): Promise<Document>;
  get(id: string): Promise<Document | null>;
  list(): Promise<Document[]>;
  save(
    id: string,
    next: { body: string; expectedVersion?: number },
  ): Promise<StoreResult>;
  setArchived(
    id: string,
    archivedAt: string | null,
    expectedVersion?: number,
  ): Promise<StoreResult>;
}
