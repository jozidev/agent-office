import { useEffect, useMemo, useState } from "react";
import { DiffFile, DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

/**
 * What this agent changed: its own files on the left, the diff on the right.
 *
 * The list comes from the agent's events rather than from `git status`, so it
 * stays correct when an agent shares a checkout with you — a plain working
 * tree diff would show your edits as the agent's.
 */

interface ChangedFile {
  path: string;
  display: string;
  additions: number;
  deletions: number;
}

interface ChangesReport {
  repo: boolean;
  root: string | null;
  files: ChangedFile[];
}

function useChanges(agentId: string, touchedCount: number) {
  const [report, setReport] = useState<ChangesReport | null>(null);

  // touchedCount is the dependency rather than a timer: the list only changes
  // when the agent writes another file, and the store already knows when.
  useEffect(() => {
    let live = true;
    fetch(`/api/agent/${agentId}/changes`)
      .then((r) => r.json())
      .then((c: ChangesReport) => live && setReport(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId, touchedCount]);

  return report;
}

function Diff({ agentId, file }: { agentId: string; file: ChangedFile }) {
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDiff(null);
    fetch(`/api/agent/${agentId}/diff?path=${encodeURIComponent(file.path)}`)
      .then((r) => r.json())
      .then((d: { diff?: string; error?: string }) => live && setDiff(d.diff ?? ""))
      .catch(() => live && setDiff(""));
    return () => {
      live = false;
    };
  }, [agentId, file.path]);

  // Built explicitly rather than handing the viewer raw `data`: the instance
  // has to be initialised and its lines built before it renders anything, and
  // doing it here means a diff that fails to parse says so instead of leaving
  // an empty pane.
  const diffFile = useMemo(() => {
    if (!diff?.trim()) return null;
    try {
      // The whole `git diff` output, headers included — parsing it is the
      // viewer's job, and handing it only the @@ hunk silently yields a file
      // with no lines and an empty pane.
      const f = DiffFile.createInstance({
        oldFile: { fileName: file.display, content: "" },
        newFile: { fileName: file.display, content: "" },
        hunks: [diff],
      });
      f.initTheme("dark");
      f.init();
      f.buildUnifiedDiffLines();
      return f.unifiedLineLength > 0 ? f : null;
    } catch {
      return null;
    }
  }, [diff, file.display]);

  if (diff === null) return <div className="changes-note">reading…</div>;
  if (!diffFile) {
    return <div className="changes-note">No diff to show — the file is unchanged, binary, or not text.</div>;
  }

  return <DiffView diffFile={diffFile} diffViewMode={DiffModeEnum.Unified} diffViewTheme="dark" diffViewHighlight diffViewWrap />;
}

export function Changes({ agentId, touchedCount }: { agentId: string; touchedCount: number }) {
  const report = useChanges(agentId, touchedCount);
  const [selected, setSelected] = useState<string | null>(null);

  const files = report?.files ?? [];
  const current = files.find((f) => f.path === selected) ?? files[0];

  if (!report) return <div className="changes-note">reading…</div>;
  if (!files.length) return <div className="changes-note">Nothing changed yet.</div>;

  return (
    <div className="changes">
      <div className="changes-list">
        {!report.repo && <div className="changes-note changes-note--inline">Not a git repository — showing the files only.</div>}
        {files.map((f) => (
          <button
            key={f.path}
            className={f.path === current?.path ? "sel" : ""}
            onClick={() => setSelected(f.path)}
            title={f.path}
          >
            <span className="changes-name">{f.display}</span>
            {report.repo && (
              <span className="changes-counts">
                {f.additions > 0 && <i className="add">+{f.additions}</i>}
                {f.deletions > 0 && <i className="del">−{f.deletions}</i>}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="changes-diff">
        {current && report.repo ? (
          <Diff agentId={agentId} file={current} />
        ) : (
          <div className="changes-note">Select a file to see what changed.</div>
        )}
      </div>
    </div>
  );
}
