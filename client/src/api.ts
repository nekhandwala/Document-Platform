export type Document = {
  id: string;
  title: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly index?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as { error?: string; index?: number } | null;
    throw new ApiError(error?.error ?? `request failed (${response.status})`, response.status, error?.index);
  }
  return data as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export function listDocuments(includeArchived: boolean): Promise<Document[]> {
  const query = includeArchived ? "?includeArchived=true" : "";
  return request<{ documents: Document[] }>(`/documents${query}`).then((result) => result.documents);
}

export function getDocument(id: string): Promise<Document> {
  return request(`/documents/${encodeURIComponent(id)}`);
}

export function createDocument(input: { title: string; body: string }): Promise<Document> {
  return request("/documents", json("POST", input));
}

export function patchDocument(id: string, expectedVersion: number, changes: RangeReplace[]): Promise<Document> {
  return request(`/documents/${encodeURIComponent(id)}`, json("PATCH", { expectedVersion, changes }));
}

export function setArchived(id: string, archived: boolean, expectedVersion: number): Promise<Document> {
  const action = archived ? "archive" : "unarchive";
  return request(`/documents/${encodeURIComponent(id)}/${action}`, json("POST", { expectedVersion }));
}

export function searchDocuments(q: string, includeArchived: boolean): Promise<SearchResult<GlobalMatch>> {
  const params = new URLSearchParams({ q });
  if (includeArchived) {
    params.set("includeArchived", "true");
  }
  return request(`/documents/search?${params}`);
}

export function searchDocument(id: string, q: string): Promise<SearchResult<TextMatch>> {
  const params = new URLSearchParams({ q });
  return request(`/documents/${encodeURIComponent(id)}/search?${params}`);
}
