import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { ClientMessage, type ServerMessage } from "@agent-office/shared";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import type { SessionRunner } from "./runner.js";
import { runSetupChecks } from "./setup.js";
import { hookToEvents, type HookPayload } from "./hooks.js";
import type { RunnerKind } from "./pickRunner.js";
import { registerTerminalRoutes, type TerminalManager } from "./terminal.js";
import { registerNativeTerminalRoutes } from "./nativeTerminal.js";
import { registerFsRoutes } from "./fsBrowse.js";
import { registerOpenPathRoutes } from "./openPath.js";
import { registerChangesRoutes } from "./changes.js";
import { registerChatRoutes } from "./chat.js";
import { MemoryStore, SETTINGS, SqliteStore, type Store } from "./store.js";
import { allowedHostPorts, allowedOrigins, isAllowedHost, isAllowedOrigin } from "./security.js";

export interface ServerOptions {
  runner?: SessionRunner;
  /** "cli" | "mock", purely informational — reported at /api/runner. Defaults to "mock" when runner is omitted, "cli" otherwise. */
  runnerKind?: RunnerKind;
  /** absolute path to built UI (index.html); served at / when present */
  uiDir?: string;
  seed?: boolean;
  /** true for Fastify's full request logging, false for silence, or a level object (the CLI uses `{ level: "warn" }` so errors still surface). */
  logger?: boolean | { level: string };
  /** port this server will listen on; used to build the hook/statusline URLs written into agents' .claude/settings.local.json. Hooks are not installed when omitted. */
  port?: number;
  /** Where agents and tickets are persisted. Defaults to SQLite under ~/.agent-office; pass a MemoryStore for a throwaway office. */
  store?: Store;
}

