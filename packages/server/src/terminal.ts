import { EventEmitter } from "node:events";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { IPty } from "node-pty";
import { spawn as spawnPty } from "node-pty";
import type { FastifyInstance } from "fastify";
import type { Agent } from "@agent-office/shared";
import type { Office } from "./office.js";
import { agentEnv } from "./hooks.js";
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
export const DEFAULT_COLS = 100;
export const DEFAULT_ROWS = 30;

/**
 * node-pty emits a TUI repaint as dozens of tiny writes. Sending each as its
 * own WebSocket frame is what made the panel feel laggy; coalescing a few
 * milliseconds' worth into one frame costs nothing perceptible and collapses
 * a repaint into a single write on the client.
 */
const FLUSH_MS = 4;

/**
 * The flags a `claude` session for this agent needs. Shared by the in-app pty
 * and the native handoff in nativeTerminal.ts so the two cannot drift: an
 * agent must resume the same session with the same model either way.
 */
export function claudeArgsFor(agent: Agent, sessionId: string | null): string[] {
  const args: string[] = [];
  if (sessionId) args.push("--resume", sessionId);
  if (agent.model) args.push("--model", agent.model);
  if (agent.permissionMode) args.push("--permission-mode", agent.permissionMode);
  return args;
}

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
  /** emits "data" (chunk: string) with up to FLUSH_MS worth of coalesced pty output */
  emitter: EventEmitter;
  /** emit whatever is buffered right now, so nothing is lost on close */
  flush(): void;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface Batcher {
  push(chunk: string): void;
  flush(): void;
}

/**
 * Collects pty writes for a few milliseconds and hands them over as one
 * string. A TUI repaint is dozens of tiny writes; one WebSocket frame each is
 * what made the panel feel laggy.
 */
export function createBatcher(emit: (batch: string) => void, delayMs = FLUSH_MS): Batcher {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const batch = pending;
    pending = "";
    emit(batch);
  };

  return {
    push(chunk: string) {
      pending += chunk;
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
  };
}

/**
 * One pty per agent, spawned on first open() and kept alive across popup
 * open/close so reopening the panel replays history instead of restarting
 * the session. Killed only when the agent is fired.
 */
export class TerminalManager {
  private terminals = new Map<string, Terminal>();

  /** Open (or return the existing) terminal for an agent. */
  open(agent: Agent, sessionId: string | null, size?: TerminalSize): Terminal {
    const existing = this.terminals.get(agent.id);
    if (existing) return existing;
    const term = this.spawn(agent, sessionId, size);
    this.terminals.set(agent.id, term);
    return term;
  }

  /** True while a pty is alive for this agent; the native handoff needs to know. */
  has(agentId: string): boolean {
    return this.terminals.has(agentId);
  }

  private spawn(agent: Agent, sessionId: string | null, size?: TerminalSize): Terminal {
    const cwd = expandHome(agent.cwd);
    const ring = new RingBuffer();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);

    const claudeArgs = claudeArgsFor(agent, sessionId);

    // Spawn at the size the client already measured: starting at 100x30 and
    // resizing after connect makes Claude Code draw its whole UI twice.
    const ptyOpts = {
      name: "xterm-256color",
      cols: size?.cols ?? DEFAULT_COLS,
      rows: size?.rows ?? DEFAULT_ROWS,
      cwd,
      env: { ...agentEnv(agent.id), TERM: "xterm-256color" } as { [key: string]: string },
    };

    // No shell fallback: handing an unauthenticated socket an interactive
    // login shell turns "the terminal panel is blank" into arbitrary command
    // execution. Say what is wrong instead.
    if (!commandExists("claude")) {
      throw new Error("claude CLI not found on PATH — install it with: npm install -g @anthropic-ai/claude-code");
    }
    const pty: IPty = spawnPty("claude", claudeArgs, ptyOpts);

    const batcher = createBatcher((batch) => {
      ring.push(batch);
      emitter.emit("data", batch);
    });

    pty.onData((data) => batcher.push(data));
    pty.onExit(() => {
      batcher.flush();
      this.terminals.delete(agent.id);
    });

    return { agentId: agent.id, pty, ring, emitter, flush: batcher.flush };
  }

  close(agentId: string) {
    const term = this.terminals.get(agentId);
    if (!term) return;
    this.terminals.delete(agentId);
    term.flush();
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

/**
 * The client knows its real size before it connects, so it passes it on the
 * socket URL. Anything missing or nonsensical falls back to the defaults.
 */
export function sizeFromQuery(query: Record<string, string | undefined>): TerminalSize | undefined {
  const cols = Number(query["cols"]);
  const rows = Number(query["rows"]);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return undefined;
  return { cols, rows };
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
    const size = sizeFromQuery(req.query as Record<string, string | undefined>);

    // A pty that cannot spawn used to close the socket with no explanation:
    // the client reconnects forever against a permanently blank panel. Say
    // what happened in the terminal itself instead.
    let term: Terminal;
    try {
      term = manager.open(agent, state?.sessionId ?? null, size);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      socket.send(`could not open a terminal for ${agent.name}: ${detail}\r\n`);
      socket.send(`\r\nthis usually means node-pty's spawn-helper is not executable — run \`pnpm install\` again, or:\r\n`);
      socket.send(`  node scripts/fix-pty-permissions.mjs\r\n`);
      socket.close(1011, "pty spawn failed");
      return;
    }

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

    socket.on("close", () => {
      term.flush();
      term.emitter.off("data", onData);
    });
  });

  return manager;
}
