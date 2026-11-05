import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentStore } from "./domain/document";
import { createApp } from "./server";
import { InMemoryDocumentStore } from "./store/memory";
import { InMemoryLockStore } from "./store/memoryLocks";

let server: Server | undefined;

const LOCK_TTL_MS = 30_000;

async function start(store: DocumentStore = new InMemoryDocumentStore(), logError = vi.fn()) {
  // A fake clock, so tests can expire locks without waiting.
  const clock = { now: Date.now() };
  const locks = new InMemoryLockStore(() => clock.now);
  server = createApp(store, { logError, locks, lockTtlMs: LOCK_TTL_MS }).listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    method: string,
    path: string,
    init: { json?: unknown; raw?: string; type?: string; token?: string } = {},
  ) {
    const body = init.raw ?? (init.json === undefined ? undefined : JSON.stringify(init.json));
    const headers: Record<string, string> = init.token ? { "Lock-Token": init.token } : {};
    if (body !== undefined) {
      headers["Content-Type"] = init.type ?? "application/json";
    }
    const response = await fetch(base + path, { method, headers, body });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  }

  async function create(title = "Doc") {
    const { body } = await call("POST", "/documents", { json: { title, body: "hello world", createdBy: "tester" } });
    return body as { id: string; revision: number };
  }

  async function lock(id: string, holder = "alice") {
    const response = await call("POST", `/documents/${id}/lock`, { json: { holder } });
    expect(response.status).toBe(200);
    return response.body.lockToken as string;
  }

  return { call, create, lock, clock, logError };
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe("malformed requests", () => {
  it("rejects a body that is not valid JSON", async () => {
    const { call } = await start();
    const response = await call("POST", "/documents", { raw: "{ title: " });
    expect(response).toMatchObject({ status: 400, body: { error: "request body is not valid JSON" } });
  });

  it("rejects a body that is not declared as JSON", async () => {
    const { call } = await start();
    const response = await call("POST", "/documents", { raw: "title=x", type: "application/x-www-form-urlencoded" });
    expect(response).toMatchObject({ status: 415, body: { error: "content type must be application/json" } });
  });

  it("rejects a request with no body where one is required", async () => {
    const { call, create } = await start();
    expect((await call("POST", "/documents")).body).toEqual({ error: "request body is required" });
    const { id } = await create();
    expect(await call("PATCH", `/documents/${id}`)).toMatchObject({ status: 400 });
  });

  it("rejects a body that is too large", async () => {
    const { call } = await start();
    const response = await call("POST", "/documents", { json: { title: "x", body: "a".repeat(3_000_000), createdBy: "t" } });
    expect(response.status).toBe(413);
  });

  it("names the field that failed validation", async () => {
    const { call } = await start();
    const response = await call("POST", "/documents", { json: { title: "  ", body: "", createdBy: "t" } });
    expect(response).toMatchObject({ status: 400, body: { error: "title: must not be empty" } });
  });

  it("rejects unknown fields instead of ignoring them", async () => {
    const { call, create } = await start();
    const { id } = await create();
    const response = await call("PATCH", `/documents/${id}`, {
      json: { change: [{ operation: "replace", range: { start: 0, end: 0 }, text: "x" }] },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("change");
  });

  it("rejects a patch with wrong types, a bad operation, or no changes", async () => {
    const { call, create } = await start();
    const { id } = await create();
    const cases = [
      { changes: [{ operation: "replace", range: { start: "0", end: 1 }, text: "x" }] },
      { changes: [{ operation: "delete", range: { start: 0, end: 1 }, text: "" }] },
      { changes: [] },
      { expectedRevision: "1", changes: [{ operation: "replace", range: { start: 0, end: 0 }, text: "" }] },
      [],
    ];
    for (const json of cases) {
      expect((await call("PATCH", `/documents/${id}`, { json })).status).toBe(400);
    }
    // Nothing was written.
    expect((await call("GET", `/documents/${id}`)).body.revision).toBe(1);
  });

  it("rejects bad query parameters", async () => {
    const { call } = await start();
    expect((await call("GET", "/documents/search")).body).toEqual({ error: "q is required" });
    expect((await call("GET", "/documents/search?q=a&limit=0")).status).toBe(400);
    expect((await call("GET", "/documents/search?q=a&limit=ten")).status).toBe(400);
    expect((await call("GET", "/documents/search?q=a&q=b")).body).toEqual({ error: "q must be given once" });
    expect((await call("GET", "/documents?status=deleted")).status).toBe(400);
    expect((await call("GET", "/documents?includeArchived=yes")).status).toBe(400);
  });
});

describe("missing documents and routes", () => {
  it.each([
    ["GET", "/documents/missing"],
    ["GET", "/documents/missing/search?q=a"],
    ["POST", "/documents/missing/archive"],
    ["POST", "/documents/missing/unarchive"],
  ])("%s %s is a 404", async (method, path) => {
    const { call } = await start();
    expect(await call(method, path)).toMatchObject({ status: 404, body: { error: "document not found" } });
  });

  it("is a 404 to patch a document that does not exist", async () => {
    const { call } = await start();
    const response = await call("PATCH", "/documents/missing", {
      json: { changes: [{ operation: "replace", range: { start: 0, end: 0 }, text: "x" }] },
    });
    expect(response).toMatchObject({ status: 404, body: { error: "document not found" } });
  });

  it("returns JSON for an unknown route", async () => {
    const { call } = await start();
    expect(await call("GET", "/nope")).toMatchObject({ status: 404, body: { error: "route not found" } });
  });

  it("returns 405 with an Allow header for an unsupported method", async () => {
    const { call, create } = await start();
    const { id } = await create();
    const response = await call("DELETE", `/documents/${id}`);
    expect(response).toMatchObject({ status: 405, body: { error: "method not allowed" } });
    expect(response.headers.get("allow")).toBe("GET, PATCH");
  });
});

describe("server errors", () => {
  it("returns a JSON 500 without leaking details when the store fails", async () => {
    const store = new InMemoryDocumentStore();
    vi.spyOn(store, "list").mockRejectedValue(new Error("connection refused: db.internal:5432"));
    const { call, logError } = await start(store);

    const response = await call("GET", "/documents");

    expect(response).toEqual(expect.objectContaining({ status: 500, body: { error: "internal server error" } }));
    expect(logError).toHaveBeenCalledOnce();
  });

  it("returns a 500 when a write fails", async () => {
    const store = new InMemoryDocumentStore();
    const { call, create, lock } = await start(store);
    const { id } = await create();
    const token = await lock(id);
    vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));

    const response = await call("PATCH", `/documents/${id}`, {
      token,
      json: { changes: [{ operation: "replace", range: { start: 0, end: 0 }, text: "x" }] },
    });

    expect(response).toMatchObject({ status: 500, body: { error: "internal server error" } });
  });
});