export async function createServer(opts: ServerOptions = {}) {
  const serverUrl = opts.port ? `http://127.0.0.1:${opts.port}` : undefined;
  const store = opts.store ?? (process.env.AGENT_OFFICE_PERSIST === "0" ? new MemoryStore() : new SqliteStore());
  const office = new Office(opts.runner ?? new MockRunner(), { serverUrl, store });
  const runnerKind: RunnerKind = opts.runnerKind ?? (opts.runner ? "cli" : "mock");

  const restored = office.restore();
  // Hooks carry this run's port, and the port can change between runs.
  if (restored.agents > 0) office.reinstallHooks();
  if (shouldSeed(opts.seed ?? false, runnerKind, process.env.SEED, restored.agents)) seed(office);

  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(websocket);

  // The trust boundary, applied once for both HTTP routes and WS upgrades: a
  // WebSocket upgrade is an ordinary GET, so onRequest sees it before
  // @fastify/websocket ever accepts the socket. See security.ts for why
  // loopback binding is not authorization.
  // No uiDir means Vite is serving the UI from its own port, not us.
  const dev = !opts.uiDir;
  const origins = allowedOrigins({ port: opts.port, dev, extra: process.env.AGENT_OFFICE_ALLOWED_ORIGINS });
  const hostPorts = allowedHostPorts({ port: opts.port, dev });
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/api/health") return;
    if (!isAllowedHost(req.headers.host, hostPorts)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!isAllowedOrigin(req.headers.origin, origins)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  if (opts.uiDir && existsSync(opts.uiDir)) {
    await app.register(fastifyStatic, { root: opts.uiDir, wildcard: false });
    app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/snapshot", async () => office.snapshot());
  app.get("/api/setup", async () => runSetupChecks(office.snapshot().agents, office.hookHits));
  app.get("/api/runner", async () => ({ runner: runnerKind }));

  const terminals = registerTerminalRoutes(app, office); // M4: /ws/terminal/:agentId (pty popup)
  registerNativeTerminalRoutes(app, office, terminals, store); // hand a session to the machine's real terminal
  registerFsRoutes(app); // folder picker for the hire form
  registerOpenPathRoutes(app); // open a file an agent wrote, from the log
  registerChangesRoutes(app, office); // what each agent has changed
  registerChatRoutes(app, office); // M4: /ws/chat/:agentId (chat-role agents)

  /** The hire form reopens its folder browser wherever you last hired from. */
  app.get("/api/settings", async () => ({ lastHireDir: store.getSetting(SETTINGS.lastHireDir) }));

  /** Claude Code hooks (SessionStart/PreToolUse/.../SessionEnd) POST here, one per event; see hooks.ts for the mapping. */
  app.post("/api/hook", async (req) => {
    office.hookHits += 1;
    const agentId = (req.query as Record<string, string>)?.["agent"];
    if (!agentId) return { ok: false, error: "missing agent" };
    const payload = (req.body ?? {}) as HookPayload;
    if (payload.hook_event_name === "SessionEnd") {
      office.forceIdle(agentId);
    } else {
      for (const e of hookToEvents(payload)) office.ingestExternal(agentId, e);
    }
    return { ok: true };
  });

  /** The statusLine forwarder POSTs its stdin JSON here; see hooks.ts statusLineCommand. */
  app.post("/api/statusline", async (req) => {
    const agentId = (req.query as Record<string, string>)?.["agent"];
    if (!agentId) return { ok: false, error: "missing agent" };
    office.ingestStatusline(agentId, req.body);
    return { ok: true };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const send = (m: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    send({ type: "snapshot", payload: office.snapshot() });
    const unsub = office.subscribe(send);

    socket.on("message", (raw) => {
      let parsed;
      try {
        parsed = ClientMessage.safeParse(JSON.parse(raw.toString()));
      } catch {
        return send({ type: "error", message: "invalid json" });
      }
      if (!parsed.success) return send({ type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") });
      const err = handle(office, parsed.data, store, terminals);
      if (err) send({ type: "error", message: err });
    });
    socket.on("close", unsub);
  });

  return { app, office };
}

function handle(office: Office, m: ClientMessage, store: Store, terminals: TerminalManager): string | undefined {
  switch (m.type) {
    case "hello":
      return;
    case "agent.hire":
      try {
        office.hire(m.payload);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      store.setSetting(SETTINGS.lastHireDir, m.payload.cwd);
      return;
    case "agent.fire":
      office.fire(m.agentId);
      return;
    case "agent.update": {
      const err = office.updateAgent(m.agentId, {
        ...(m.model !== undefined && { model: m.model }),
        ...(m.permissionMode !== undefined && { permissionMode: m.permissionMode }),
      });
      // --model and --permission-mode are baked in when the pty spawns, so the
      // terminal has to be restarted to pick them up. It respawns on the next
      // open with its history replayed from the ring buffer.
      if (!err) terminals.close(m.agentId);
      return err;
    }
    case "ticket.create":
      office.createTicket(m.title, m.description);
      return;
    case "ticket.update":
      office.updateTicket(m.ticketId, { ...(m.title !== undefined && { title: m.title }), ...(m.description !== undefined && { description: m.description }) });
      return;
    case "ticket.delete":
      office.deleteTicket(m.ticketId);
      return;
    case "ticket.assign":
      return office.assign(m.ticketId, m.agentId);
    case "ticket.move":
      office.moveTicket(m.ticketId, m.status);
      return;
    case "agent.respond":
      office.respond(m.agentId, m.text);
      return;
    case "session.stop":
      office.stopSession(m.agentId);
      return;
  }
}

/**
 * Demo data is for an empty office under the mock runner only. Under the real CLI runner the seeded
 * agents point at folders like ~/code/shop-api that don't exist on the user's
 * machine, and seed() assigns their tickets straight away — which means hook
 * config written into invented folders and a real `claude` spawned in a cwd
 * that isn't there. SEED=1 forces it anyway for deliberate demos.
 */
export function shouldSeed(seedRequested: boolean, runnerKind: RunnerKind, seedEnv: string | undefined, restoredAgents = 0): boolean {
  if (!seedRequested) return false;
  if (restoredAgents > 0) return false; // a real office was restored from disk; never bury it under demo data
  return runnerKind === "mock" || seedEnv === "1";
}

/** Demo data so the office is not empty on first run. */
export function seed(office: Office) {
  const ada = office.hire({ name: "Ada", role: "coder", cwd: "~/code/shop-api" });
  office.hire({ name: "Rex", role: "reviewer", cwd: "~/code/shop-api" });
  office.hire({ name: "Mia", role: "chat", cwd: "~/code/shop-api" });
  const bo = office.hire({ name: "Bo", role: "assistant", cwd: "~/Documents" });

  const t1 = office.createTicket("Add pagination to /orders", "Cursor-based, keep the old offset params working for a release.");
  office.createTicket("Review PR #482", "Cart merge on login.");
  const t3 = office.createTicket("Sort invoices by month", "Everything in Documents/invoices.");
  office.createTicket("Should we switch to Fastify?", "Write a short pros/cons.");
  office.assign(t1.id, ada.id);
  office.assign(t3.id, bo.id);
}
