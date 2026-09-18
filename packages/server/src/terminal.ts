import { EventEmitter } from "node:events";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { IPty } from "node-pty";
import { spawn as spawnPty } from "node-pty";
import type { FastifyInstance } from "fastify";
import type { Agent } from "@agent-office/shared";
import type { Office } from "./office.js";
import { expandHome } from "./setup.js";

/**
 * A pty always forks successfully on unix; a missing executable only fails
 * inside the child's execvp, which node-pty cannot report back as a JS
 * exception. So we check PATH ourselves before spawning.
 */
function commandExists(cmd: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      /* not here, keep looking */
    }
  }
  return false;
}

const RING_LIMIT = 64 * 1024; // 64KB
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

/** Keeps only the last N bytes seen; used to replay terminal history on (re)connect. */
export class RingBuffer {
  private buf = "";
  constructor(private limit = RING_LIMIT) {}

  push(chunk: string) {
    this.buf += chunk;
    if (this.buf.length > this.limit) this.buf = this.buf.slice(this.buf.length - this.limit);
  }

  get value(): string {
    return this.buf;
  }
}

export interface Terminal {
  agentId: string;
  pty: IPty;
  ring: RingBuffer;
  /** emits "data" (chunk: string) whenever the pty writes output */
  emitter: EventEmitter;
}

/**
 * One pty per agent, spawned on first open() and kept alive across popup
 * open/close so reopening the panel replays history instead of restarting
 * the session. Killed only when the agent is fired.
 */
export class TerminalManager {
  private terminals = new Map<string, Terminal>();

  /** Open (or return the existing) terminal for an agent. */
  open(agent: Agent, sessionId: string | null): Terminal {
    const existing = this.terminals.get(agent.id);
    if (existing) return existing;
    const term = this.spawn(agent, sessionId);
    this.terminals.set(agent.id, term);
    return term;
  }

  private spawn(agent: Agent, sessionId: string | null): Terminal {
    const cwd = expandHome(agent.cwd);
    const ring = new RingBuffer();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);

    const claudeArgs: string[] = [];
    if (sessionId) claudeArgs.push("--resume", sessionId);
    if (agent.model) claudeArgs.push("--model", agent.model);
    if (agent.permissionMode) claudeArgs.push("--permission-mode", agent.permissionMode);

    const ptyOpts = {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env: { ...process.env, TERM: "xterm-256color" } as { [key: string]: string },
    };

    let pty: IPty;
    if (commandExists("claude")) {
      pty = spawnPty("claude", claudeArgs, ptyOpts);
    } else {
      // `claude` is not on PATH: fall back to an interactive shell so the
      // popup is still useful, with a one-line notice explaining why.
      const shell = process.env.SHELL ?? "/bin/bash";
      pty = spawnPty(shell, [], ptyOpts);
      const notice = "claude CLI not found on PATH — opening a shell instead. Install with: npm install -g @anthropic-ai/claude-code\r\n\r\n";
      ring.push(notice);
    }

    pty.onData((data) => {
      ring.push(data);
      emitter.emit("data", data);
    });
    pty.onExit(() => {
      this.terminals.delete(agent.id);
    });

    return { agentId: agent.id, pty, ring, emitter };
  }

  close(agentId: string) {
    const term = this.terminals.get(agentId);
    if (!term) return;
    this.terminals.delete(agentId);
    try {
      term.pty.kill();
    } catch {
      /* already dead */
    }
  }

  closeAll() {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }
}

interface TerminalMessage {
  type?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

/** Registers `/ws/terminal/:agentId`. Call once from server.ts. */
export function registerTerminalRoutes(app: FastifyInstance, office: Office, opts: { manager?: TerminalManager } = {}): TerminalManager {
  const manager = opts.manager ?? new TerminalManager();

  // Kill the pty when the agent is fired; keep it alive on plain disconnects.
  const unsubscribe = office.subscribe((m) => {
    if (m.type === "agent.removed") manager.close(m.agentId);
  });
  app.addHook("onClose", async () => {
    unsubscribe();
    manager.closeAll();
  });

  app.get("/ws/terminal/:agentId", { websocket: true }, (socket, req) => {
    const { agentId } = req.params as { agentId: string };
    const agent = office.snapshot().agents.find((a) => a.id === agentId);
    if (!agent) {
      socket.close(1008, "unknown agent");
      return;
    }
    const state = office.snapshot().states.find((s) => s.agentId === agentId);
    const term = manager.open(agent, state?.sessionId ?? null);

    if (term.ring.value) socket.send(term.ring.value);

    const onData = (chunk: string) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    };
    term.emitter.on("data", onData);

    socket.on("message", (raw) => {
      let msg: TerminalMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        term.pty.write(msg.data);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        try {
          term.pty.resize(msg.cols, msg.rows);
        } catch {
          /* ignore resize races with pty exit */
        }
      }
    });

    socket.on("close", () => term.emitter.off("data", onData));
  });

  return manager;
}
