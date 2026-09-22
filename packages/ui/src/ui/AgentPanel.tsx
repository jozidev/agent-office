import { useEffect, useState } from "react";
import { CLAUDE_MODELS, PERMISSION_MODES, ROLE_PRESETS, type PermissionMode } from "@agent-office/shared";
import { useOffice, statusColor, statusLabel } from "../store";
import { AskCard } from "./AskCard";
import { Changes } from "./Changes";
import { FolderPicker } from "./FolderPicker";
import { withFileLinks } from "./FilePath";
import { elapsed } from "./metrics";
import { SettingsSheet } from "./SettingsSheet";
import { FolderPath } from "./FolderPath";
import { CloseIcon, IconButton } from "./IconButton";
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
  const send = useOffice((s) => s.send);
  const setSelected = useOffice((s) => s.setSelected);
  const [tab, setTab] = useState<TabId | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const busy = state ? state.status === "thinking" || state.status === "tool_use" : false;
  const touched = state?.touchedFiles.length ?? 0;

  // Only the facts we actually have. A take-over reports nothing until its
  // statusline fires, and "– · $0.00 · –" reads as a broken widget rather than
  // as "not known yet".
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
  const m = state.metrics;
  const running = [
    ...(m.startedAt ? [elapsed(m.startedAt)] : []),
    ...(m.costUsd > 0 ? [`$${m.costUsd.toFixed(2)}`] : []),
    ...(m.contextPct !== null ? [`${Math.round(m.contextPct * 100)}%`] : []),
  ];
  const settings = `${CLAUDE_MODELS.find((x) => x.id === agent.model)?.label ?? agent.model} · ${
    PERMISSION_MODES.find((p) => p.id === agent.permissionMode)?.label ?? agent.permissionMode
  }`;
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
        <b className="workspace-name">{agent.name}</b>
        <span className="workspace-role">{preset.label}</span>

        <span className="workspace-status">{statusLabel[state.status]}</span>
        {/* What it is costing while it runs; what it is set to when it does not. */}
        <span className="workspace-facts">{busy && running.length ? running.join(" · ") : settings}</span>
        {/* An SVG rather than the ⚙ glyph, which renders thin and tiny on macOS. */}
        <button className="icon" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <IconButton label="Close" onClick={() => setSelected(null)}>
          <CloseIcon />
        </IconButton>
      </header>

      {waiting && (
        <div className="workspace-ask">
          <AskCard
            agentName={agent.name}
            question={question}
            answerIn={state.answerIn}
            baseDir={agent.cwd}
            onSend={answer}
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
            <button onClick={() => setBrowsing(true)}>
              Browse <FolderPath path={agent.cwd} />
            </button>
            {browsing && <FolderPicker start={agent.cwd} onClose={() => setBrowsing(false)} onPick={() => setBrowsing(false)} />}
          </div>
        )}
        {/* Hidden rather than unmounted: unmounting disposes the xterm, and
            coming back replays only the server's ring buffer, so everything
            above it is gone. Keeping it mounted keeps the scrollback. */}
        <div className="terminal-mount" hidden={active !== "terminal"}>
          {agent.uiMode === "chat" ? (
            <ChatPanel agentId={agent.id} agentName={agent.name} />
          ) : (
            <TerminalPanel key={agent.id} agentId={agent.id} agentName={agent.name} />
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsSheet
          agent={agent}
          onModel={(model) => send({ type: "agent.update", agentId: agent.id, model })}
          onPermissionMode={(permissionMode) => send({ type: "agent.update", agentId: agent.id, permissionMode })}
          onFire={() => {
            send({ type: "agent.fire", agentId: agent.id });
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <SteerBar
        model={agent.model}
        permissionMode={agent.permissionMode}
        busy={busy}
        canStop={Boolean(state.ticketId)}
        showTakeOver={active !== "terminal"}
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
