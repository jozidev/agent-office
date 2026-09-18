import { nanoid } from "nanoid";
import {
  AGENT_COLORS,
  ROLE_PRESETS,
  type Agent,
  type AgentState,
  type HireAgent,
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
const LOG_LIMIT = 60;

/**
 * The Office holds agents, live state and tickets, drives sessions through a
 * SessionRunner, and broadcasts changes. In-memory for M1/M2; persistence
 * (SQLite) plugs in behind load()/save() later.
 */
export class Office {
  private agents = new Map<string, Agent>();
  private states = new Map<string, AgentState>();
  private tickets = new Map<string, Ticket>();
  private sessions = new Map<string, RunningSession>();
  private listeners = new Set<(m: ServerMessage) => void>();
  /** Count of /api/hook POSTs received this run, for the "hooks reachable" setup check. */
  hookHits = 0;

  constructor(
    private runner: SessionRunner,
    private opts: { serverUrl?: string } = {},
  ) {}

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
    const preset = ROLE_PRESETS[input.role];
    const agent: Agent = {
      id: nanoid(8),
      name: input.name,
      role: input.role,
      color: input.color ?? AGENT_COLORS[this.agents.size % AGENT_COLORS.length]!,
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
      metrics: emptyMetrics(),
      subagents: [],
      log: [`hired as ${preset.label}`],
    };
    this.states.set(agent.id, state);
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
    this.broadcast({ type: "ticket.upsert", ticket: t });
    return t;
  }

  updateTicket(id: string, patch: Partial<Ticket>): Ticket | undefined {
    const t = this.tickets.get(id);
    if (!t) return;
    const next = { ...t, ...patch, updatedAt: now() };
    this.tickets.set(id, next);
    this.broadcast({ type: "ticket.upsert", ticket: next });
    return next;
  }

  deleteTicket(id: string) {
    const t = this.tickets.get(id);
    if (!t) return;
    if (t.assignedAgentId) this.stopSession(t.assignedAgentId);
    this.tickets.delete(id);
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
    state.ticketId = null;
    state.sessionId = null;
    state.subagents = [];
    this.pushLog(state, "session stopped");
    this.broadcast({ type: "state.update", state });
  }

  respond(agentId: string, text: string) {
    this.sessions.get(agentId)?.respond(text);
    const state = this.states.get(agentId);
    if (state && state.status === "waiting") {
      state.status = "thinking";
      this.pushLog(state, `you: ${text}`);
      if (state.ticketId) this.updateTicket(state.ticketId, { status: "in_progress" });
      this.broadcast({ type: "state.update", state });
    }
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
        state.sessionId = e.sessionId;
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
        this.pushLog(state, `asks: ${e.prompt}`);
        if (ticketId) this.updateTicket(ticketId, { status: "waiting" });
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
    // running, that session is the authority.
    if (this.sessions.has(agentId)) return;
    switch (e.kind) {
      case "started":
        if (!state.ticketId) state.sessionId = e.sessionId;
        state.status = "thinking";
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
        this.pushLog(state, `asks: ${e.prompt}`);
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