describe("well-formed requests still work", () => {
  it("patches and archives with or without a body", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const token = await lock(id);
    const patched = await call("PATCH", `/documents/${id}`, {
      token,
      json: { expectedRevision: 1, changes: [{ operation: "replace", range: { start: 0, end: 5 }, text: "goodbye" }] },
    });
    expect(patched).toMatchObject({ status: 200, body: { body: "goodbye world", revision: 2 } });
    expect((await call("POST", `/documents/${id}/archive`, { token })).status).toBe(200);
    expect((await call("POST", `/documents/${id}/unarchive`, { json: { expectedRevision: 3 } })).status).toBe(200);
  });

  it("reports the failing change index for an out-of-range patch", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const response = await call("PATCH", `/documents/${id}`, {
      token: await lock(id),
      json: { changes: [{ operation: "replace", range: { start: 0, end: 999 }, text: "" }] },
    });
    expect(response).toMatchObject({ status: 400, body: { error: "range is outside the document", index: 0 } });
  });
});

describe("edit locks", () => {
  const edit = { changes: [{ operation: "replace", range: { start: 0, end: 0 }, text: "x" }] };

  it("lets only the lock holder edit, and tells others who has it", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const token = await lock(id, "alice");

    expect((await call("PATCH", `/documents/${id}`, { token, json: edit })).status).toBe(200);

    const bob = await call("POST", `/documents/${id}/lock`, { json: { holder: "bob" } });
    expect(bob).toMatchObject({ status: 423, body: { error: "document is being edited by alice", lock: { holder: "alice" } } });
    expect(await call("PATCH", `/documents/${id}`, { json: edit })).toMatchObject({ status: 423 });
    expect(await call("PATCH", `/documents/${id}`, { token: "guess", json: edit })).toMatchObject({ status: 423 });
  });

  it("requires a lock to edit even when nobody else holds one", async () => {
    const { call, create } = await start();
    const { id } = await create();
    expect(await call("PATCH", `/documents/${id}`, { json: edit })).toMatchObject({
      status: 423,
      body: { error: "document lock is required to edit", lock: null },
    });
  });

  it("shows the holder but never the token on reads", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const token = await lock(id, "alice");
    const read = await call("GET", `/documents/${id}`);
    expect(read.body.lock).toEqual({ holder: "alice", expiresAt: expect.any(String) });
    expect(JSON.stringify(read.body)).not.toContain(token);
    expect((await call("GET", "/documents")).body.documents[0].lock.holder).toBe("alice");
  });

  it("renews with the same token and frees the document once it expires", async () => {
    const { call, create, lock, clock } = await start();
    const { id } = await create();
    const token = await lock(id, "alice");

    clock.now += LOCK_TTL_MS - 1_000;
    const renewed = await call("POST", `/documents/${id}/lock`, { token, json: { holder: "alice" } });
    expect(renewed).toMatchObject({ status: 200, body: { lockToken: token } });

    clock.now += LOCK_TTL_MS - 1_000; // Still inside the renewed lease.
    expect((await call("POST", `/documents/${id}/lock`, { json: { holder: "bob" } })).status).toBe(423);

    clock.now += 2_000; // Lease ran out without another renewal.
    expect((await call("GET", `/documents/${id}`)).body.lock).toBeNull();
    expect(await lock(id, "bob")).not.toBe(token);
    expect((await call("PATCH", `/documents/${id}`, { token, json: edit })).status).toBe(423);
  });

  it("extends the lease when the holder edits", async () => {
    const { call, create, lock, clock } = await start();
    const { id } = await create();
    const token = await lock(id);
    clock.now += LOCK_TTL_MS - 1_000;
    expect((await call("PATCH", `/documents/${id}`, { token, json: edit })).status).toBe(200);
    clock.now += LOCK_TTL_MS - 1_000;
    expect((await call("PATCH", `/documents/${id}`, { token, json: edit })).status).toBe(200);
  });

  it("releases the lock so someone else can take it", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const token = await lock(id, "alice");
    expect((await call("DELETE", `/documents/${id}/lock`, { token })).status).toBe(204);
    expect((await call("DELETE", `/documents/${id}/lock`, { token })).status).toBe(204); // Idempotent.
    await lock(id, "bob");
    expect((await call("DELETE", `/documents/${id}/lock`, { token })).status).toBe(423); // Bob's now.
    expect((await call("DELETE", `/documents/${id}/lock`)).status).toBe(400);
  });

  it("blocks archiving while someone else edits, and archiving ends the holder's lock", async () => {
    const { call, create, lock } = await start();
    const { id } = await create();
    const token = await lock(id, "alice");

    expect((await call("POST", `/documents/${id}/archive`)).status).toBe(423);
    expect((await call("POST", `/documents/${id}/archive`, { token })).status).toBe(200);
    expect((await call("GET", `/documents/${id}`)).body.lock).toBeNull();
    expect((await call("POST", `/documents/${id}/lock`, { json: { holder: "bob" } })).status).toBe(409);
  });

  it("validates the lock request", async () => {
    const { call, create } = await start();
    const { id } = await create();
    expect((await call("POST", `/documents/${id}/lock`, { json: {} })).status).toBe(400);
    expect((await call("POST", "/documents/missing/lock", { json: { holder: "a" } })).status).toBe(404);
  });
});
