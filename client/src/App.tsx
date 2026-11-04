import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Document, GlobalMatch, SearchResult, TextMatch } from "./api";

export function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [open, setOpen] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const refresh = useCallback(
    () => run(async () => setDocuments(await api.listDocuments(includeArchived))),
    [run, includeArchived],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the open document and the list in step after any write.
  const accept = useCallback(
    async (document: Document) => {
      setOpen(document);
      await refresh();
    },
    [refresh],
  );

  return (
    <main>
      <h1>Documents</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="layout">
        <aside>
          <DocumentList
            documents={documents}
            openId={open?.id}
            includeArchived={includeArchived}
            onToggleArchived={setIncludeArchived}
            onOpen={(id) => run(async () => setOpen(await api.getDocument(id)))}
          />
          <CreateForm onCreate={(input) => run(async () => accept(await api.createDocument(input)))} />
          <GlobalSearch
            includeArchived={includeArchived}
            run={run}
            onOpen={(id) => run(async () => setOpen(await api.getDocument(id)))}
          />
        </aside>
        <section>
          {open ? (
            <OpenDocument key={open.id} document={open} run={run} onSaved={accept} />
          ) : (
            <p className="muted">Open or create a document to edit it.</p>
          )}
        </section>
      </div>
    </main>
  );
}

type Run = (action: () => Promise<void>) => Promise<void>;

function DocumentList(props: {
  documents: Document[];
  openId?: string;
  includeArchived: boolean;
  onToggleArchived: (value: boolean) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="panel">
      <h2>All documents</h2>
      <label className="inline">
        <input
          type="checkbox"
          checked={props.includeArchived}
          onChange={(event) => props.onToggleArchived(event.target.checked)}
        />
        Include archived
      </label>
      {props.documents.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <ul className="list">
          {props.documents.map((document) => (
            <li key={document.id}>
              <button
                type="button"
                className={document.id === props.openId ? "link active" : "link"}
                onClick={() => props.onOpen(document.id)}
              >
                {document.title}
              </button>
              {document.archivedAt && <span className="tag">archived</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm(props: { onCreate: (input: { title: string; body: string }) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.onCreate({ title, body });
    setTitle("");
    setBody("");
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>New document</h2>
      <input placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea placeholder="Body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="submit">Create</button>
    </form>
  );
}

function GlobalSearch(props: { includeArchived: boolean; run: Run; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult<GlobalMatch> | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    void props.run(async () => setResult(await api.searchDocuments(q, props.includeArchived)));
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Search all documents</h2>
      <div className="row">
        <input placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} />
        <button type="submit">Search</button>
      </div>
      {result && (
        <>
          <p className="muted">
            {result.total} matching document{result.total === 1 ? "" : "s"}
          </p>
          <ul className="list">
            {result.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="link" onClick={() => props.onOpen(item.id)}>
                  {item.title}
                </button>
                <span className="muted"> ({item.matchCount})</span>
                <div className="snippet">{item.snippet}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </form>
  );
}

function OpenDocument(props: { document: Document; run: Run; onSaved: (document: Document) => Promise<void> }) {
  const { document, run, onSaved } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [replacement, setReplacement] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchResult<TextMatch> | null>(null);
  const archived = document.archivedAt !== null;

  // The body changed on the server, so old hit ranges no longer line up.
  useEffect(() => {
    setHits(null);
  }, [document.version]);

  function readSelection() {
    const element = textarea.current;
    if (element) {
      setSelection({ start: element.selectionStart, end: element.selectionEnd });
    }
  }

  function select(start: number, end: number) {
    const element = textarea.current;
    if (element) {
      element.focus();
      element.setSelectionRange(start, end);
    }
    setSelection({ start, end });
  }

  function replace(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const saved = await api.patchDocument(document.id, document.version, [
        { operation: "replace", range: selection, text: replacement },
      ]);
      setReplacement("");
      setSelection({ start: 0, end: 0 });
      await onSaved(saved);
    });
  }

  function toggleArchive() {
    void run(async () => onSaved(await api.setArchived(document.id, !archived, document.version)));
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void run(async () => setHits(await api.searchDocument(document.id, q)));
  }

  return (
    <div className="panel">
      <div className="row spread">
        <h2>{document.title}</h2>
        <button type="button" onClick={toggleArchive}>
          {archived ? "Unarchive" : "Archive"}
        </button>
      </div>
      <p className="muted">
        Version {document.version} · updated {new Date(document.updatedAt).toLocaleString()}
        {archived && " · archived (read only until unarchived)"}
      </p>

      {/* Read only: edits go through PATCH so the server body stays the source of truth. */}
      <textarea
        ref={textarea}
        className="body"
        rows={14}
        readOnly
        value={document.body}
        onSelect={readSelection}
      />

      <form onSubmit={replace}>
        <p className="muted">
          {selection.start === selection.end
            ? `Insert at ${selection.start}`
            : `Replace ${selection.start}–${selection.end}`}
        </p>
        <div className="row">
          <input
            placeholder="Replacement text (empty deletes the selection)"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            disabled={archived}
          />
          <button type="submit" disabled={archived}>
            Apply
          </button>
        </div>
      </form>

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
  );
}
