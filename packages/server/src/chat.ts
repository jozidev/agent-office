import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { FastifyInstance } from "fastify";
import type { Agent } from "@agent-office/shared";
import type { Office } from "./office.js";
import { expandHome } from "./setup.js";

/**
 * Wire events sent to the UI over /ws/chat/:agentId, and produced by parsing
 * `claude -p --output-format stream-json --verbose` output. Self-contained:
 * does not share code or wire types with the milestone-3 ticket runner.
 */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "result"; costUsd: number }
  | { type: "error"; message: string }
  | { type: "closed" };

function summarizeToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return s.length > 90 ? `${s.slice(0, 87)}...` : s;
  } catch {
    return "";
  }
}

/**
 * Parses one line of `claude -p --output-format stream-json --verbose`
 * output into zero or more ChatEvents. Defensive: the format is
 * undocumented, so unknown shapes are ignored rather than thrown on.
 */
export function parseStreamJsonLine(line: string): ChatEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const events: ChatEvent[] = [];
  switch (obj["type"]) {
    case "system": {
      const sessionId = obj["session_id"];
      if (obj["subtype"] === "init" && typeof sessionId === "string") {
        events.push({ type: "session", sessionId });
      }
      break;
    }
    case "assistant": {
      const message = obj["message"] as { content?: unknown } | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b["type"] === "text" && typeof b["text"] === "string" && b["text"]) {
            events.push({ type: "text", text: b["text"] });
          } else if (b["type"] === "tool_use") {
            events.push({ type: "tool", name: typeof b["name"] === "string" ? b["name"] : "tool", summary: summarizeToolInput(b["input"]) });
          }
        }
      }
      break;
    }
    case "result": {
      const costUsd = obj["total_cost_usd"];
      events.push({ type: "result", costUsd: typeof costUsd === "number" ? costUsd : 0 });
      const sessionId = obj["session_id"];
      if (typeof sessionId === "string") events.push({ type: "session", sessionId });
      break;
    }
    default:
      // system status/init noise, stream_event deltas (we use the full
      // "assistant" message instead), rate_limit_event, etc. — ignored.
      break;
  }
  return events;
}

/**
 * Runs one headless `claude -p` turn per user message, resuming the same
 * Claude session on subsequent messages so the conversation continues.
 */
export class ChatManager {
  private sessions = new Map<string, string>();
  constructor(private opts: { claudeBin?: string } = {}) {}

  send(agent: Agent, text: string, onEvent: (e: ChatEvent) => void): Promise<void> {
    const cwd = expandHome(agent.cwd);
    const args = ["-p", text, "--output-format", "stream-json", "--verbose"];
    if (agent.model) args.push("--model", agent.model);
    if (agent.permissionMode) args.push("--permission-mode", agent.permissionMode);
    const resumeId = this.sessions.get(agent.id);
    if (resumeId) args.push("--resume", resumeId);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        onEvent({ type: "closed" });
        resolve();
      };

      let child;
      try {
        child = spawn(this.opts.claudeBin ?? "claude", args, { cwd });
      } catch {
        onEvent({ type: "error", message: "claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code" });
        finish();
        return;
      }

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        for (const e of parseStreamJsonLine(line)) {
          if (e.type === "session") this.sessions.set(agent.id, e.sessionId);
          onEvent(e);
        }
      });

      child.on("error", () => {
        onEvent({ type: "error", message: "claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code" });
        finish();
      });
      child.on("close", (code) => {
        if (code && code !== 0 && !settled) onEvent({ type: "error", message: `claude exited with code ${code}` });
        finish();
      });
    });
  }

  reset(agentId: string) {
    this.sessions.delete(agentId);
  }
}

interface ChatClientMessage {
  type?: string;
  text?: string;
}

/** Registers `/ws/chat/:agentId`. Call once from server.ts. */
export function registerChatRoutes(app: FastifyInstance, office: Office, opts: { manager?: ChatManager } = {}): ChatManager {
  const manager = opts.manager ?? new ChatManager();

  const unsubscribe = office.subscribe((m) => {
    if (m.type === "agent.removed") manager.reset(m.agentId);
  });
  app.addHook("onClose", async () => unsubscribe());

  app.get("/ws/chat/:agentId", { websocket: true }, (socket, req) => {
    const { agentId } = req.params as { agentId: string };
    const agent = office.snapshot().agents.find((a) => a.id === agentId);
    if (!agent) {
      socket.close(1008, "unknown agent");
      return;
    }

    const send = (e: ChatEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
    };

    let busy = false;
    socket.on("message", (raw) => {
      let msg: ChatClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== "message" || typeof msg.text !== "string" || !msg.text.trim()) return;
      if (busy) {
        send({ type: "error", message: "still working on the previous message" });
        return;
      }
      busy = true;
      void manager.send(agent, msg.text, send).finally(() => {
        busy = false;
      });
    });
  });

  return manager;
}
