import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, FileText, LoaderCircle, Plus, Search, Trash2, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const formatSize = (bytes = 0) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export function Library() {
  const [items, setItems] = useState([]); const [cursor, setCursor] = useState(null); const [nextCursor, setNextCursor] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [deleting, setDeleting] = useState(new Set()); const [query, setQuery] = useState(""); const input = useRef(null);
  async function load(next = null, append = false) { setBusy(true); setError(""); try { const data = await api(`/documents?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ""}`); setItems((current) => append ? [...current, ...(data.items || [])] : data.items || []); setNextCursor(data.nextCursor || null); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  useEffect(() => { load(); }, []);
  async function upload(file) { if (!file) return; const form = new FormData(); form.append("file", file); setBusy(true); setError(""); try { await api("/documents", { method: "POST", body: form }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); if (input.current) input.current.value = ""; } }
  async function remove(doc) {
    if (!window.confirm(`Permanently delete “${doc.originalName}” and its stored text and search vectors?`)) return;
    setError(""); setNotice(""); setDeleting((current) => new Set(current).add(doc.id));
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const result = await api(`/documents/${doc.id}`);
          if (result.document.status === "failed") throw new Error("Deletion could not be completed. Please try again.");
        } catch (e) {
          if (e.status === 404) { setItems((current) => current.filter((item) => item.id !== doc.id)); setNotice(`“${doc.originalName}” was deleted.`); return; }
          throw e;
        }
      }
      throw new Error("Deletion is taking longer than expected. Your document is still being cleaned up; refresh the library to check its status.");
    } catch (e) { setError(e.message); }
    finally { setDeleting((current) => { const next = new Set(current); next.delete(doc.id); return next; }); }
  }
  const shown = items.filter((doc) => doc.originalName.toLowerCase().includes(query.toLowerCase()));
  return <div className="library-page"><div className="page-intro"><div><span className="eyebrow">YOUR SOURCE MATERIAL</span><h1>Your library</h1><p>A private home for the documents you want to think with.</p></div><button className="button-primary" onClick={() => input.current?.click()}><Plus size={16}/> Add documents</button><input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => upload(e.target.files?.[0])}/></div>
    <div className="library-toolbar"><div className="library-count"><strong>{items.length}</strong> {items.length === 1 ? "document" : "documents"}<span>·</span> PDF only</div><label className="search-field"><Search size={16}/><input placeholder="Find a document" value={query} onChange={(e) => setQuery(e.target.value)}/></label></div>
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-success" role="status">{notice}</div>}
    {busy && !items.length ? <div className="loading-state"><LoaderCircle className="spin"/> Loading your library…</div> : shown.length ? <div className="document-table"><div className="table-head"><span>DOCUMENT</span><span>STATUS</span><span>ADDED</span><span>SIZE</span><span/></div>{shown.map((doc) => <article className="document-row" key={doc.id}><div className="document-main"><div className="pdf-icon large-pdf">PDF</div><div><strong>{doc.originalName}</strong><small>{doc.pageCount ? `${doc.pageCount} pages` : "Page count pending"}</small></div></div><div><span className={`status-pill status-${doc.status}`}>{doc.status === "ready" && <i/>}{deleting.has(doc.id) ? "deleting…" : doc.status}</span></div><span className="table-date">{new Date(doc.createdAt).toLocaleDateString()}</span><span className="table-size">{formatSize(doc.sizeBytes)}</span><div className="row-actions"><button title="Delete document" aria-label={`Delete ${doc.originalName}`} disabled={deleting.has(doc.id)} onClick={() => remove(doc)}><Trash2 size={16}/></button></div></article>)}</div> : <section className="empty-library large-empty"><div className="empty-icon"><UploadCloud size={23}/></div><strong>{query ? "No documents match that search" : "Your next good question starts here"}</strong><p>{query ? "Try a shorter title or a different search." : "Add a PDF to build a private, searchable research library."}</p>{!query && <button className="button-secondary" onClick={() => input.current?.click()}><Plus size={16}/> Upload a PDF</button>}</section>}
    {nextCursor && <div className="load-more"><button className="button-secondary" disabled={busy} onClick={() => load(nextCursor, true)}>Load more <ArrowDownToLine size={15}/></button></div>}
    <div className="storage-note"><FileText size={16}/><span>PDF documents are private to your workspace. Each file can be up to 20 MB and 100 pages.</span><Link to="/research">Ask about them <ArrowRight size={14}/></Link></div>
  </div>;
}
