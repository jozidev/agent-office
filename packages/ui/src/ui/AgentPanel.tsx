import { useState } from "react";
import { CLAUDE_MODELS, PERMISSION_MODES, ROLE_PRESETS, type PermissionMode } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { TerminalPanel } from "./Terminal";
import { ChatPanel } from "./Chat";

export function AgentPanel() {
  const id = useOffice((s) => s.selectedAgentId);
  const agent = useOffice((s) => (id ? s.agents[id] : undefined));
  const state = useOffice((s) => (id ? s.states[id] : undefined));
  const ticket = useOffice((s) => (state?.ticketId ? s.tickets[state.ticketId] : undefined));
  const send = useOffice((s) => s.send);
  const setSelected = useOffice((s) => s.setSelected);
  const [reply, setReply] = useState("");

  if (!agent || !state) return null;
  const preset = ROLE_PRESETS[agent.role];

  return (
    <aside className="panel">
      <header>
        <i style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor[state.status] }} />
        <h3>
          {agent.name} <small style={{ color: "var(--muted)", fontWeight: 400 }}>· {preset.label}</small>
        </h3>
        <button onClick={() => setSelected(null)}>×</button>
      </header>
      <div className="body">
        <div className="kv">
          <span>status</span>
          <b>{statusLabel[state.status]}</b>
          <span>model</span>
          <select
            className="kv-edit"
            value={agent.model}
            onChange={(e) => send({ type: "agent.update", agentId: agent.id, model: e.target.value })}
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {/* An agent hired before this list existed keeps whatever it has. */}
            {!CLAUDE_MODELS.some((m) => m.id === agent.model) && <option value={agent.model}>{agent.model}</option>}
          </select>
          <span>folder</span>
          <b>{agent.cwd}</b>
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
          <span>tools</span>
          <b>{agent.allowedTools.length ? agent.allowedTools.join(", ") : "none"}</b>
          <span>ticket</span>
          <b>{ticket ? ticket.title : "none"}</b>
          <span>session</span>
          <b>{state.sessionId ?? "-"}</b>
        </div>

        {state.status === "waiting" && (
          <div>
            <div style={{ color: "var(--warn)" }}>{state.log[state.log.length - 1]?.replace(/^\S+\s/, "")}</div>
            <div className="respond">
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="your answer" onKeyDown={(e) => e.key === "Enter" && answer()} />
              <button className="primary" onClick={answer}>
                Send
              </button>
            </div>
          </div>
        )}

        {agent.uiMode === "chat" ? <ChatPanel agentId={agent.id} agentName={agent.name} /> : <TerminalPanel agentId={agent.id} agentName={agent.name} />}

        <div className="log" style={{ marginTop: 8 }}>
          {state.log.length ? state.log.join("\n") : "nothing yet"}
        </div>

        <div className="actions">
          {state.ticketId && (
            <button onClick={() => send({ type: "session.stop", agentId: agent.id })}>Stop session</button>
          )}
          <button className="danger" onClick={() => send({ type: "agent.fire", agentId: agent.id })}>
            Fire {agent.name}
          </button>
        </div>
      </div>
    </aside>
  );

  function answer() {
    if (!agent) return;
    send({ type: "agent.respond", agentId: agent.id, text: reply || "ok" });
    setReply("");
  }
}
