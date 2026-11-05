import type { LockInfo } from "./lock";

/**
 * Failures the service layer can report. They say nothing about HTTP; the
 * error middleware decides which status each one becomes.
 */

export class DocumentNotFoundError extends Error {
  constructor(readonly id: string) {
    super("document not found");
  }
}

/** The document changed since the caller read it, or it is archived and cannot be edited. */
export class DocumentConflictError extends Error {
  constructor(message: "revision conflict" | "document is archived") {
    super(message);
  }
}

/** A patch that is well formed but cannot apply to the current body. */
export class InvalidPatchError extends Error {
  constructor(
    message: string,
    readonly index?: number,
  ) {
    super(message);
  }
}

/** Someone else holds the edit lock, or the caller does not hold it. */
export class DocumentLockedError extends Error {
  constructor(readonly lock: LockInfo | null) {
    super(lock ? `document is being edited by ${lock.holder}` : "document lock is required to edit");
  }
}
