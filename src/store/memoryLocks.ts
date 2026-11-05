import { randomUUID } from "node:crypto";
import type { AcquireResult, Lock, LockStore } from "../domain/lock";

export class InMemoryLockStore implements LockStore {
  private readonly locks = new Map<string, Lock>();

  /** `now` is injectable so tests can move time forward. */
  constructor(private readonly now: () => number = Date.now) {}

  async get(documentId: string): Promise<Lock | null> {
    const lock = this.locks.get(documentId);
    if (!lock) {
      return null;
    }
    if (Date.parse(lock.expiresAt) <= this.now()) {
      this.locks.delete(documentId);
      return null;
    }
    return { ...lock };
  }

  async acquire(documentId: string, holder: string, ttlMs: number, token?: string): Promise<AcquireResult> {
    const current = await this.get(documentId);
    if (current && current.token !== token) {
      return { ok: false, lock: current };
    }
    const lock: Lock = {
      documentId,
      holder,
      token: current?.token ?? randomUUID(),
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
    };
    this.locks.set(documentId, lock);
    return { ok: true, lock: { ...lock } };
  }

  async release(documentId: string, token: string): Promise<boolean> {
    const current = await this.get(documentId);
    if (!current || current.token !== token) {
      return false;
    }
    this.locks.delete(documentId);
    return true;
  }
}
