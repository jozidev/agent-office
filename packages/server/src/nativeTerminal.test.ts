import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { Agent } from "@agent-office/shared";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import { MemoryStore, SETTINGS } from "./store.js";
import type { TerminalManager } from "./terminal.js";
import { buildCommand, detectTerminals, registerNativeTerminalRoutes, resolveTerminal, writeLaunchScript } from "./nativeTerminal.js";

const MAC_APPS = new Set(["/Applications/iTerm.app", "/System/Applications/Utilities/Terminal.app"]);

/** A machine with iTerm and Terminal.app installed and nothing else. */
const mac = { platform: "darwin" as const, env: { PATH: "/usr/bin" }, fileExists: (p: string) => MAC_APPS.has(p) };

/** A linux box with nothing graphical on it — over SSH, or a container. */
const bareLinux = { platform: "linux" as const, env: { PATH: "/usr/bin" }, fileExists: () => false };

describe("detectTerminals", () => {
  it("finds every installed terminal, not just the first", () => {
    expect(detectTerminals(mac).map((a) => a.id)).toEqual(["iterm", "terminal"]);
  });

  it("promotes the terminal the office was launched from", () => {
    const ids = detectTerminals({ ...mac, env: { ...mac.env, TERM_PROGRAM: "Apple_Terminal" } }).map((a) => a.id);
    expect(ids[0]).toBe("terminal");
  });

  it("finds terminals on PATH, not only .app bundles", () => {
    const ids = detectTerminals({
      platform: "linux",
      env: { PATH: "/usr/bin" },
      fileExists: (p) => p === "/usr/bin/gnome-terminal",
    }).map((a) => a.id);
    expect(ids).toEqual(["gnome-terminal"]);
  });

  it("comes back empty on a machine with no GUI terminal at all", () => {
    expect(detectTerminals(bareLinux)).toEqual([]);
  });

  it("always finds Terminal.app on macOS, so a Mac is never left without one", () => {
    const onlyStock = { ...mac, fileExists: (p: string) => p === "/System/Applications/Utilities/Terminal.app" };
    expect(detectTerminals(onlyStock).map((a) => a.id)).toEqual(["terminal"]);
  });
});

describe("resolveTerminal", () => {
  it("uses the saved choice", () => {
    expect(resolveTerminal("terminal", mac).selected?.id).toBe("terminal");
  });

  it("lets the saved choice beat the env var, so picking in the UI actually sticks", () => {
    const env = { ...mac.env, AGENT_OFFICE_TERMINAL_APP: "iterm" };
    expect(resolveTerminal("terminal", { ...mac, env }).selected?.id).toBe("terminal");
  });

  it("falls back to the env var when nothing has been picked yet", () => {
    const env = { ...mac.env, AGENT_OFFICE_TERMINAL_APP: "terminal" };
    expect(resolveTerminal(null, { ...mac, env }).selected?.id).toBe("terminal");
  });

  it("falls through and says so when the saved app has been uninstalled", () => {
    const res = resolveTerminal("ghostty", mac);
    expect(res.selected?.id).toBe("iterm");
    expect(res.substituted).toBe(true);
  });

  it("selects nothing when the machine has no terminal", () => {
    const res = resolveTerminal(null, bareLinux);
    expect(res.selected).toBeNull();
    expect(res.available).toEqual([]);
  });
});

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    name: "Ada",
    role: "coder",
    color: "#fff",
    model: "claude-opus-5",
    cwd: "/tmp/project",
    systemPrompt: "",
    allowedTools: [],
    permissionMode: "acceptEdits",
    uiMode: "terminal",
    desk: 0,
    createdAt: "",
    ...over,
  }) as Agent;

describe("buildCommand", () => {
  it("resumes the session with the agent's model and permissions", () => {
    expect(buildCommand(agent(), "sess-1")).toBe(
      "cd '/tmp/project' && claude '--resume' 'sess-1' '--model' 'claude-opus-5' '--permission-mode' 'acceptEdits'",
    );
  });

  it("quotes a folder with spaces in it", () => {
    expect(buildCommand(agent({ cwd: "/tmp/my projects/app" }), null)).toContain("cd '/tmp/my projects/app'");
  });

  it("expands ~ so the command works outside a shell that would", () => {
    expect(buildCommand(agent({ cwd: "~/code" }), null)).not.toContain("~");
  });
});

