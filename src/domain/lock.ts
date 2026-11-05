/**
 * An edit lock on one document. Only the holder of `token` may change the
 * document until `expiresAt`; after that the lock is gone and anyone may take it.
 * Holders renew well before expiry, so a crashed client frees the document on its own.
 */
export type Lock = {
  documentId: string;
  holder: string;
  token: string;
  expiresAt: string;
};

/** What other clients may see about a lock. The token stays secret. */
export type LockInfo = Pick<Lock, "holder" | "expiresAt">;

export function lockInfo(lock: Lock): LockInfo {
  return { holder: lock.holder, expiresAt: lock.expiresAt };
}

export type AcquireResult = { ok: true; lock: Lock } | { ok: false; lock: Lock };

export interface LockStore {
  /** The active lock, or null if there is none or it has expired. */
  get(documentId: string): Promise<Lock | null>;
  /**
   * Take the lock, or renew it when `token` matches the active lock. Fails with
   * the current lock when someone else holds it.
   */
  acquire(documentId: string, holder: string, ttlMs: number, token?: string): Promise<AcquireResult>;
  /** Drop the lock if `token` holds it. Returns whether anything was released. */
  release(documentId: string, token: string): Promise<boolean>;
}
