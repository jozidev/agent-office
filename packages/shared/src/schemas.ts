import { z } from "zod";

// ---------- Core enums ----------

export const RoleId = z.enum(["coder", "reviewer", "chat", "assistant", "custom"]);
export type RoleId = z.infer<typeof RoleId>;

/** What the character is doing. Drives animation + status dot. */
export const AgentStatus = z.enum([
  "idle", // nothing assigned
  "thinking", // model is generating
  "tool_use", // running a tool
  "waiting", // needs the user (permission prompt, question)
  "done", // just finished a ticket (transient)
  "error",
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const TicketStatus = z.enum(["backlog", "assigned", "in_progress", "waiting", "done"]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const UiMode = z.enum(["terminal", "chat"]);
export type UiMode = z.infer<typeof UiMode>;

// ---------- Entities ----------

export const Agent = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  role: RoleId,
  color: z.string(), // hex
  model: z.string(),
  cwd: z.string(),
  systemPrompt: z.string().default(""),
  allowedTools: z.array(z.string()).default([]),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).default("default"),
  uiMode: UiMode,
  /** desk slot index on the office grid */
  desk: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Agent = z.infer<typeof Agent>;

export const SessionMetrics = z.object({
  turns: z.number().int().nonnegative().default(0),
  inputTokens: z.number().nonnegative().default(0),
  outputTokens: z.number().nonnegative().default(0),
  cacheReadTokens: z.number().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  /** 0..1, null when unknown */
  contextPct: z.number().min(0).max(1).nullable().default(null),
  startedAt: z.string().nullable().default(null),
  lastToolName: z.string().nullable().default(null),
  lastToolSummary: z.string().nullable().default(null),
});
export type SessionMetrics = z.infer<typeof SessionMetrics>;

export const Subagent = z.object({
  id: z.string(),
  parentAgentId: z.string(),
  type: z.string(), // e.g. Explore, Plan, general-purpose, custom name
  description: z.string(),
  status: AgentStatus,
  metrics: SessionMetrics,
});
export type Subagent = z.infer<typeof Subagent>;

/** Live state for an agent, separate from its config. */
export const AgentState = z.object({
  agentId: z.string(),
  status: AgentStatus,
  sessionId: z.string().nullable(),
  ticketId: z.string().nullable(),
  metrics: SessionMetrics,
  subagents: z.array(Subagent),
  /** last N event lines for the panel */
  log: z.array(z.string()),
});
export type AgentState = z.infer<typeof AgentState>;

export const Ticket = z.object({
  id: z.string(),
  title: z.string().min(1).max(120),
  description: z.string().default(""),
  status: TicketStatus,
  assignedAgentId: z.string().nullable(),
  sessionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof Ticket>;

// ---------- Client -> Server ----------

export const HireAgent = z.object({
  name: z.string().min(1).max(40),
  role: RoleId,
  cwd: z.string().min(1),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  color: z.string().optional(),
});
export type HireAgent = z.infer<typeof HireAgent>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({ type: z.literal("agent.hire"), payload: HireAgent }),
  z.object({ type: z.literal("agent.fire"), agentId: z.string() }),
  z.object({
    type: z.literal("ticket.create"),
    title: z.string().min(1).max(120),
    description: z.string().default(""),
  }),
  z.object({ type: z.literal("ticket.update"), ticketId: z.string(), title: z.string().optional(), description: z.string().optional() }),
  z.object({ type: z.literal("ticket.delete"), ticketId: z.string() }),
  z.object({ type: z.literal("ticket.assign"), ticketId: z.string(), agentId: z.string().nullable() }),
  z.object({ type: z.literal("ticket.move"), ticketId: z.string(), status: TicketStatus }),
  /** for mock/dev: answer a waiting agent */
  z.object({ type: z.literal("agent.respond"), agentId: z.string(), text: z.string() }),
  z.object({ type: z.literal("session.stop"), agentId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- Server -> Client ----------

export const Snapshot = z.object({
  agents: z.array(Agent),
  states: z.array(AgentState),
  tickets: z.array(Ticket),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), payload: Snapshot }),
  z.object({ type: z.literal("agent.upsert"), agent: Agent }),
  z.object({ type: z.literal("agent.removed"), agentId: z.string() }),
  z.object({ type: z.literal("state.update"), state: AgentState }),
  z.object({ type: z.literal("ticket.upsert"), ticket: Ticket }),
  z.object({ type: z.literal("ticket.removed"), ticketId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---------- Session runner events (server-internal, but shared so the UI can render logs) ----------

export const RunnerEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), sessionId: z.string() }),
  z.object({ kind: z.literal("thinking") }),
  z.object({ kind: z.literal("tool_use"), name: z.string(), summary: z.string() }),
  z.object({ kind: z.literal("waiting"), prompt: z.string() }),
  z.object({ kind: z.literal("usage"), input: z.number(), output: z.number(), cacheRead: z.number(), costUsd: z.number() }),
  z.object({ kind: z.literal("context"), pct: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("subagent_start"), id: z.string(), type: z.string(), description: z.string() }),
  z.object({ kind: z.literal("subagent_tool"), id: z.string(), name: z.string(), summary: z.string() }),
  z.object({ kind: z.literal("subagent_stop"), id: z.string() }),
  z.object({ kind: z.literal("done"), summary: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type RunnerEvent = z.infer<typeof RunnerEvent>;
