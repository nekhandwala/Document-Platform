import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { type DocumentStore, type StoreResult } from "./domain/document";
import { applyChanges, MAX_BODY_LENGTH, MAX_CHANGES } from "./domain/patch";
import { searchBody, searchDocuments } from "./domain/search";

const createSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  body: z.string().max(MAX_BODY_LENGTH, "body is too long"),
});

const patchSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  changes: z
    .array(
      z.object({
        operation: z.literal("replace"),
        range: z.object({
          start: z.number().int(),
          end: z.number().int(),
        }),
        text: z.string(),
      }),
    )
    .max(MAX_CHANGES, "too many changes"),
});

const versionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function createApp(store: DocumentStore): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Registered before /documents/:id so "search" is not captured as an id.
  app.get("/documents/search", async (req, res) => {
    const parsed = parseSearchQuery(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const documents = (await store.list()).filter(
      (document) => parsed.includeArchived || document.archivedAt === null,
    );
    res.json(searchDocuments(documents, parsed.q, parsed.limit));
  });

  app.get("/documents", async (req, res) => {
    const includeArchived = queryFlag(req.query.includeArchived);
    const documents = (await store.list()).filter(
      (document) => includeArchived || document.archivedAt === null,
    );
    res.json({ documents });
  });

  app.post("/documents", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    const document = await store.create(parsed.data);
    res.status(201).json(document);
  });

  app.get("/documents/:id/search", async (req, res) => {
    const parsed = parseSearchQuery(req);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const document = await store.get(req.params.id);
    if (!document) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    res.json(searchBody(document.body, parsed.q, parsed.limit));
  });

  app.get("/documents/:id", async (req, res) => {
    const document = await store.get(req.params.id);
    if (!document) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    res.json(document);
  });

  app.patch("/documents/:id", async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }
    const current = await store.get(req.params.id);
    if (!current) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    if (parsed.data.expectedVersion !== undefined && parsed.data.expectedVersion !== current.version) {
      res.status(409).json({ error: "version conflict" });
      return;
    }
    if (current.archivedAt !== null) {
      res.status(409).json({ error: "document is archived" });
      return;
    }
    const applied = applyChanges(current.body, parsed.data.changes);
    if (!applied.ok) {
      const body = applied.index === undefined ? { error: applied.error } : { error: applied.error, index: applied.index };
      res.status(400).json(body);
      return;
    }
    const saved = await store.save(req.params.id, {
      body: applied.body,
      expectedVersion: current.version,
    });
    if (saved === "conflict") {
      const latest = await store.get(req.params.id);
      res.status(409).json({ error: latest?.archivedAt ? "document is archived" : "version conflict" });
      return;
    }
    sendStoreResult(res, saved);
  });

  app.post("/documents/:id/archive", async (req, res) => {
    await changeArchive(store, req, res, new Date().toISOString());
  });

  app.post("/documents/:id/unarchive", async (req, res) => {
    await changeArchive(store, req, res, null);
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "invalid JSON" });
      return;
    }
    next(error);
  });

  return app;
}

async function changeArchive(store: DocumentStore, req: Request, res: Response, archivedAt: string | null) {
  const parsed = versionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const saved = await store.setArchived(req.params.id, archivedAt, parsed.data.expectedVersion);
  if (saved === "conflict") {
    res.status(409).json({ error: "version conflict" });
    return;
  }
  sendStoreResult(res, saved);
}

function sendStoreResult(res: Response, result: StoreResult) {
  if (result === "not_found") {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (result === "conflict") {
    res.status(409).json({ error: "version conflict" });
    return;
  }
  res.json(result);
}

function parseSearchQuery(
  req: Request,
): { ok: true; q: string; limit: number; includeArchived: boolean } | { ok: false; error: string } {
  const q = queryString(req.query.q);
  if (!q || q.trim().length === 0) {
    return { ok: false, error: "q is required" };
  }
  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    return { ok: false, error: "limit must be a positive integer" };
  }
  return { ok: true, q, limit, includeArchived: queryFlag(req.query.includeArchived) };
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (parsed < 1) {
    return null;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function queryFlag(value: unknown): boolean {
  return value === "true";
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