describe("writeLaunchScript", () => {
  it("writes an executable shell script the terminal app can open", () => {
    const path = writeLaunchScript("cd '/tmp' && claude", "a1", "darwin");
    expect(path.endsWith(".command")).toBe(true);
  });

  it("writes a .cmd batch file on Windows", () => {
    expect(writeLaunchScript("cd /tmp", "a1", "win32").endsWith(".cmd")).toBe(true);
  });
});

describe("native handoff route", () => {
  async function serve(deps: Parameters<typeof registerNativeTerminalRoutes>[4], store = new MemoryStore()) {
    const office = new Office(new MockRunner(), { store, roots: ["/"] });
    const hired = office.hire({ name: "Ada", role: "coder", cwd: "/tmp" });
    const closed: string[] = [];
    const manager = { close: (id: string) => closed.push(id) } as unknown as TerminalManager;
    const app = Fastify({ logger: false });
    registerNativeTerminalRoutes(app, office, manager, store, deps);
    return { app, agentId: hired.id, closed, store };
  }

  it("reports what is installed and which one would open", async () => {
    const launched: [string, string[]][] = [];
    const { app, agentId } = await serve({ ...mac, launch: (c, a) => launched.push([c, a]) });
    const res = await app.inject({ url: `/api/terminal/${agentId}/native` });
    const body = res.json();
    expect(body.supported).toBe(true);
    expect(body.selected.id).toBe("iterm");
    expect(body.available.map((a: { id: string }) => a.id)).toEqual(["iterm", "terminal"]);
    expect(body.command).toContain("claude");
  });

  it("releases the in-app pty, because Claude Code will not resume one session twice", async () => {
    const launched: [string, string[]][] = [];
    const { app, agentId, closed } = await serve({ ...mac, launch: (c, a) => launched.push([c, a]) });
    const res = await app.inject({ method: "POST", url: `/api/terminal/${agentId}/native` });
    expect(res.statusCode).toBe(200);
    expect(closed).toEqual([agentId]);
    expect(launched[0]![0]).toBe("open");
    expect(launched[0]![1].slice(0, 2)).toEqual(["-a", "/Applications/iTerm.app"]);
  });

  it("hands back the command to paste when the machine has no terminal", async () => {
    const { app, agentId } = await serve({ ...bareLinux, launch: () => {} });
    const get = await app.inject({ url: `/api/terminal/${agentId}/native` });
    expect(get.json().supported).toBe(false);
    expect(get.json().command).toContain("claude");

    const post = await app.inject({ method: "POST", url: `/api/terminal/${agentId}/native` });
    expect(post.statusCode).toBe(422);
    expect(post.json().command).toContain("claude");
  });

  it("remembers the terminal you pick", async () => {
    const saved: Record<string, string> = {};
    const store = Object.assign(new MemoryStore(), {
      getSetting: (k: string) => saved[k] ?? null,
      setSetting: (k: string, v: string) => void (saved[k] = v),
    });
    const { app, agentId } = await serve({ ...mac, launch: () => {} }, store);

    await app.inject({ method: "POST", url: "/api/settings/terminalApp", payload: { id: "terminal" } });
    expect(saved[SETTINGS.terminalApp]).toBe("terminal");
    const res = await app.inject({ url: `/api/terminal/${agentId}/native` });
    expect(res.json().selected.id).toBe("terminal");
  });

  it("refuses to save a terminal that is not installed", async () => {
    const { app } = await serve({ ...mac, launch: () => {} });
    const res = await app.inject({ method: "POST", url: "/api/settings/terminalApp", payload: { id: "ghostty" } });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * Launching a terminal on Windows needs `start`, a cmd builtin, and `cmd /c`
 * re-expands &, |, ^, <, > and %VAR% out of arguments Node already quoted.
 * The script name is ours, but the temp folder it sits in is not.
 */
describe("writeLaunchScript on Windows", () => {
  it("refuses a temp folder cmd.exe would reinterpret", () => {
    const original = process.env["TMPDIR"];
    process.env["TMPDIR"] = "/tmp/evil&calc/";
    try {
      expect(() => writeLaunchScript("cd /tmp", "a1", "win32")).toThrow(/reinterpret/);
    } finally {
      if (original === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = original;
    }
  });

  it("leaves other platforms alone — /bin/sh does not re-parse an argv element", () => {
    const original = process.env["TMPDIR"];
    process.env["TMPDIR"] = "/tmp/odd&name/";
    try {
      expect(() => writeLaunchScript("cd /tmp", "a1", "darwin")).not.toThrow();
    } finally {
      if (original === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = original;
    }
  });
});
