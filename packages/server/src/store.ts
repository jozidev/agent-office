import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { Agent, Ticket, TicketStatus } from "@agent-office/shared";

/**
 * Persistence for the parts of the office that should survive a restart: who
 * works here, and what is on the board. Live session state (status, metrics,
 * subagents, log) is deliberately not stored — those belong to a running
 * `claude` process, and that process is gone once the server stops.
 */
export interface Store {
  loadAgents(): Agent[];
  loadTickets(): Ticket[];
  /** Last session id seen per agent, so a restored agent's terminal can still `claude --resume`. */
  loadSessionIds(): Map<string, string>;
  saveAgent(agent: Agent): void;
  saveAgentSession(agentId: string, sessionId: string | null): void;
  deleteAgent(agentId: string): void;
  saveTicket(ticket: Ticket): void;
  deleteTicket(ticketId: string): void;
  close(): void;
}

/** Used by tests and by `AGENT_OFFICE_PERSIST=0`: the office works, nothing is written. */
export class MemoryStore implements Store {
  loadAgents(): Agent[] {
    return [];
  }
  loadTickets(): Ticket[] {
    return [];
  }
  loadSessionIds(): Map<string, string> {
    return new Map();
  }
  saveAgent(): void {}
  saveAgentSession(): void {}
  deleteAgent(): void {}
  saveTicket(): void {}
  deleteTicket(): void {}
  close(): void {}
}

/** Default location: ~/.agent-office/office.db, or $AGENT_OFFICE_HOME/office.db. */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env["AGENT_OFFICE_HOME"] ?? join(homedir(), ".agent-office"), "office.db");
}

interface AgentRow {
  id: string;
  name: string;
  role: string;
  color: string;
  model: string | null;
  cwd: string;
  systemPrompt: string;
  allowedTools: string;
  permissionMode: string;
  uiMode: string;
  desk: number;
  createdAt: string;
  lastSessionId: string | null;
}

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  assignedAgentId: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A ticket's status only means something while the session working it is
 * alive. After a restart there is no session, so anything mid-flight goes back
 * to the backlog, unassigned — the ticket itself is never lost, it just has to
 * be handed out again. `done` and `backlog` are already stable and stay put.
 */
export function statusAfterRestart(status: TicketStatus): TicketStatus {
  return status === "assigned" || status === "in_progress" || status === "waiting" ? "backlog" : status;
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(path: string = defaultDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        model TEXT,
        cwd TEXT NOT NULL,
        systemPrompt TEXT NOT NULL DEFAULT '',
        allowedTools TEXT NOT NULL DEFAULT '[]',
        permissionMode TEXT NOT NULL,
        uiMode TEXT NOT NULL,
        desk INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        lastSessionId TEXT
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        assignedAgentId TEXT,
        sessionId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  loadAgents(): Agent[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY desk").all() as AgentRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      color: r.color,
      model: r.model,
      cwd: r.cwd,
      systemPrompt: r.systemPrompt,
      allowedTools: JSON.parse(r.allowedTools) as string[],
      permissionMode: r.permissionMode,
      uiMode: r.uiMode,
      desk: r.desk,
      createdAt: r.createdAt,
    })) as Agent[];
  }

  loadTickets(): Ticket[] {
    const rows = this.db.prepare("SELECT * FROM tickets ORDER BY createdAt").all() as TicketRow[];
    return rows.map((r) => {
      const status = statusAfterRestart(r.status as TicketStatus);
      const dropped = status !== r.status;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        status,
        assignedAgentId: dropped ? null : r.assignedAgentId,
        sessionId: dropped ? null : r.sessionId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      } as Ticket;
    });
  }

  loadSessionIds(): Map<string, string> {
    const rows = this.db.prepare("SELECT id, lastSessionId FROM agents WHERE lastSessionId IS NOT NULL").all() as Pick<
      AgentRow,
      "id" | "lastSessionId"
    >[];
    return new Map(rows.map((r) => [r.id, r.lastSessionId as string]));
  }

  saveAgent(agent: Agent): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, role, color, model, cwd, systemPrompt, allowedTools, permissionMode, uiMode, desk, createdAt)
         VALUES (@id, @name, @role, @color, @model, @cwd, @systemPrompt, @allowedTools, @permissionMode, @uiMode, @desk, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, role = excluded.role, color = excluded.color, model = excluded.model,
           cwd = excluded.cwd, systemPrompt = excluded.systemPrompt, allowedTools = excluded.allowedTools,
           permissionMode = excluded.permissionMode, uiMode = excluded.uiMode, desk = excluded.desk`,
      )
      .run({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        color: agent.color,
        model: agent.model ?? null,
        cwd: agent.cwd,
        systemPrompt: agent.systemPrompt,
        allowedTools: JSON.stringify(agent.allowedTools),
        permissionMode: agent.permissionMode,
        uiMode: agent.uiMode,
        desk: agent.desk,
        createdAt: agent.createdAt,
      });
  }

  saveAgentSession(agentId: string, sessionId: string | null): void {
    this.db.prepare("UPDATE agents SET lastSessionId = ? WHERE id = ?").run(sessionId, agentId);
  }

  deleteAgent(agentId: string): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  }

  saveTicket(ticket: Ticket): void {
    this.db
      .prepare(
        `INSERT INTO tickets (id, title, description, status, assignedAgentId, sessionId, createdAt, updatedAt)
         VALUES (@id, @title, @description, @status, @assignedAgentId, @sessionId, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description, status = excluded.status,
           assignedAgentId = excluded.assignedAgentId, sessionId = excluded.sessionId, updatedAt = excluded.updatedAt`,
      )
      .run({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        assignedAgentId: ticket.assignedAgentId,
        sessionId: ticket.sessionId,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      });
  }

  deleteTicket(ticketId: string): void {
    this.db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);
  }

  close(): void {
    this.db.close();
  }
}
