import express, { type Express } from "express";
import type { DocumentStore } from "./domain/document";
import type { LockStore } from "./domain/lock";
import { errorHandler, HttpError, type LogError, methodNotAllowed, route, routeNotFound } from "./http/errors";
import {
  createSchema,
  lockSchema,
  lockToken,
  parseBody,
  parseSearchQuery,
  parseStatus,
  patchSchema,
  requireJsonBody,
  revisionSchema,
} from "./http/validation";
import { DocumentService } from "./service/documents";
import { InMemoryLockStore } from "./store/memoryLocks";

export type AppOptions = {
  /** Called with errors that become a 500. Defaults to console.error. */
  logError?: LogError;
  /** Where edit locks live. Defaults to an in-memory store. */
  locks?: LockStore;
  /** How long a lock lasts without renewal. Defaults to 30 seconds. */
  lockTtlMs?: number;
};

/**
 * HTTP wiring only: each route parses the request, calls the service, and sends
 * the result. Errors thrown anywhere go to errorHandler.
 */
export function createApp(store: DocumentStore, options: AppOptions = {}): Express {
  const documents = new DocumentService(store, options.locks ?? new InMemoryLockStore(), options.lockTtlMs);
  const app = express();

  app.use(requireJsonBody);
  app.use(express.json({ limit: "2mb" }));

  app
    .route("/documents")
    .get(
      route(async (req, res) => {
        res.json({ documents: await documents.list(parseStatus(req)) });
      }),
    )
    .post(
      route(async (req, res) => {
        res.status(201).json(await documents.create(parseBody(createSchema, req)));
      }),
    )
    .all(methodNotAllowed("GET, POST"));

  // Registered before /documents/:id so "search" is not captured as an id.
  app
    .route("/documents/search")
    .get(
      route(async (req, res) => {
        res.json(await documents.search(parseSearchQuery(req)));
      }),
    )
    .all(methodNotAllowed("GET"));

  app
    .route("/documents/:id")
    .get(
      route(async (req, res) => {
        res.json(await documents.get(req.params.id));
      }),
    )
    .patch(
      route(async (req, res) => {
        res.json(await documents.patch(req.params.id, lockToken(req), parseBody(patchSchema, req)));
      }),
    )
    .all(methodNotAllowed("GET, PATCH"));

  app
    .route("/documents/:id/search")
    .get(
      route(async (req, res) => {
        res.json(await documents.searchOne(req.params.id, parseSearchQuery(req)));
      }),
    )
    .all(methodNotAllowed("GET"));

  // POST takes the lock, or renews it when sent with the current Lock-Token.
  app
    .route("/documents/:id/lock")
    .post(
      route(async (req, res) => {
        const { holder } = parseBody(lockSchema, req);
        res.json(await documents.lock(req.params.id, holder, lockToken(req)));
      }),
    )
    .delete(
      route(async (req, res) => {
        const token = lockToken(req);
        if (!token) {
          throw new HttpError(400, "Lock-Token header is required");
        }
        await documents.unlock(req.params.id, token);
        res.status(204).end();
      }),
    )
    .all(methodNotAllowed("POST, DELETE"));

  for (const [action, archived] of [
    ["archive", true],
    ["unarchive", false],
  ] as const) {
    app
      .route(`/documents/:id/${action}`)
      .post(
        route(async (req, res) => {
          // The body is optional here, so a bare POST with no JSON is fine.
          const { expectedRevision } = parseBody(revisionSchema, req, { optional: true });
          res.json(await documents.setArchived(req.params.id, archived, lockToken(req), expectedRevision));
        }),
      )
      .all(methodNotAllowed("POST"));
  }

  app.use(routeNotFound);
  app.use(errorHandler(options.logError));

  return app;
}
