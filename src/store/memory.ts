import { randomUUID } from "node:crypto";
import type { Document, DocumentStore, StoreResult } from "../domain/document";

export class InMemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, Document>();

  async create(input: { title: string; body: string }): Promise<Document> {
    const now = new Date().toISOString();
    const document: Document = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.documents.set(document.id, document);
    return clone(document);
  }

  async get(id: string): Promise<Document | null> {
    const document = this.documents.get(id);
    return document ? clone(document) : null;
  }

  async list(): Promise<Document[]> {
    return [...this.documents.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async save(id: string, next: { body: string; expectedVersion?: number }): Promise<StoreResult> {
    const current = this.documents.get(id);
    if (!current) {
      return "not_found";
    }
    if (next.expectedVersion !== undefined && next.expectedVersion !== current.version) {
      return "conflict";
    }
    if (current.archivedAt !== null) {
      return "conflict";
    }
    const updated: Document = {
      ...current,
      body: next.body,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return clone(updated);
  }

  async setArchived(id: string, archivedAt: string | null, expectedVersion?: number): Promise<StoreResult> {
    const current = this.documents.get(id);
    if (!current) {
      return "not_found";
    }
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      return "conflict";
    }
    const updated: Document = {
      ...current,
      archivedAt,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, updated);
    return clone(updated);
  }
}

function clone(document: Document): Document {
  return { ...document };
}
