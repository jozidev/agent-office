import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import type { Agent } from "@agent-office/shared";
import { RingBuffer, claudeArgsFor, createBatcher, registerTerminalRoutes, sizeFromQuery, type TerminalManager } from "./terminal.js";

describe("RingBuffer", () => {
  it("returns everything pushed while under the limit", () => {
    const ring = new RingBuffer(1024);
    ring.push("hello ");
    ring.push("world");
    expect(ring.value).toBe("hello world");
  });

  it("keeps only the last N bytes once over the limit", () => {
    const ring = new RingBuffer(10);
    ring.push("0123456789"); // exactly at the limit
    expect(ring.value).toBe("0123456789");
    ring.push("ABC"); // pushes it over
    expect(ring.value).toBe("3456789ABC");
    expect(ring.value.length).toBe(10);
  });

  it("trims correctly across many small pushes", () => {
    const ring = new RingBuffer(5);
    for (const ch of "abcdefghij") ring.push(ch);
    expect(ring.value).toBe("fghij");
  });

  it("starts empty", () => {
    const ring = new RingBuffer();
    expect(ring.value).toBe("");
  });
});

/**
 * When node-pty cannot spawn (its spawn-helper arrives without the executable
 * bit, which is what pnpm 10 does on macOS), the socket used to close with no
 * payload and the client reconnected forever against a blank panel.
 */
describe("terminal route when the pty cannot spawn", () => {
  it("explains the failure in the terminal instead of closing silently", async () => {
    const office = new Office(new MockRunner());
    const agent = office.hire({ name: "Nyx", role: "coder", cwd: process.cwd() });

    const app = Fastify({ logger: false });
    await app.register(websocket);
    const throwing = {
      open: () => {
        throw new Error("posix_spawnp failed.");
      },
      close: () => {},
      closeAll: () => {},
    } as unknown as TerminalManager;
    registerTerminalRoutes(app, office, { manager: throwing });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };

    const received: string[] = [];
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/${agent.id}`);
      ws.onmessage = (e) => received.push(String(e.data));
      ws.onclose = (e) => resolve(e.code);
      ws.onerror = () => reject(new Error("socket errored"));
      setTimeout(() => reject(new Error("timed out")), 5000);
    });

    await app.close();
    const text = received.join("");
    expect(text).toContain("could not open a terminal for Nyx");
    expect(text).toContain("posix_spawnp failed.");
    expect(text).toContain("fix-pty-permissions.mjs");
    expect(closeCode).toBe(1011);
  });
});

describe("sizeFromQuery", () => {
  it("uses the size the client measured before connecting", () => {
    expect(sizeFromQuery({ cols: "142", rows: "48" })).toEqual({ cols: 142, rows: 48 });
  });

  it("falls back to the defaults for anything missing or nonsensical", () => {
    expect(sizeFromQuery({})).toBeUndefined();
    expect(sizeFromQuery({ cols: "80" })).toBeUndefined();
    expect(sizeFromQuery({ cols: "abc", rows: "24" })).toBeUndefined();
    expect(sizeFromQuery({ cols: "0", rows: "0" })).toBeUndefined();
    expect(sizeFromQuery({ cols: "80.5", rows: "24" })).toBeUndefined();
  });
});

describe("claudeArgsFor", () => {
  const base = { id: "a", name: "Ada", role: "coder", color: "#fff", cwd: "/tmp", systemPrompt: "", allowedTools: [], uiMode: "terminal", desk: 0, createdAt: "" };

  it("resumes with the agent's model and permission mode", () => {
    const agent = { ...base, model: "claude-opus-5", permissionMode: "acceptEdits" } as Agent;
    expect(claudeArgsFor(agent, "sess-1")).toEqual([
      "--resume",
      "sess-1",
      "--model",
      "claude-opus-5",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("omits --resume for an agent that has no session yet", () => {
    const agent = { ...base, model: "claude-opus-5", permissionMode: "manual" } as Agent;
    expect(claudeArgsFor(agent, null)).toEqual(["--model", "claude-opus-5", "--permission-mode", "manual"]);
  });
});

describe("createBatcher", () => {
  it("coalesces the many small writes of a TUI repaint into one frame", async () => {
    const frames: string[] = [];
    const batcher = createBatcher((b) => frames.push(b), 4);
    for (const chunk of ["\x1b[H", "hello", " ", "world", "\x1b[K"]) batcher.push(chunk);

    expect(frames).toEqual([]); // nothing sent yet — still collecting
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toEqual(["\x1b[Hhello world\x1b[K"]);
  });

  it("starts a new frame once the previous one has gone out", async () => {
    const frames: string[] = [];
    const batcher = createBatcher((b) => frames.push(b), 4);
    batcher.push("first");
    await new Promise((r) => setTimeout(r, 20));
    batcher.push("second");
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toEqual(["first", "second"]);
  });

  it("flushes pending output immediately, so closing loses nothing", () => {
    const frames: string[] = [];
    const batcher = createBatcher((b) => frames.push(b), 1000);
    batcher.push("half-written line");
    batcher.flush();
    expect(frames).toEqual(["half-written line"]);
  });

  it("does not emit an empty frame when there is nothing pending", () => {
    const frames: string[] = [];
    const batcher = createBatcher((b) => frames.push(b), 4);
    batcher.flush();
    batcher.flush();
    expect(frames).toEqual([]);
  });
});
