import { useEffect, useRef, useState } from "react";
import { CLAUDE_MODELS, PERMISSION_MODES, ROLE_PRESETS, type PermissionMode } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { AskCard } from "./AskCard";
import { Changes } from "./Changes";
import { FolderPicker } from "./FolderPicker";
import { withFileLinks } from "./FilePath";
import { elapsed } from "./metrics";
import { SteerBar } from "./SteerBar";
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
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const busy = state ? state.status === "thinking" || state.status === "tool_use" : false;
  const touched = state?.touchedFiles.length ?? 0;

  // Elapsed has to tick on its own; nothing else in the store changes per second.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

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
        {/* What the agent is configured as, always; what it is costing, only
            while it is actually running. */}
        <dl className="workspace-meta">
          <div>
            <dt>model</dt>
            <dd>{CLAUDE_MODELS.find((m) => m.id === agent.model)?.label ?? agent.model}</dd>
          </div>
          <div>
            <dt>permissions</dt>
            <dd>{PERMISSION_MODES.find((p) => p.id === agent.permissionMode)?.label ?? agent.permissionMode}</dd>
          </div>
          <div className="workspace-meta-folder">
            <dt>folder</dt>
            <dd title={agent.cwd}>{agent.cwd}</dd>
          </div>
          {busy && (
            <>
              <div>
                <dt>elapsed</dt>
                <dd>{elapsed(state.metrics.startedAt)}</dd>
              </div>
              <div>
                <dt>cost</dt>
                <dd>${state.metrics.costUsd.toFixed(2)}</dd>
              </div>
              <div>
                <dt>context</dt>
                <dd>{state.metrics.contextPct === null ? "-" : `${Math.round(state.metrics.contextPct * 100)}%`}</dd>
              </div>
            </>
          )}
        </dl>
        <span className="workspace-status">{statusLabel[state.status]}</span>
        <button onClick={() => setSelected(null)}>×</button>
      </header>

      {waiting && (
        <div className="workspace-ask">
          <AskCard
            agentName={agent.name}
            question={question}
            answerIn={state.answerIn}
            baseDir={agent.cwd}
            onSend={answer}
            onReject={() => replyRef.current?.focus()}
          />
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

      <SteerBar
        ref={replyRef}
        model={agent.model}
        permissionMode={agent.permissionMode}
        busy={busy}
        canStop={Boolean(state.ticketId)}
        onSend={answer}
        onModel={(model) => send({ type: "agent.update", agentId: agent.id, model })}
        onPermissionMode={(permissionMode) => send({ type: "agent.update", agentId: agent.id, permissionMode })}
        onStop={() => send({ type: "session.stop", agentId: agent.id })}
        onTakeOver={() => setTab("terminal")}
      />
    </aside>
  );

  function answer(text: string) {
    if (!agent) return;
    send({ type: "agent.respond", agentId: agent.id, text });
  }
}
