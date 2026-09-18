import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import { RingBuffer, registerTerminalRoutes, type TerminalManager } from "./terminal.js";

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
