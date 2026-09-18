import { useState } from "react";
import { FilePreview, isPreviewable } from "./FilePreview";
import { DELIMITERS, resolvePath, stripTrailingPunctuation } from "./filePaths";

/**
 * Agents write plans and reports constantly, and the office showed their
 * paths as dead text — reading one meant copying it into a terminal. Any path
 * in a question or a log line is now a link.
 *
 * Text a model wrote is read in the app; anything else is handed to the OS.
 * Shift-click always reveals it in the file manager instead.
 */

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

export function FilePath({ path, label }: { path: string; label?: string }) {
  const [preview, setPreview] = useState(false);
  const previewable = isPreviewable(path);

  return (
    <>
      <button
        className="file-link"
        title={`${path}\n${previewable ? "click to read" : "click to open"} · shift-click to reveal`}
        onClick={(e) => {
          e.stopPropagation();
          if (e.shiftKey) launch(path, "reveal");
          else if (previewable) setPreview(true);
          else launch(path, "open");
        }}
      >
        {label ?? path}
      </button>
      {preview && <FilePreview path={path} onClose={() => setPreview(false)} />}
    </>
  );
}

/**
 * Splits text into plain runs and clickable paths. `baseDir` is the agent's
 * working folder, which is what a relative path in its output is relative to.
 */
export function withFileLinks(text: string, keyPrefix: string, baseDir?: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let linked = false;

  text.split(DELIMITERS).forEach((token, i) => {
    if (!token) return;
    const trimmed = stripTrailingPunctuation(token);
    const resolved = trimmed ? resolvePath(trimmed, baseDir) : null;
    if (!resolved) {
      out.push(token);
      return;
    }
    linked = true;
    // The label stays exactly as the agent wrote it; only the target is resolved.
    out.push(<FilePath key={`${keyPrefix}-${i}`} path={resolved} label={trimmed} />);
    const tail = token.slice(trimmed.length);
    if (tail) out.push(tail);
  });

  return linked ? out : [text];
}
