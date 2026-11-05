export type LockInfo = { holder: string; expiresAt: string };

export type Document = {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Who is editing the document right now, if anyone. */
  lock: LockInfo | null;
};

export type RangeReplace = {
  operation: "replace";
  range: { start: number; end: number };
  text: string;
};

export type GlobalMatch = {
  id: string;
  title: string;
  matchCount: number;
  snippet: string;
};

export type TextMatch = {
  start: number;
  end: number;
  text: string;
};

export type SearchResult<T> = { total: number; items: T[] };

export type Status = "active" | "archived";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The full error body, e.g. `index` for a bad patch or `lock` for a 423. */
    readonly body: { index?: number; lock?: LockInfo | null } = {},
  ) {
    super(message);
  }
}

type Options = { method?: string; json?: unknown; lockToken?: string; keepalive?: boolean };

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.lockToken) {
    headers["Lock-Token"] = options.lockToken;
  }
  const response = await fetch(path, {
    method: options.method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    keepalive: options.keepalive,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data ?? {}) as { error?: string; index?: number; lock?: LockInfo | null };
    throw new ApiError(error.error ?? `request failed (${response.status})`, response.status, error);
  }
  return data as T;
}

const doc = (id: string) => `/documents/${encodeURIComponent(id)}`;

export function listDocuments(status: Status): Promise<Document[]> {
  const params = new URLSearchParams({ status });
  return request<{ documents: Document[] }>(`/documents?${params}`).then((result) => result.documents);
}

export function getDocument(id: string): Promise<Document> {
  return request(doc(id));
}

export function createDocument(input: { title: string; body: string; createdBy: string }): Promise<Document> {
  return request("/documents", { method: "POST", json: input });
}

/** Take the edit lock, or renew it by passing the token you already hold. */
export function acquireLock(id: string, holder: string, lockToken?: string): Promise<{ lockToken: string; lock: LockInfo }> {
  return request(`${doc(id)}/lock`, { method: "POST", json: { holder }, lockToken });
}

/** `keepalive` lets the request finish while the page is closing. */
export function releaseLock(id: string, lockToken: string, keepalive = false): Promise<void> {
  return request(`${doc(id)}/lock`, { method: "DELETE", lockToken, keepalive });
}

/**
 * `expectedRevision` is the revision the change was computed against. With the
 * lock held it always matches; it guards against editing from a stale body.
 */
export function patchDocument(
  id: string,
  lockToken: string,
  expectedRevision: number,
  changes: RangeReplace[],
): Promise<Document> {
  return request(doc(id), { method: "PATCH", json: { expectedRevision, changes }, lockToken });
}

export function setArchived(id: string, archived: boolean, lockToken?: string): Promise<Document> {
  return request(`${doc(id)}/${archived ? "archive" : "unarchive"}`, { method: "POST", lockToken });
}

export function searchDocuments(q: string, status: Status): Promise<SearchResult<GlobalMatch>> {
  const params = new URLSearchParams({ q, status });
  return request(`/documents/search?${params}`);
}

export function searchDocument(id: string, q: string): Promise<SearchResult<TextMatch>> {
  const params = new URLSearchParams({ q });
  return request(`${doc(id)}/search?${params}`);
}
