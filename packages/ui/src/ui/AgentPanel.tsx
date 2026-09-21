import { CLAUDE_MODELS, PERMISSION_MODES, ROLE_PRESETS, type PermissionMode } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { AskCard } from "./AskCard";
import { withFileLinks } from "./FilePath";
import { TerminalPanel } from "./Terminal";
import { ChatPanel } from "./Chat";

export function AgentPanel() {
  const id = useOffice((s) => s.selectedAgentId);
  const agent = useOffice((s) => (id ? s.agents[id] : undefined));
  const state = useOffice((s) => (id ? s.states[id] : undefined));
  const ticket = useOffice((s) => (state?.ticketId ? s.tickets[state.ticketId] : undefined));
  const send = useOffice((s) => s.send);
  const setSelected = useOffice((s) => s.setSelected);

  if (!agent || !state) return null;
  const preset = ROLE_PRESETS[agent.role];
  // Keyed on the question rather than the status: opening this agent's
  // terminal to read the question starts a session, and that must not make the
  // thing you are reading disappear.
  const question = state.question ?? (state.status === "waiting" ? (state.log[state.log.length - 1]?.replace(/^\S+\s(asks:\s)?/, "") ?? "") : "");
  const waiting = Boolean(question);

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
        {waiting && <AskCard agentName={agent.name} question={question} answerIn={state.answerIn} baseDir={agent.cwd} onSend={answer} />}
        <details className="kv-wrap" open={!waiting}>
          <summary>details</summary>
          <div className="kv">
          <span>status</span>
          <b>{statusLabel[state.status]}</b>
          <span>runtime</span>
          <b>{agent.runtime}</b>
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
          <b className="ellipsis" title={state.sessionId ?? ""}>
            {state.sessionId ?? "-"}
          </b>
          </div>
        </details>

        {agent.uiMode === "chat" ? <ChatPanel agentId={agent.id} agentName={agent.name} /> : <TerminalPanel agentId={agent.id} agentName={agent.name} />}

        <div className="log" style={{ marginTop: 8 }}>
          {state.log.length
            ? state.log.map((line, i) => <div key={i}>{withFileLinks(line, `log${i}`, agent.cwd)}</div>)
            : "nothing yet"}
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

  function answer(text: string) {
    if (!agent) return;
    send({ type: "agent.respond", agentId: agent.id, text });
  }
}
