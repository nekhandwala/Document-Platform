import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { DocumentConflictError, DocumentLockedError, DocumentNotFoundError, InvalidPatchError } from "../domain/errors";

/**
 * An expected failure with a status and message that are safe to send to the
 * client. `details` are extra fields merged into the JSON body, like `index`.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type LogError = (error: unknown, req: Request) => void;

export const defaultLogError: LogError = (error, req) => {
  console.error(`${req.method} ${req.originalUrl} failed`, error);
};

/** Forward rejected promises to the error handler. Express 4 does not do this for async handlers. */
export function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Respond 405 for any method a route does not define. `allow` becomes the Allow header. */
export function methodNotAllowed(allow: string): RequestHandler {
  return (_req, res) => {
    res.set("Allow", allow).status(405).json({ error: "method not allowed" });
  };
}

/** Register last among routes: anything that reaches it matched no path. */
export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "route not found"));
};

/**
 * Register after every route. Known failures become their status; anything else
 * is logged and becomes a 500 that does not reveal the cause.
 */
export function errorHandler(logError: LogError = defaultLogError): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const known = toHttpError(error);
    if (known) {
      res.status(known.status).json({ error: known.message, ...known.details });
      return;
    }
    logError(error, req);
    res.status(500).json({ error: "internal server error" });
  };
}

/** Map errors from our code, the service layer and express.json() to client-facing errors. */
function toHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof DocumentNotFoundError) {
    return new HttpError(404, error.message);
  }
  if (error instanceof DocumentConflictError) {
    return new HttpError(409, error.message);
  }
  if (error instanceof InvalidPatchError) {
    return new HttpError(400, error.message, error.index === undefined ? {} : { index: error.index });
  }
  if (error instanceof DocumentLockedError) {
    return new HttpError(423, error.message, { lock: error.lock });
  }
  switch ((error as { type?: unknown } | null)?.type) {
    case "entity.parse.failed":
      return new HttpError(400, "request body is not valid JSON");
    case "entity.too.large":
      return new HttpError(413, "request body is too large");
    case "encoding.unsupported":
    case "charset.unsupported":
      return new HttpError(415, "request body must be UTF-8 JSON");
    case "request.aborted":
      return new HttpError(400, "request was aborted");
    default:
      return null;
  }
}
