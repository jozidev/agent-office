import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown } from "./Markdown";

/**
 * Reads a file an agent wrote without leaving the office. Agents produce
 * plans and reports constantly; having to leave for an editor to read one
 * breaks the thing the office is for — watching work happen.
 *
 * Portalled to <body> so it is not clipped by the 380px panel it opens from.
 */

interface FileBody {
  path: string;
  content: string;
  truncated: boolean;
  error?: string;
}

const PREVIEWABLE = /\.(md|markdown|txt|json|ya?ml|toml|csv|log)$/i;

export function isPreviewable(path: string): boolean {
  return PREVIEWABLE.test(path);
}

/** Markdown gets rendered; everything else is shown as it is written. */
function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const [body, setBody] = useState<FileBody | null>(null);

  useEffect(() => {
    let live = true;
    setBody(null);
    fetch(`/api/file?path=${encodeURIComponent(path)}`)
      .then(async (r) => ({ ...(await r.json()), ok: r.ok }) as FileBody & { ok: boolean })
      .then((b) => live && setBody(b))
      .catch((e: Error) => live && setBody({ path, content: "", truncated: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openExternally = (mode: "open" | "reveal") =>
    void fetch("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, mode }),
    });

  const name = path.split("/").pop() ?? path;

  return createPortal(
    <div className="preview-bg" onClick={onClose}>
      <div className="preview" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="preview-title">
            <b>{name}</b>
            <span title={path}>{path}</span>
          </div>
          <button onClick={() => openExternally("open")}>open externally</button>
          <button onClick={() => openExternally("reveal")}>reveal</button>
          <button onClick={onClose}>×</button>
        </header>
        <div className="preview-body">
          {!body && <div className="preview-note">reading…</div>}
          {body?.error && <div className="preview-note preview-error">{body.error}</div>}
          {body && !body.error && (isMarkdown(path) ? <Markdown text={body.content} baseDir={path.replace(/\/[^/]*$/, "")} /> : <pre>{body.content}</pre>)}
          {body?.truncated && <div className="preview-note">…truncated; open it externally to read the rest.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
