import { useState } from "react";
import { FilePreview, isPreviewable } from "./FilePreview";

/**
 * Agents write plans and reports constantly, and the office showed their
 * paths as dead text — reading one meant copying it into a terminal. Any
 * absolute path in the log or in an agent's question is now a link.
 *
 * Text a model wrote is read in the app; anything else is handed to the OS.
 * Shift-click always reveals it in the file manager instead.
 */

/** Absolute paths, including ~-relative ones. Trailing punctuation stays out of the match. */
const PATH_RE = /((?:~|\/)[\w.\-/@+]*[\w\-/@+])/g;

function launch(path: string, mode: "open" | "reveal") {
  void fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, mode }),
  }).then(async (res) => {
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // Never a modal: a failed open must not block the office you are watching.
    console.warn(`[agent-office] ${body.error ?? "could not open that file"}`);
  });
}

export function FilePath({ path }: { path: string }) {
  const [preview, setPreview] = useState(false);
  const previewable = isPreviewable(path);

  return (
    <>
      <button
        className="file-link"
        title={previewable ? `${path}\nclick to read · shift-click to reveal` : `${path}\nclick to open · shift-click to reveal`}
        onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey) launch(path, "reveal");
          else if (previewable) setPreview(true);
          else launch(path, "open");
        }}
      >
        {path}
      </button>
      {preview && <FilePreview path={path} onClose={() => setPreview(false)} />}
    </>
  );
}

/** Splits text into plain runs and clickable paths. */
export function withFileLinks(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text))) {
    // A lone "/" or a bare "~" is punctuation, not a path worth linking.
    if (m[0].length < 3) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<FilePath key={`${keyPrefix}-${m.index}`} path={m[0]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}
