import { nanoid } from "nanoid";
import {
  AGENT_COLORS,
  ROLE_PRESETS,
  type Agent,
  type AgentState,
  type HireAgent,
  DEFAULT_RUNTIME,
  type PermissionMode,
  type RunnerEvent,
  type ServerMessage,
  type SessionMetrics,
  type Snapshot,
  type Subagent,
  type Ticket,
  type TicketStatus,
} from "@agent-office/shared";
import type { RunningSession, SessionRunner } from "./runner.js";
import { installHooks, uninstallHooks } from "./hooks.js";
import { allowedRoots, checkAgentCwd } from "./paths.js";
import { MemoryStore, type Store } from "./store.js";

const emptyMetrics = (): SessionMetrics => ({
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  contextPct: null,
  startedAt: null,
  lastToolName: null,
  lastToolSummary: null,
});

const now = () => new Date().toISOString();
/** The log is a scrolling history, so it gets a summary; the full text lives on `state.question`. */
function truncateLog(s: string): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}\u2026` : line;
}

const LOG_LIMIT = 60;

/**
 * The Office holds agents, live state and tickets, drives sessions through a
 * SessionRunner, and broadcasts changes. Agents and tickets are written
 * through to a Store so they survive a restart; live state is not, because it
 * belongs to a `claude` process that does not.
 */
export class Office {
  private agents = new Map<string, Agent>();
  private states = new Map<string, AgentState>();
  private tickets = new Map<string, Ticket>();
  private sessions = new Map<string, RunningSession>();
  private listeners = new Set<(m: ServerMessage) => void>();
  /** Count of /api/hook POSTs received this run, for the "hooks reachable" setup check. */
  hookHits = 0;

  private store: Store;

  constructor(
    private runner: SessionRunner,
    private opts: { serverUrl?: string; store?: Store; roots?: readonly string[] } = {},
  ) {
    this.store = opts.store ?? new MemoryStore();
  }

  /**
   * Rehydrates a previous run: agents return to their desks idle, the board
   * comes back as it was. Anything that was mid-flight is back in the backlog
   * (see statusAfterRestart) because the session working it did not survive.
   * Returns how much was restored, for the startup log.
   */
  restore(): { agents: number; tickets: number } {
    const sessionIds = this.store.loadSessionIds();
    for (const agent of this.store.loadAgents()) {
      this.agents.set(agent.id, agent);
      this.states.set(agent.id, {
        agentId: agent.id,
        status: "idle",
        sessionId: sessionIds.get(agent.id) ?? null,
        ticketId: null,
        question: null,
      answerIn: null,
      touchedFiles: [],
      metrics: emptyMetrics(),
        subagents: [],
        log: ["back at their desk"],
      });
    }
    for (const ticket of this.store.loadTickets()) this.tickets.set(ticket.id, ticket);
    return { agents: this.agents.size, tickets: this.tickets.size };
  }

  /** Agents restored from disk still need their hooks pointing at this run's port. */
  reinstallHooks(): void {
    if (!this.opts.serverUrl) return;
    for (const agent of this.agents.values()) {
      installHooks(agent, this.opts.serverUrl).catch((err) => console.error(`installHooks(${agent.id}) failed:`, err));
    }
  }

  subscribe(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(m: ServerMessage) {
    for (const l of this.listeners) l(m);
  }

  snapshot(): Snapshot {
    return {
      agents: [...this.agents.values()],
      states: [...this.states.values()],
      tickets: [...this.tickets.values()],
    };
  }

  // ---------- agents ----------

  private nextDesk(): number {
    const used = new Set([...this.agents.values()].map((a) => a.desk));
    let d = 0;
    while (used.has(d)) d++;
    return d;
  }

  hire(input: HireAgent): Agent {
    // Confine before anything is written: installHooks below turns this path
    // into a .claude/settings.local.json, and `~` would make that the global one.
    checkAgentCwd(input.cwd, this.opts.roots ?? allowedRoots());
    const preset = ROLE_PRESETS[input.role];
    const agent: Agent = {
      id: nanoid(8),
      name: input.name,
      role: input.role,
      color: input.color ?? AGENT_COLORS[this.agents.size % AGENT_COLORS.length]!,
      runtime: DEFAULT_RUNTIME,
      model: input.model ?? preset.model,
      cwd: input.cwd,
      systemPrompt: input.systemPrompt ?? preset.systemPrompt,
      allowedTools: preset.allowedTools,
      permissionMode: preset.permissionMode,
      uiMode: preset.uiMode,
      desk: this.nextDesk(),
      createdAt: now(),
    };
    this.agents.set(agent.id, agent);
    const state: AgentState = {
      agentId: agent.id,
      status: "idle",
      sessionId: null,
      ticketId: null,
      question: null,
      answerIn: null,
      touchedFiles: [],
      metrics: emptyMetrics(),
      subagents: [],
      log: [`hired as ${preset.label}`],
    };
    this.states.set(agent.id, state);
    this.store.saveAgent(agent);
    this.broadcast({ type: "agent.upsert", agent });
    this.broadcast({ type: "state.update", state });
    if (this.opts.serverUrl) {
      // Fire-and-forget: hook install touches the agent's project folder on disk and must not block hiring.
      installHooks(agent, this.opts.serverUrl).catch((err) => console.error(`installHooks(${agent.id}) failed:`, err));
    }
    return agent;
  }

  fire(agentId: string) {
    const agent = this.agents.get(agentId);
    this.sessions.get(agentId)?.stop();
    this.sessions.delete(agentId);
    for (const t of this.tickets.values()) {
      if (t.assignedAgentId === agentId) this.updateTicket(t.id, { assignedAgentId: null, sessionId: null, status: "backlog" });
    }
    this.agents.delete(agentId);
    this.states.delete(agentId);
    this.store.deleteAgent(agentId);
    this.broadcast({ type: "agent.removed", agentId });
    if (agent && this.opts.serverUrl) {
      uninstallHooks(agent).catch((err) => console.error(`uninstallHooks(${agent.id}) failed:`, err));
    }
  }

  // ---------- tickets ----------

  createTicket(title: string, description = ""): Ticket {
    const t: Ticket = {
      id: nanoid(8),
      title,
      description,
      status: "backlog",
      assignedAgentId: null,
      sessionId: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.tickets.set(t.id, t);
    this.store.saveTicket(t);
    this.broadcast({ type: "ticket.upsert", ticket: t });
    return t;
  }

  updateTicket(id: string, patch: Partial<Ticket>): Ticket | undefined {
    const t = this.tickets.get(id);
    if (!t) return;
    const next = { ...t, ...patch, updatedAt: now() };
    this.tickets.set(id, next);
    this.store.saveTicket(next);
    this.broadcast({ type: "ticket.upsert", ticket: next });
    return next;
  }

  deleteTicket(id: string) {
    const t = this.tickets.get(id);
    if (!t) return;
    if (t.assignedAgentId) this.stopSession(t.assignedAgentId);
    this.tickets.delete(id);
    this.store.deleteTicket(id);
    this.broadcast({ type: "ticket.removed", ticketId: id });
  }

  moveTicket(id: string, status: TicketStatus) {
    const t = this.tickets.get(id);
    if (!t) return;
    if (status === "backlog" && t.assignedAgentId) {
      this.stopSession(t.assignedAgentId);
      this.updateTicket(id, { status, assignedAgentId: null, sessionId: null });
      return;
    }
    this.updateTicket(id, { status });
  }

  /** Assign (or unassign with null). One ticket per agent at a time. */
  assign(ticketId: string, agentId: string | null): string | undefined {
    const t = this.tickets.get(ticketId);
    if (!t) return "ticket not found";
    if (agentId === null) {
      if (t.assignedAgentId) this.stopSession(t.assignedAgentId);
      this.updateTicket(ticketId, { assignedAgentId: null, sessionId: null, status: "backlog" });
      return;
    }
    const agent = this.agents.get(agentId);
    const state = this.states.get(agentId);
    if (!agent || !state) return "agent not found";
    if (state.ticketId && state.ticketId !== ticketId) return `${agent.name} is busy`;
    if (t.assignedAgentId && t.assignedAgentId !== agentId) this.stopSession(t.assignedAgentId);
    const ticket = this.updateTicket(ticketId, { assignedAgentId: agentId, status: "assigned" })!;
    this.startSession(agent, ticket);
  }

  // ---------- sessions ----------

  private startSession(agent: Agent, ticket: Ticket) {
    const state = this.states.get(agent.id)!;
    state.ticketId = ticket.id;
    state.metrics = { ...emptyMetrics(), startedAt: now() };
    state.subagents = [];
    this.pushLog(state, `picked up "${ticket.title}"`);
    const session = this.runner.start(agent, ticket, (e) => this.onEvent(agent.id, e));
    this.sessions.set(agent.id, session);
  }

  stopSession(agentId: string) {
    const s = this.sessions.get(agentId);
    if (s) {
      s.stop();
      this.sessions.delete(agentId);
    }
    const state = this.states.get(agentId);
    if (!state) return;
    if (state.ticketId) {
      const t = this.tickets.get(state.ticketId);
      if (t && t.status !== "done") this.updateTicket(t.id, { status: "backlog", assignedAgentId: null, sessionId: null });
    }
    state.status = "idle";
    state.question = null;
    state.answerIn = null;
    state.ticketId = null;
    state.sessionId = null;
    state.subagents = [];
    this.pushLog(state, "session stopped");
    this.broadcast({ type: "state.update", state });
  }

  /**
   * Change an agent's model or permission mode without firing it. Both are
   * flags baked in when a session spawns, so a run already in flight keeps the
   * settings it started with rather than being killed mid-ticket.
   */
  updateAgent(agentId: string, patch: { model?: string; permissionMode?: PermissionMode }): string | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return `no such agent: ${agentId}`;
    const next: Agent = {
      ...agent,
      ...(patch.model !== undefined && { model: patch.model }),
      ...(patch.permissionMode !== undefined && { permissionMode: patch.permissionMode }),
    };
    if (next.model === agent.model && next.permissionMode === agent.permissionMode) return;

    this.agents.set(agentId, next);
    this.store.saveAgent(next);
    const state = this.states.get(agentId);
    if (state) {
      const changed = [
        ...(next.model !== agent.model ? [`model ${next.model}`] : []),
        ...(next.permissionMode !== agent.permissionMode ? [`permissions ${next.permissionMode}`] : []),
      ].join(", ");
      this.pushLog(state, this.sessions.has(agentId) ? `${changed} (applies to the next run)` : changed);
      this.broadcast({ type: "state.update", state });
    }
    this.broadcast({ type: "agent.upsert", agent: next });
    return;
  }

  respond(agentId: string, text: string) {
    const state = this.states.get(agentId);
    if (!state) return;

    // A live session takes the answer on stdin. A headless run that stopped to
    // ask has already exited, so continuing it means a fresh `claude -p
    // --resume` against the same conversation.
    const live = this.sessions.get(agentId);
    if (live?.isAlive()) live.respond(text);
    else if (state.answerIn === "terminal") return;
    else if (state.status === "waiting" && state.sessionId) this.resumeSession(agentId, text);
    else return;

    if (state.status === "waiting") {
      state.status = "thinking";
      state.question = null;
      state.answerIn = null;
      this.pushLog(state, `you: ${text}`);
      if (state.ticketId) this.updateTicket(state.ticketId, { status: "in_progress" });
      this.broadcast({ type: "state.update", state });
    }
  }

  /** Continue a conversation that ended waiting on the user. */
  private resumeSession(agentId: string, text: string) {
    const agent = this.agents.get(agentId);
    const state = this.states.get(agentId);
    if (!agent || !state?.sessionId) return;
    const session = this.runner.resume(agent, state.sessionId, text, (e) => this.onEvent(agentId, e));
    this.sessions.set(agentId, session);
  }

  private pushLog(state: AgentState, line: string) {
    state.log.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  private onEvent(agentId: string, e: RunnerEvent) {
    const state = this.states.get(agentId);
    if (!state) return;
    const ticketId = state.ticketId;
    switch (e.kind) {
      case "started":
        // A new session is new work: what the last one changed is no longer
        // the answer to "what has this agent changed".
        if (state.sessionId !== e.sessionId) state.touchedFiles = [];
        state.sessionId = e.sessionId;
        // Remembered across restarts so the terminal can still --resume this conversation.
        this.store.saveAgentSession(agentId, e.sessionId);
        state.status = "thinking";
        if (ticketId) this.updateTicket(ticketId, { sessionId: e.sessionId, status: "in_progress" });
        break;
      case "thinking":
        state.status = "thinking";
        state.metrics.turns += 1;
        break;
      case "tool_use":
        state.status = "tool_use";
        state.metrics.lastToolName = e.name;
        state.metrics.lastToolSummary = e.summary;
        this.pushLog(state, `${e.name} ${e.summary}`);
        break;
      case "waiting":
        state.status = "waiting";
        state.question = e.prompt;
        state.answerIn = "panel";
        this.pushLog(state, `asks: ${truncateLog(e.prompt)}`);
        if (ticketId) this.updateTicket(ticketId, { status: "waiting" });
        break;
      case "file_touched":
        if (!state.touchedFiles.includes(e.path)) state.touchedFiles.push(e.path);
        break;
      case "usage":
        state.metrics.inputTokens = e.input;
        state.metrics.outputTokens = e.output;
        state.metrics.cacheReadTokens = e.cacheRead;
        state.metrics.costUsd = e.costUsd;
        break;
      case "context":
        state.metrics.contextPct = e.pct;
        break;
      case "subagent_start": {
        const sub: Subagent = {
          id: e.id,
          parentAgentId: agentId,
          type: e.type,
          description: e.description,
          status: "thinking",
          metrics: { ...emptyMetrics(), startedAt: now() },
        };
        state.subagents.push(sub);
        this.pushLog(state, `spawned ${e.type}: ${e.description}`);
        break;
      }
      case "subagent_tool": {
        const sub = state.subagents.find((s) => s.id === e.id);
        if (sub) {
          sub.status = "tool_use";
          sub.metrics.lastToolName = e.name;
          sub.metrics.lastToolSummary = e.summary;
          sub.metrics.turns += 1;
        }
        break;
      }
      case "subagent_stop":
        state.subagents = state.subagents.filter((s) => s.id !== e.id);
        break;
      case "done":
        state.status = "done";
        state.subagents = [];
        this.pushLog(state, e.summary);
        if (ticketId) this.updateTicket(ticketId, { status: "done" });
        this.sessions.delete(agentId);
        setTimeout(() => {
          if (state.status === "done") {
            state.status = "idle";
            state.ticketId = null;
            this.broadcast({ type: "state.update", state });
          }
        }, 4000);
        break;
      case "error":
        state.status = "error";
        state.subagents = [];
        this.pushLog(state, `error: ${e.message}`);
        if (ticketId) this.updateTicket(ticketId, { status: "backlog", assignedAgentId: null, sessionId: null });
        this.sessions.delete(agentId);
        setTimeout(() => {
          if (state.status === "error") {
            state.status = "idle";
            state.ticketId = null;
            this.broadcast({ type: "state.update", state });
          }
        }, 6000);
        break;
    }
    if (state.status !== "waiting") {
      state.question = null;
      state.answerIn = null;
    }
    this.broadcast({ type: "state.update", state });
  }

  // ---------- external (hook-driven) state updates ----------

  /**
   * Applies a RunnerEvent derived from a Claude Code hook (see hooks.ts),
   * for sessions the office didn't start itself — an interactive terminal
   * session in an agent's folder. Deliberately separate from onEvent: hook
   * events must never mutate ticket state (that stays driven by the real
   * CliRunner session), and "done" here means the Stop hook fired, not that
   * a ticket finished.
   */
  ingestExternal(agentId: string, e: RunnerEvent) {
    const state = this.states.get(agentId);
    if (!state) return;
    // Hooks live in the agent's folder, so they also fire for the office's own
    // headless ticket runs — every tool call arrived twice, once from the
    // runner's stream and once from PreToolUse. While a session we started is
    // running, that session is the authority for everything it reports itself.
    // "waiting" is the exception: the stream never emits it, so dropping it
    // here is how an agent that needs you came to look idle.
    if (this.sessions.has(agentId) && e.kind !== "waiting") return;
    switch (e.kind) {
      case "started":
        if (!state.ticketId) {
          state.sessionId = e.sessionId;
          this.store.saveAgentSession(agentId, e.sessionId);
        }
        // Opening a terminal to read the question must not answer it.
        if (state.status !== "waiting") state.status = "thinking";
        break;
      case "thinking":
        state.status = "thinking";
        break;
      case "tool_use":
        state.status = "tool_use";
        state.metrics.lastToolName = e.name;
        state.metrics.lastToolSummary = e.summary;
        this.pushLog(state, `${e.name} ${e.summary}`);
        break;
      case "waiting":
        state.status = "waiting";
        state.question = e.prompt;
        state.answerIn = "terminal";
        this.pushLog(state, `asks: ${truncateLog(e.prompt)}`);
        break;
      case "subagent_start": {
        if (e.id && state.subagents.some((s) => s.id === e.id)) break;
        const sub: Subagent = {
          id: e.id,
          parentAgentId: agentId,
          type: e.type,
          description: e.description,
          status: "thinking",
          metrics: { ...emptyMetrics(), startedAt: now() },
        };
        state.subagents.push(sub);
        this.pushLog(state, `spawned ${e.type}: ${e.description}`);
        break;
      }
      case "subagent_tool": {
        const sub = state.subagents.find((s) => s.id === e.id);
        if (sub) {
          sub.status = "tool_use";
          sub.metrics.lastToolName = e.name;
          sub.metrics.lastToolSummary = e.summary;
          sub.metrics.turns += 1;
        }
        break;
      }
      case "subagent_stop": {
        // Prefer an id match (agent_id/tool_use_id from the hook); Notification/Stop-adjacent hooks don't always carry one, so fall back to the oldest open tile.
        const idx = e.id ? state.subagents.findIndex((s) => s.id === e.id) : 0;
        if (idx >= 0) state.subagents.splice(idx, 1);
        break;
      }
      case "done":
        // A Stop hook: the current turn ended. Only settle to idle if no ticket is actively running this agent — otherwise the real CliRunner session owns the final state.
        this.pushLog(state, e.summary);
        if (!state.ticketId) state.status = "idle";
        break;
      case "error":
        this.pushLog(state, `error: ${e.message}`);
        if (!state.ticketId) state.status = "idle";
        break;
      case "file_touched":
        if (!state.touchedFiles.includes(e.path)) state.touchedFiles.push(e.path);
        break;
      case "usage":
      case "context":
        // Not tracked for external sessions: these numbers belong to whichever session the ticket metrics panel is already showing.
        break;
    }
    this.broadcast({ type: "state.update", state });
  }

  /**
   * Statusline forwarder POST (see hooks.ts statusLineCommand). Body shape
   * per https://code.claude.com/docs/en/statusline: `context_window.used_percentage`
   * is the documented simplest source (0..100); we fall back to computing it
   * from token counts if a future/older CLI build only sends those. Anything
   * else about the shape is ignored — this must never throw on odd input.
   */
  ingestStatusline(agentId: string, body: unknown) {
    const state = this.states.get(agentId);
    if (!state || state.ticketId) return; // a ticket's own CliRunner context readout takes precedence
    const b = (body ?? {}) as Record<string, unknown>;
    const cw = (b["context_window"] ?? {}) as Record<string, unknown>;
    let pct: number | null = null;
    if (typeof cw["used_percentage"] === "number") {
      pct = cw["used_percentage"] / 100;
    } else {
      const size = cw["context_window_size"];
      const input = cw["total_input_tokens"];
      const output = cw["total_output_tokens"];
      if (typeof size === "number" && size > 0 && typeof input === "number" && typeof output === "number") {
        pct = (input + output) / size;
      }
    }
    if (pct === null || Number.isNaN(pct)) return;
    state.metrics.contextPct = Math.max(0, Math.min(1, pct));
    this.broadcast({ type: "state.update", state });
  }

  /**
   * SessionEnd hook: no RunnerEvent maps to "go idle", so this is called
   * directly by the /api/hook route. Guarded by "no ticket running" for the
   * same reason as the "done" case above: hooks fire for every session in
   * that folder, and a ticket's real completion must stay owned by CliRunner.
   */
  forceIdle(agentId: string) {
    const state = this.states.get(agentId);
    if (!state) return;
    if (this.sessions.has(agentId)) return; // our own ticket run ending; onEvent already handles it
    if (!state.ticketId) {
      state.status = "idle";
      this.pushLog(state, "session ended");
      this.broadcast({ type: "state.update", state });
    }
  }
}
