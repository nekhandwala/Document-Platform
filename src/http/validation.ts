import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { MAX_BODY_LENGTH, MAX_CHANGES } from "../domain/patch";
import { STATUSES, type Status } from "../service/documents";
import { HttpError } from "./errors";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Request schemas are strict, so a typo like `change` instead of `changes` is a
// 400 rather than a silently ignored field.
export const createSchema = z
  .object({
    title: z.string({ required_error: "is required" }).trim().min(1, "must not be empty"),
    body: z.string({ required_error: "is required" }).max(MAX_BODY_LENGTH, `must be at most ${MAX_BODY_LENGTH} characters`),
    createdBy: z.string({ required_error: "is required" }).trim().min(1, "must not be empty"),
  })
  .strict();

const expectedRevision = z.number().int().positive().optional();

export const patchSchema = z
  .object({
    expectedRevision,
    changes: z
      .array(
        z
          .object({
            operation: z.literal("replace"),
            range: z.object({ start: z.number().int(), end: z.number().int() }).strict(),
            text: z.string(),
          })
          .strict(),
        { required_error: "is required" },
      )
      .min(1, "must not be empty")
      .max(MAX_CHANGES, `must have at most ${MAX_CHANGES} changes`),
  })
  .strict();

export const revisionSchema = z.object({ expectedRevision }).strict();

export const lockSchema = z
  .object({
    holder: z.string({ required_error: "is required" }).trim().min(1, "must not be empty").max(100, "must be at most 100 characters"),
  })
  .strict();

/** The edit lock token, sent as a `Lock-Token` header on writes. */
export function lockToken(req: Request): string | undefined {
  const value = req.headers["lock-token"];
  if (Array.isArray(value)) {
    throw new HttpError(400, "Lock-Token must be given once");
  }
  return value === undefined || value === "" ? undefined : value;
}

/** Middleware: a request that carries a body must declare it as JSON. Bodyless requests pass through. */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction) {
  if (hasBody(req) && !req.is("application/json")) {
    next(new HttpError(415, "content type must be application/json"));
    return;
  }
  next();
}

/**
 * Validate the JSON body. express.json() leaves `req.body` as `{}` when there is
 * no body, so check the request itself to tell "no body" from "empty object".
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
  options: { optional?: boolean } = {},
): z.infer<T> {
  if (!hasBody(req) && !options.optional) {
    throw new HttpError(400, "request body is required");
  }
  const parsed = schema.safeParse(hasBody(req) ? req.body : {});
  if (!parsed.success) {
    throw new HttpError(400, zodMessage(parsed.error));
  }
  return parsed.data;
}

export function parseSearchQuery(req: Request): { q: string; limit: number; status: Status } {
  const q = singleQueryValue(req, "q");
  if (q === undefined || q.trim().length === 0) {
    throw new HttpError(400, "q is required");
  }
  return { q, limit: parseLimit(req), status: parseStatus(req) };
}

// `includeArchived=true` is the original flag and still means "all".
export function parseStatus(req: Request): Status {
  const value = singleQueryValue(req, "status");
  if (value === undefined) {
    const includeArchived = singleQueryValue(req, "includeArchived");
    if (includeArchived !== undefined && includeArchived !== "true" && includeArchived !== "false") {
      throw new HttpError(400, "includeArchived must be true or false");
    }
    return includeArchived === "true" ? "all" : "active";
  }
  const status = STATUSES.find((candidate) => candidate === value);
  if (!status) {
    throw new HttpError(400, "status must be active, archived, or all");
  }
  return status;
}

function parseLimit(req: Request): number {
  const value = singleQueryValue(req, "limit");
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new HttpError(400, "limit must be a positive integer");
  }
  return Math.min(Number(value), MAX_LIMIT);
}

function hasBody(req: Request): boolean {
  return req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0;
}

/** Read a query parameter that may appear at most once, as a plain string. */
function singleQueryValue(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined || typeof value === "string") {
    return value;
  }
  throw new HttpError(400, `${name} must be given once`);
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}
