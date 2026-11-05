import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Document, GlobalMatch, SearchResult, Status, TextMatch } from "./api";
import { diffToChange } from "./diff";

type Run = (action: () => Promise<void>) => Promise<void>;

export function App() {
  const [open, setOpen] = useState<Document | null>(null);
  const [tab, setTab] = useState<Status>("active");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useEditorName();

  const run = useCallback<Run>(async (action) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const openById = (id: string) => run(async () => setOpen(await api.getDocument(id)));

  return (
    <main>
      <div className="row topbar">
        <NameField name={name} onChange={setName} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open ? (
        <OpenDocument key={open.id} document={open} name={name} run={run} onBack={() => setOpen(null)} />
      ) : (
        <DocumentsPage tab={tab} onTab={setTab} name={name} run={run} onOpen={openById} onCreated={setOpen} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Who you are. There are no accounts yet, so this is a name kept in the browser.

const NAME_KEY = "document-service:name";

function useEditorName(): [string, (name: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const update = useCallback((next: string) => {
    setName(next);
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the name still works for this visit.
    }
  }, []);
  return [name, update];
}

/** Commits on blur or Enter, so typing a name does not take and drop locks per keystroke. */
function NameField(props: { name: string; onChange: (name: string) => void }) {
  const [value, setValue] = useState(props.name);
  const commit = () => {
    const trimmed = value.trim();
    setValue(trimmed);
    if (trimmed !== props.name) {
      props.onChange(trimmed);
    }
  };
  return (
    <label className="inline name-field">
      <span className="muted">Your name</span>
      <input
        value={value}
        placeholder="Needed to create or edit"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Document list

const TABS: { status: Status; label: string }[] = [
  { status: "active", label: "Active" },
  { status: "archived", label: "Archived" },
];

function DocumentsPage(props: {
  tab: Status;
  onTab: (tab: Status) => void;
  name: string;
  run: Run;
  onOpen: (id: string) => void;
  onCreated: (document: Document) => void;
}) {
  const { tab, onTab, run, onOpen, onCreated } = props;
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult<GlobalMatch> | null>(null);

  useEffect(() => {
    setDocuments(null);
    void run(async () => setDocuments(await api.listDocuments(tab)));
  }, [run, tab]);

  // Search runs within the selected tab, so rerun it when the tab changes.
  const [submitted, setSubmitted] = useState<string | null>(null);
  useEffect(() => {
    if (submitted === null) {
      setResults(null);
      return;
    }
    void run(async () => setResults(await api.searchDocuments(submitted, tab)));
  }, [run, tab, submitted]);

  function search(event: FormEvent) {
    event.preventDefault();
    setSubmitted(q);
  }

  return (
    <>
      <header className="row spread">
        <h1>Documents</h1>
        <div className="row">
          <form className="row" onSubmit={search}>
            <input placeholder="Search documents" value={q} onChange={(event) => setQ(event.target.value)} />
            <button type="submit">Search</button>
          </form>
          <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>
            New document
          </button>
        </div>
      </header>

      {creating && (
        <CreateForm
          name={props.name}
          onCancel={() => setCreating(false)}
          onCreate={(input) => run(async () => onCreated(await api.createDocument(input)))}
        />
      )}

      {results && (
        <div className="panel">
          <div className="row spread">
            <h2>
              {results.total} matching document{results.total === 1 ? "" : "s"}
            </h2>
            <button type="button" onClick={() => setSubmitted(null)}>
              Clear
            </button>
          </div>
          <ul className="list">
            {results.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="link" onClick={() => onOpen(item.id)}>
                  {item.title}
                </button>
                <span className="muted"> ({item.matchCount})</span>
                <div className="snippet">{item.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={tab === status ? "tab active" : "tab"}
            onClick={() => onTab(status)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel table-wrap" role="tabpanel">
        {documents === null ? (
          <p className="muted">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="muted">{tab === "active" ? "No active documents." : "No archived documents."}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Last updated</th>
                <th>Created by</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className="clickable" onClick={() => onOpen(document.id)}>
                  <td>
                    <button type="button" className="link">
                      {document.title}
                    </button>
                    {document.lock && <span className="tag">{document.lock.holder} is editing</span>}
                  </td>
                  <td>{formatDate(document.updatedAt)}</td>
                  <td>{document.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CreateForm(props: {
  name: string;
  onCreate: (input: { title: string; body: string; createdBy: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    void props.onCreate({ title, body, createdBy: props.name });
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>New document</h2>
      <input placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea placeholder="Body" rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="row">
        <button type="submit" className="primary" disabled={!props.name}>
          Create
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        {!props.name && <span className="muted">Enter your name at the top first.</span>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit lock

/** Renew well inside the server's 30 second lease. */
const LOCK_RENEW_MS = 10_000;
/** How often to try again while someone else holds the lock. */
const LOCK_RETRY_MS = 5_000;

type LockState =
  | { kind: "acquiring" }
  | { kind: "mine" }
  | { kind: "theirs"; holder: string }
  | { kind: "unavailable"; reason: string };

/**
 * Hold the edit lock for a document while this component is mounted: take it,
 * renew it, retry while someone else has it, and release it on unmount or when
 * the page closes.
 *
 * `onAcquired` runs before the lock is reported as ours, so the caller can load
 * the latest body before the textarea becomes editable.
 */
function useEditLock(
  id: string,
  name: string,
  disabledReason: string | null,
  events: { onAcquired: () => Promise<void>; onWaiting: (lostOurs: boolean) => void },
) {
  const [state, setState] = useState<LockState>({ kind: "acquiring" });
  const tokenRef = useRef<string | undefined>(undefined);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // Each run waits for the previous run to finish releasing, so a quick remount
  // (React StrictMode does this in development) does not race itself for the lock.
  const previousRun = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (disabledReason) {
      setState({ kind: "unavailable", reason: disabledReason });
      return;
    }
    setState({ kind: "acquiring" });
    let cancelled = false;
    let token: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chain = previousRun.current;

    const attempt = async () => {
      if (cancelled) {
        return;
      }
      const held = token;
      try {
        const result = await api.acquireLock(id, name, held);
        token = result.lockToken;
        if (cancelled) {
          return; // Cleanup releases it once this chain settles.
        }
        if (!held) {
          await eventsRef.current.onAcquired();
          if (cancelled) {
            return;
          }
        }
        tokenRef.current = token;
        setState({ kind: "mine" });
        timer = setTimeout(schedule, LOCK_RENEW_MS);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        token = undefined;
        tokenRef.current = undefined;
        if (caught instanceof api.ApiError && caught.status === 423) {
          setState({ kind: "theirs", holder: caught.body.lock?.holder ?? "Someone else" });
        } else {
          setState({ kind: "unavailable", reason: caught instanceof Error ? caught.message : String(caught) });
        }
        eventsRef.current.onWaiting(held !== undefined);
        timer = setTimeout(schedule, LOCK_RETRY_MS);
      }
    };
    const schedule = () => {
      chain = chain.then(attempt);
    };

    const releaseOnClose = () => {
      if (token) {
        void api.releaseLock(id, token, true).catch(() => {});
      }
    };
    window.addEventListener("pagehide", releaseOnClose);
    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", releaseOnClose);
      tokenRef.current = undefined;
      previousRun.current = chain.then(async () => {
        if (token) {
          await api.releaseLock(id, token, true).catch(() => {});
        }
      });
    };
  }, [id, name, disabledReason]);

  return { state, tokenRef };
}

// ---------------------------------------------------------------------------
// Open document

const AUTOSAVE_DELAY_MS = 600;

type SaveState = { kind: "saved" } | { kind: "dirty" } | { kind: "saving" } | { kind: "failed"; error: string };

function OpenDocument(props: { document: Document; name: string; run: Run; onBack: () => void }) {
  const { run } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  // `server` is the last body the API confirmed. Each save diffs the draft against it.
  const [server, setServer] = useState(props.document);
  const [draft, setDraft] = useState(props.document.body);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchResult<TextMatch> | null>(null);
  const archived = server.archivedAt !== null;

  // Async work reads these so it always sees the latest values, not a stale render.
  const serverRef = useRef(server);
  const draftRef = useRef(draft);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const accept = useCallback((document: Document) => {
    serverRef.current = document;
    setServer(document);
  }, []);

  const replaceDraft = useCallback((body: string) => {
    draftRef.current = body;
    setDraft(body);
    setHits(null);
  }, []);

  /** Load the latest copy, unless that would throw away unsaved typing. */
  const refreshIfClean = useCallback(async () => {
    const latest = await api.getDocument(serverRef.current.id).catch(() => null);
    if (latest && draftRef.current === serverRef.current.body) {
      accept(latest);
      replaceDraft(latest.body);
    }
  }, [accept, replaceDraft]);

  const disabledReason = archived ? "archived" : props.name ? null : "Enter your name at the top to edit.";
  const lock = useEditLock(server.id, props.name, disabledReason, {
    onAcquired: refreshIfClean,
    onWaiting: (lostOurs) => {
      if (lostOurs && draftRef.current !== serverRef.current.body) {
        setSaveState({ kind: "failed", error: "you lost edit access before these changes were saved" });
        return;
      }
      void refreshIfClean(); // Show the other editor's progress while waiting.
    },
  });
  const canEdit = lock.state.kind === "mine";

  const save = useCallback((): Promise<void> => {
    if (inflight.current) {
      // Let the current request finish, then save whatever was typed during it.
      return inflight.current.then(save);
    }
    const base = serverRef.current;
    const token = lock.tokenRef.current;
    const change = diffToChange(base.body, draftRef.current);
    if (!change || !token) {
      if (!change) {
        setSaveState({ kind: "saved" });
      }
      return Promise.resolve();
    }
    setSaveState({ kind: "saving" });
    const request = api
      .patchDocument(base.id, token, base.revision, [change])
      .then((saved) => {
        accept(saved);
        setSaveState(draftRef.current === saved.body ? { kind: "saved" } : { kind: "dirty" });
      })
      .catch((caught: unknown) => {
        setSaveState({ kind: "failed", error: caught instanceof Error ? caught.message : String(caught) });
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = request;
    return request;
  }, [accept, lock.tokenRef]);

  // Autosave once typing pauses. A failed save waits for the next edit.
  useEffect(() => {
    if (!canEdit || draft === server.body || saveState.kind === "failed") {
      return;
    }
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [canEdit, draft, server.body, saveState.kind, save]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (lock.tokenRef.current) {
      await save();
    }
  }, [lock.tokenRef, save]);

  function edit(value: string) {
    draftRef.current = value;
    setDraft(value);
    setHits(null); // Hit ranges point into the old body.
    if (saveState.kind !== "saving") {
      setSaveState({ kind: "dirty" });
    }
  }

  function reload() {
    void run(async () => {
      const latest = await api.getDocument(server.id);
      accept(latest);
      replaceDraft(latest.body);
      setSaveState({ kind: "saved" });
    });
  }

  function select(start: number, end: number) {
    const element = textarea.current;
    if (element) {
      element.focus();
      element.setSelectionRange(start, end);
    }
  }

  function toggleArchive() {
    void run(async () => {
      await flush();
      accept(await api.setArchived(server.id, !archived, lock.tokenRef.current));
    });
  }

  function back() {
    void flush().then(props.onBack);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await flush();
      setHits(await api.searchDocument(server.id, q));
    });
  }

  return (
    <>
      <button type="button" className="link back" onClick={back}>
        ← All documents
      </button>
      <div className="panel">
        <div className="row spread">
          <h1>{server.title}</h1>
          <button
            type="button"
            onClick={toggleArchive}
            disabled={lock.state.kind === "theirs"}
            title={lock.state.kind === "theirs" ? "Can't archive while someone else is editing" : undefined}
          >
            {archived ? "Unarchive" : "Archive"}
          </button>
        </div>
        <div className="row spread">
          <p className="muted">
            Created by {server.createdBy} · updated {formatDate(server.updatedAt)}
          </p>
          {canEdit ? (
            <SaveStatus state={saveState} onReload={reload} />
          ) : (
            <LockStatus state={lock.state} archived={archived} />
          )}
        </div>

        <textarea
          ref={textarea}
          className={canEdit ? "body" : "body readonly"}
          rows={18}
          readOnly={!canEdit}
          value={draft}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void flush();
            }
          }}
        />

        <form onSubmit={search}>
          <h3>Search this document</h3>
          <div className="row">
            <input placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} />
            <button type="submit">Search</button>
          </div>
        </form>
        {hits && (
          <>
            <p className="muted">
              {hits.total} match{hits.total === 1 ? "" : "es"}
              {hits.items.length < hits.total && `, showing first ${hits.items.length}`}
            </p>
            <ul className="list">
              {hits.items.map((hit) => (
                <li key={hit.start}>
                  <button type="button" className="link" onClick={() => select(hit.start, hit.end)}>
                    {hit.start}–{hit.end}
                  </button>{" "}
                  <code>{hit.text}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function LockStatus(props: { state: LockState; archived: boolean }) {
  const { state } = props;
  if (props.archived) {
    return <p className="save-status muted">Archived · read only until unarchived</p>;
  }
  switch (state.kind) {
    case "acquiring":
      return <p className="save-status muted">Opening for editing…</p>;
    case "theirs":
      return (
        <p className="save-status locked">
          {state.holder} is editing · read only until they're done
        </p>
      );
    case "unavailable":
      return <p className="save-status muted">{state.reason}</p>;
    case "mine":
      return null;
  }
}

function SaveStatus(props: { state: SaveState; onReload: () => void }) {
  const { state } = props;
  if (state.kind === "failed") {
    return (
      <p className="save-status failed" role="alert">
        Not saved: {state.error}.{" "}
        <button type="button" className="link" onClick={props.onReload}>
          Reload latest (discards unsaved changes)
        </button>
      </p>
    );
  }
  const label = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…" }[state.kind];
  return <p className="save-status muted">{label}</p>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
