import type { Document, DocumentStore, StoreResult } from "../domain/document";
import {
  DocumentConflictError,
  DocumentLockedError,
  DocumentNotFoundError,
  InvalidPatchError,
} from "../domain/errors";
import { lockInfo, type LockInfo, type LockStore } from "../domain/lock";
import { applyChanges, type RangeReplace } from "../domain/patch";
import { searchBody, searchDocuments, type GlobalMatch, type TextMatch } from "../domain/search";

export type Status = "active" | "archived" | "all";
export const STATUSES: readonly Status[] = ["active", "archived", "all"];

export type SearchResult<T> = { total: number; items: T[] };

/** A document as the API returns it: the stored fields plus who is editing it. */
export type DocumentView = Document & { lock: LockInfo | null };

export const DEFAULT_LOCK_TTL_MS = 30_000;

/**
 * The document API's behaviour, independent of HTTP. Inputs are already
 * validated; failures are thrown as the errors in domain/errors.
 *
 * Editing uses a lease lock: one person at a time holds a token for a document,
 * and only that token can patch it. The lease expires unless renewed, so a
 * client that disappears frees the document after `lockTtlMs`.
 */
export class DocumentService {
  constructor(
    private readonly store: DocumentStore,
    private readonly locks: LockStore,
    private readonly lockTtlMs = DEFAULT_LOCK_TTL_MS,
  ) {}

  async list(status: Status): Promise<DocumentView[]> {
    const documents = (await this.store.list()).filter((document) => matchesStatus(document, status));
    return Promise.all(documents.map((document) => this.view(document)));
  }

  async create(input: { title: string; body: string; createdBy: string }): Promise<DocumentView> {
    return this.view(await this.store.create(input));
  }

  async get(id: string): Promise<DocumentView> {
    return this.view(await this.load(id));
  }

  /** Take the edit lock, or renew it when `token` already holds it. */
  async lock(id: string, holder: string, token?: string): Promise<{ lockToken: string; lock: LockInfo }> {
    const document = await this.load(id);
    if (document.archivedAt !== null) {
      throw new DocumentConflictError("document is archived");
    }
    const result = await this.locks.acquire(id, holder, this.lockTtlMs, token);
    if (!result.ok) {
      throw new DocumentLockedError(lockInfo(result.lock));
    }
    return { lockToken: result.lock.token, lock: lockInfo(result.lock) };
  }

  /** Give up the edit lock. Releasing a lock that already expired is not an error. */
  async unlock(id: string, token: string): Promise<void> {
    await this.load(id);
    if (await this.locks.release(id, token)) {
      return;
    }
    const current = await this.locks.get(id);
    if (current) {
      throw new DocumentLockedError(lockInfo(current));
    }
  }

  async patch(
    id: string,
    token: string | undefined,
    input: { expectedRevision?: number; changes: RangeReplace[] },
  ): Promise<DocumentView> {
    const current = await this.load(id);
    if (current.archivedAt !== null) {
      throw new DocumentConflictError("document is archived");
    }
    const lock = await this.requireLock(id, token);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new DocumentConflictError("revision conflict");
    }
    const applied = applyChanges(current.body, input.changes);
    if (!applied.ok) {
      throw new InvalidPatchError(applied.error, applied.index);
    }
    // Save against the revision just read, so a write that lands in between is a conflict.
    const saved = await this.store.save(id, { body: applied.body, expectedRevision: current.revision });
    if (saved === "conflict") {
      const latest = await this.store.get(id);
      throw new DocumentConflictError(latest?.archivedAt ? "document is archived" : "revision conflict");
    }
    // Editing counts as activity, so it extends the lease too.
    await this.locks.acquire(id, lock.holder, this.lockTtlMs, lock.token);
    return this.view(unwrap(id, saved));
  }

  /**
   * Archive or unarchive. Blocked while someone else is editing; the editor
   * themselves may archive, which ends their lock since the document becomes read only.
   */
  async setArchived(id: string, archived: boolean, token?: string, expectedRevision?: number): Promise<DocumentView> {
    const current = await this.locks.get(id);
    if (current && current.token !== token) {
      throw new DocumentLockedError(lockInfo(current));
    }
    const archivedAt = archived ? new Date().toISOString() : null;
    const saved = unwrap(id, await this.store.setArchived(id, archivedAt, expectedRevision));
    if (archived && current) {
      await this.locks.release(id, current.token);
    }
    return this.view(saved);
  }

  async search(query: { q: string; limit: number; status: Status }): Promise<SearchResult<GlobalMatch>> {
    const documents = (await this.store.list()).filter((document) => matchesStatus(document, query.status));
    return searchDocuments(documents, query.q, query.limit);
  }

  async searchOne(id: string, query: { q: string; limit: number }): Promise<SearchResult<TextMatch>> {
    const document = await this.load(id);
    return searchBody(document.body, query.q, query.limit);
  }

  private async load(id: string): Promise<Document> {
    const document = await this.store.get(id);
    if (!document) {
      throw new DocumentNotFoundError(id);
    }
    return document;
  }

  private async requireLock(id: string, token: string | undefined) {
    const lock = await this.locks.get(id);
    if (!lock || lock.token !== token) {
      throw new DocumentLockedError(lock ? lockInfo(lock) : null);
    }
    return lock;
  }

  private async view(document: Document): Promise<DocumentView> {
    const lock = await this.locks.get(document.id);
    return { ...document, lock: lock ? lockInfo(lock) : null };
  }
}

function matchesStatus(document: Document, status: Status): boolean {
  if (status === "all") {
    return true;
  }
  return (document.archivedAt !== null) === (status === "archived");
}

function unwrap(id: string, result: StoreResult): Document {
  if (result === "not_found") {
    throw new DocumentNotFoundError(id);
  }
  if (result === "conflict") {
    throw new DocumentConflictError("revision conflict");
  }
  return result;
}
