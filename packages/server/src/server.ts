import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { ClientMessage, type ServerMessage } from "@agent-office/shared";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import type { SessionRunner } from "./runner.js";
import { runSetupChecks } from "./setup.js";

export interface ServerOptions {
  runner?: SessionRunner;
  /** absolute path to built UI (index.html); served at / when present */
  uiDir?: string;
  seed?: boolean;
  logger?: boolean;
}

export async function createServer(opts: ServerOptions = {}) {
  const office = new Office(opts.runner ?? new MockRunner());
  if (opts.seed) seed(office);

  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(websocket);

  if (opts.uiDir && existsSync(opts.uiDir)) {
    await app.register(fastifyStatic, { root: opts.uiDir, wildcard: false });
    app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/snapshot", async () => office.snapshot());
  app.get("/api/setup", async () => runSetupChecks(office.snapshot().agents));

  /** Claude Code hooks POST here (M3). Accepted now so hook config can be written early. */
  app.post("/api/hook", async (req) => {
    app.log.debug({ hook: req.body }, "hook");
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
      const err = handle(office, parsed.data);
      if (err) send({ type: "error", message: err });
    });
    socket.on("close", unsub);
  });

  return { app, office };
}

function handle(office: Office, m: ClientMessage): string | undefined {
  switch (m.type) {
    case "hello":
      return;
    case "agent.hire":
      office.hire(m.payload);
      return;
    case "agent.fire":
      office.fire(m.agentId);
      return;
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

/** Demo data so the office is not empty on first run. */
export function seed(office: Office) {
  const ada = office.hire({ name: "Ada", role: "coder", cwd: "~/code/shop-api" });
  office.hire({ name: "Rex", role: "reviewer", cwd: "~/code/shop-api" });
  office.hire({ name: "Mia", role: "chat", cwd: "~" });
  const bo = office.hire({ name: "Bo", role: "assistant", cwd: "~/Documents" });

  const t1 = office.createTicket("Add pagination to /orders", "Cursor-based, keep the old offset params working for a release.");
  office.createTicket("Review PR #482", "Cart merge on login.");
  const t3 = office.createTicket("Sort invoices by month", "Everything in Documents/invoices.");
  office.createTicket("Should we switch to Fastify?", "Write a short pros/cons.");
  office.assign(t1.id, ada.id);
  office.assign(t3.id, bo.id);
}
