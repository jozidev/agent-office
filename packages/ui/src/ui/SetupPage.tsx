import { useEffect, useState } from "react";
import type { SetupReport, SetupCheck } from "@agent-office/shared";
import { useOffice } from "../store";

const COLOR: Record<SetupCheck["status"], string> = { ok: "var(--ok)", warn: "var(--warn)", fail: "var(--bad)" };
const ICON: Record<SetupCheck["status"], string> = { ok: "✓", warn: "!", fail: "×" };

/**
 * "Set up your office": runs the server-side environment checks and explains
 * what is missing. Read-only; every fix is a command the user runs themselves.
 */
export function SetupPage() {
  const open = useOffice((s) => s.setupOpen);
  const setOpen = useOffice((s) => s.setSetupOpen);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = (await (await fetch("/api/setup")).json()) as SetupReport;
      setReport(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  if (!open) return null;

  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const groups = report
    ? [
        { title: "Machine", items: report.checks.filter((c) => !c.id.startsWith("agent:")) },
        { title: "Agents", items: report.checks.filter((c) => c.id.startsWith("agent:")) },
      ]
    : [];

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal setup" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Set up your office</h3>
          <span className="spacer" />
          {report && (
            <span className="overall" style={{ color: COLOR[report.overall] }}>
              {report.overall === "ok" ? "all good" : report.overall === "warn" ? "works, with notes" : "needs attention"}
            </span>
          )}
          <button onClick={refresh} disabled={loading}>
            {loading ? "checking…" : "Re-check"}
          </button>
          <button onClick={() => setOpen(false)}>×</button>
        </header>
        <p className="intro">
          Agent Office drives the real <code>claude</code> command on this machine, under your own login. Nothing here changes your system; each fix is a
          command you run yourself.
        </p>
        {!report && <div className="muted">Running checks…</div>}
        {groups.map((g) =>
          g.items.length ? (
            <section key={g.title}>
              <h5>{g.title}</h5>
              {g.items.map((c) => (
                <div key={c.id} className="check">
                  <span className="icon" style={{ color: COLOR[c.status], borderColor: COLOR[c.status] }}>
                    {ICON[c.status]}
                  </span>
                  <div className="text">
                    <div className="label">{c.label}</div>
                    <div className="detail">{c.detail}</div>
                    {c.hint && <div className="hint">{c.hint}</div>}
                    {c.fix && (
                      <div className="fix">
                        <code>{c.fix.command}</code>
                        <button onClick={() => copy(c.fix!.command)}>{copied === c.fix.command ? "copied" : "copy"}</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ) : null,
        )}
        <section>
          <h5>Coming with later milestones</h5>
          <div className="muted">
            Hooks and statusline install per agent (3), terminal access (4), MCP servers, skills and plugins inventory (6), usage and limits (7).
          </div>
        </section>
      </div>
    </div>
  );
}
