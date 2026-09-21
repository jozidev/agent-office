import { useEffect, useState } from "react";
import { CLAUDE_MODELS, PERMISSION_MODES, ROLE_PRESETS, type PermissionMode } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { AskCard } from "./AskCard";
import { Changes } from "./Changes";
import { FolderPicker } from "./FolderPicker";
import { withFileLinks } from "./FilePath";
import { TerminalPanel } from "./Terminal";
import { ChatPanel } from "./Chat";

type TabId = "activity" | "changes" | "files" | "terminal";

/**
 * The workspace pane. A diff needs width, so selecting an agent gives the pane
 * the room and leaves the office as a strip: the room is the ambient view, and
 * once you have picked someone the work is the thing you are looking at.
 *
 * Tabs appear only when they apply — a chat agent never grows a Changes tab —
 * so the pane describes the agent rather than every agent wearing every tab.
 */
export function AgentPanel() {
  const id = useOffice((s) => s.selectedAgentId);
  const agent = useOffice((s) => (id ? s.agents[id] : undefined));
  const state = useOffice((s) => (id ? s.states[id] : undefined));
  const ticket = useOffice((s) => (state?.ticketId ? s.tickets[state.ticketId] : undefined));
  const send = useOffice((s) => s.send);
  const setSelected = useOffice((s) => s.setSelected);
  const [tab, setTab] = useState<TabId | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const busy = state ? state.status === "thinking" || state.status === "tool_use" : false;
  const touched = state?.touchedFiles.length ?? 0;

  // Default per your intent rather than per tab order: while it is working you
  // want to see it working; once it stops you want to see what it did.
  useEffect(() => {
    setTab(null);
  }, [id]);

  if (!agent || !state) return null;
  const preset = ROLE_PRESETS[agent.role];
  const question = state.question ?? (state.status === "waiting" ? (state.log[state.log.length - 1]?.replace(/^\S+\s(asks:\s)?/, "") ?? "") : "");
  const waiting = Boolean(question);

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: "activity", label: "Activity" },
    ...(touched > 0 ? [{ id: "changes" as const, label: "Changes", badge: touched }] : []),
    { id: "files", label: "Files" },
    ...(agent.uiMode === "terminal" ? [{ id: "terminal" as const, label: "Terminal" }] : []),
  ];
  const active: TabId = tab ?? (busy || touched === 0 ? "activity" : "changes");

  return (
    <aside className="workspace">
      <header>
        <i style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor[state.status] }} />
        <h3>
          {agent.name} <small>· {preset.label}</small>
        </h3>
        <span className="workspace-status">{statusLabel[state.status]}</span>
        <button onClick={() => setSelected(null)}>×</button>
      </header>

      {waiting && (
        <div className="workspace-ask">
          <AskCard agentName={agent.name} question={question} answerIn={state.answerIn} baseDir={agent.cwd} onSend={answer} />
        </div>
      )}

      <nav className="workspace-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={t.id === active ? "sel" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge ? <i className="tab-badge">{t.badge}</i> : null}
          </button>
        ))}
        <div className="workspace-tabs-right">
          <details className="kv-pop">
            <summary>details</summary>
            <div className="kv">
              <span>runtime</span>
              <b>{agent.runtime}</b>
              <span>model</span>
              <select className="kv-edit" value={agent.model} onChange={(e) => send({ type: "agent.update", agentId: agent.id, model: e.target.value })}>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {!CLAUDE_MODELS.some((m) => m.id === agent.model) && <option value={agent.model}>{agent.model}</option>}
              </select>
              <span>permissions</span>
              <select
                className="kv-edit"
                value={agent.permissionMode}
                title={PERMISSION_MODES.find((p) => p.id === agent.permissionMode)?.blurb}
                onChange={(e) => send({ type: "agent.update", agentId: agent.id, permissionMode: e.target.value as PermissionMode })}
              >
                {PERMISSION_MODES.map((p) => (
                  <option key={p.id} value={p.id} title={p.blurb}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span>folder</span>
              <b className="ellipsis" title={agent.cwd}>{agent.cwd}</b>
              <span>tools</span>
              <b>{agent.allowedTools.length ? agent.allowedTools.join(", ") : "none"}</b>
              <span>ticket</span>
              <b>{ticket ? ticket.title : "none"}</b>
              <span>session</span>
              <b className="ellipsis" title={state.sessionId ?? ""}>{state.sessionId ?? "-"}</b>
            </div>
            <button className="danger" onClick={() => send({ type: "agent.fire", agentId: agent.id })}>
              Fire {agent.name}
            </button>
          </details>
        </div>
      </nav>

      <div className="workspace-body">
        {active === "activity" && (
          <div className="log">
            {state.log.length ? state.log.map((line, i) => <div key={i}>{withFileLinks(line, `log${i}`, agent.cwd)}</div>) : "nothing yet"}
          </div>
        )}
        {active === "changes" && <Changes agentId={agent.id} touchedCount={touched} />}
        {active === "files" && (
          <div className="workspace-files">
            <button onClick={() => setBrowsing(true)}>Browse {agent.cwd}</button>
            {browsing && <FolderPicker start={agent.cwd} onClose={() => setBrowsing(false)} onPick={() => setBrowsing(false)} />}
          </div>
        )}
        {active === "terminal" &&
          (agent.uiMode === "chat" ? (
            <ChatPanel agentId={agent.id} agentName={agent.name} />
          ) : (
            <TerminalPanel key={agent.id} agentId={agent.id} agentName={agent.name} />
          ))}
      </div>
    </aside>
  );

  function answer(text: string) {
    if (!agent) return;
    send({ type: "agent.respond", agentId: agent.id, text });
  }
}
