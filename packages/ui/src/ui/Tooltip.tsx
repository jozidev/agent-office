import { useEffect, useState } from "react";
import { ROLE_PRESETS } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { elapsed } from "./metrics";

export function Tooltip() {
  const id = useOffice((s) => s.hoveredAgentId);
  const agent = useOffice((s) => (id ? s.agents[id] : undefined));
  const state = useOffice((s) => (id ? s.states[id] : undefined));
  const ticket = useOffice((s) => (state?.ticketId ? s.tickets[state.ticketId] : undefined));
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [, tick] = useState(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearInterval(t);
    };
  }, []);

  if (!agent || !state) return null;
  const m = state.metrics;
  const pct = m.contextPct ?? 0;
  const left = Math.min(pos.x + 16, window.innerWidth - 280);
  const top = Math.min(pos.y + 16, window.innerHeight - 260);

  return (
    <div className="tooltip" style={{ left, top }}>
      <h4>
        <i className="dot" style={{ width: 9, height: 9, borderRadius: "50%", background: statusColor[state.status], display: "inline-block" }} />
        {agent.name} · {ROLE_PRESETS[agent.role].label} · {statusLabel[state.status]}
      </h4>
      <div className="row">
        <span>ticket</span>
        <span>{ticket ? ticket.title : "none"}</span>
      </div>
      {m.lastToolName && (
        <div className="row">
          <span>now</span>
          <span>
            {m.lastToolName} {m.lastToolSummary}
          </span>
        </div>
      )}
      <div className="row">
        <span>turns · time</span>
        <span>
          {m.turns} · {elapsed(m.startedAt)}
        </span>
      </div>
      <div className="row">
        <span>tokens · cost</span>
        <span>
          {Math.round(m.inputTokens / 1000)}k/{Math.round(m.outputTokens / 1000)}k · ${m.costUsd.toFixed(2)}
        </span>
      </div>
      <div className="row">
        <span>context</span>
        <span>{m.contextPct === null ? "-" : `${Math.round(pct * 100)}%`}</span>
      </div>
      <div className={`bar ${pct > 0.85 ? "bad" : pct > 0.65 ? "warn" : ""}`}>
        <i style={{ width: `${pct * 100}%` }} />
      </div>
      {state.subagents.length > 0 && (
        <div className="subs">
          {state.subagents.length} subagent{state.subagents.length > 1 ? "s" : ""} on the call:
          {state.subagents.slice(0, 4).map((s) => (
            <div key={s.id}>
              · {s.type}: {s.description}
            </div>
          ))}
        </div>
      )}
      <div className="hint">click to open</div>
    </div>
  );
}
