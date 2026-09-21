import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "@agent-office/shared";
import { AGENT_ENV_VAR, agentEnv, hookToEvents, installHooks, MARKER, uninstallHooks } from "./hooks.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-office-hooks-"));
});

function agentAt(cwd: string): Agent {
  return {
    id: "a1",
    name: "Ada",
    role: "coder",
    color: "#fff",
    runtime: "claude",
    model: "claude-sonnet-5",
    cwd,
    systemPrompt: "",
    allowedTools: [],
    permissionMode: "manual",
    uiMode: "terminal",
    desk: 0,
    createdAt: new Date().toISOString(),
  };
}

const settingsFile = (cwd: string) => join(cwd, ".claude", "settings.local.json");

describe("installHooks / uninstallHooks", () => {
  it("refuses a working folder that does not exist instead of creating it", async () => {
    const missing = join(dir, "not", "created", "yet");
    await expect(installHooks(agentAt(missing), "http://127.0.0.1:4177")).rejects.toThrow(/working folder does not exist/);
    await expect(stat(missing)).rejects.toThrow();
  });

  it("writes hooks for every documented event plus a statusLine, all marked", async () => {
    const agent = agentAt(dir);
    await installHooks(agent, "http://127.0.0.1:4177");
    const settings = JSON.parse(await readFile(settingsFile(dir), "utf8"));
    for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "SubagentStop", "Stop", "SessionEnd", "Notification"]) {
      expect(settings.hooks[event]).toBeDefined();
      expect(settings.hooks[event][0].hooks[0].command).toContain(MARKER);
      expect(settings.hooks[event][0].hooks[0].command).toContain("/api/hook?agent=a1");
    }
    expect(settings.statusLine.command).toContain(MARKER);
    expect(settings.statusLine.command).toContain("/api/statusline?agent=a1");
  });

  it("merges into an existing settings file without touching foreign hooks or a foreign statusLine", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    const foreign = {
      someOtherTopLevelKey: "keep me",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo not ours" }] }],
      },
      statusLine: { type: "command", command: "echo my custom statusline" },
    };
    await writeFile(settingsFile(dir), JSON.stringify(foreign, null, 2));

    const agent = agentAt(dir);
    await installHooks(agent, "http://127.0.0.1:4177");
    const settings = JSON.parse(await readFile(settingsFile(dir), "utf8"));

    expect(settings.someOtherTopLevelKey).toBe("keep me");
    // foreign PreToolUse group survives alongside ours
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse.some((g: { hooks: { command: string }[] }) => g.hooks[0]!.command === "echo not ours")).toBe(true);
    expect(settings.hooks.PreToolUse.some((g: { hooks: { command: string }[] }) => g.hooks[0]!.command.includes(MARKER))).toBe(true);
    // a foreign statusLine is never clobbered
    expect(settings.statusLine.command).toBe("echo my custom statusline");
  });

  it("uninstallHooks removes only our entries, keeping foreign ones and dropping empty event arrays", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    const foreign = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo not ours" }] }],
      },
    };
    await writeFile(settingsFile(dir), JSON.stringify(foreign, null, 2));
    const agent = agentAt(dir);
    await installHooks(agent, "http://127.0.0.1:4177");
    await uninstallHooks(agent);
    const settings = JSON.parse(await readFile(settingsFile(dir), "utf8"));

    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("echo not ours");
    // events that had only our group are gone entirely, not left as []
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(settings.statusLine).toBeUndefined();
  });

  it("uninstallHooks on a settings file that never had our hooks is a safe no-op", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    const foreign = { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo mine" }] }] } };
    await writeFile(settingsFile(dir), JSON.stringify(foreign, null, 2));
    await uninstallHooks(agentAt(dir));
    const settings = JSON.parse(await readFile(settingsFile(dir), "utf8"));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("echo mine");
  });
});

describe("hookToEvents", () => {
  it("maps SessionStart to started", () => {
    expect(hookToEvents({ hook_event_name: "SessionStart", session_id: "s1" })).toEqual([{ kind: "started", sessionId: "s1" }]);
  });

  it("maps PreToolUse for a normal tool to tool_use with a short summary", () => {
    const events = hookToEvents({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
    expect(events).toEqual([{ kind: "tool_use", name: "Edit", summary: "src/a.ts" }]);
  });

  it("maps PreToolUse for Agent/Task to subagent_start", () => {
    const events = hookToEvents({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_use_id: "toolu_1",
      tool_input: { description: "explore" },
    });
    expect(events).toEqual([{ kind: "subagent_start", id: "toolu_1", type: "general-purpose", description: "explore" }]);
  });

  it("maps PreToolUse with an agent_id (inside a subagent) to subagent_tool", () => {
    const events = hookToEvents({ hook_event_name: "PreToolUse", tool_name: "Bash", agent_id: "sub1", tool_input: { command: "ls" } });
    expect(events).toEqual([{ kind: "subagent_tool", id: "sub1", name: "Bash", summary: "ls" }]);
  });

  it("maps PostToolUse to thinking", () => {
    expect(hookToEvents({ hook_event_name: "PostToolUse" })).toEqual([{ kind: "thinking" }]);
  });

  it("maps SubagentStop to subagent_stop with whatever id is available", () => {
    expect(hookToEvents({ hook_event_name: "SubagentStop", agent_id: "sub1" })).toEqual([{ kind: "subagent_stop", id: "sub1" }]);
    expect(hookToEvents({ hook_event_name: "SubagentStop" })).toEqual([{ kind: "subagent_stop", id: "" }]);
  });

  it("maps a Notification with a message to waiting", () => {
    expect(hookToEvents({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Allow Bash?" })).toEqual([
      { kind: "waiting", prompt: "Allow Bash?" },
    ]);
  });

  it("maps Stop to done", () => {
    expect(hookToEvents({ hook_event_name: "Stop" })).toEqual([{ kind: "done", summary: "turn finished" }]);
  });

  it("ignores unknown hook event names", () => {
    expect(hookToEvents({ hook_event_name: "SomeFutureEvent" })).toEqual([]);
  });
});

/**
 * Hooks live in the agent's project folder, so they fire for every Claude Code
 * session run there — including the user's own. Observed before this guard:
 * a developer's tool calls in their own repo showed up in an agent's log,
 * attributed to the agent.
 */
describe("hooks only report for the session the office started", () => {
  const agentFor = (cwd: string): Agent =>
    ({
      id: "a1",
      name: "Ada",
      role: "coder",
      color: "#fff",
      runtime: "claude",
      model: "claude-opus-5",
      cwd,
      systemPrompt: "",
      allowedTools: [],
      permissionMode: "manual",
      uiMode: "terminal",
      desk: 0,
      createdAt: "",
    }) as Agent;

  /**
   * A stub `curl` that records being called, so the assertion is "did it try
   * to post" rather than "did a server receive something" — no sockets, no
   * timers, nothing left open.
   */
  function stubCurl(): { bin: string; calls: () => number } {
    const bin = mkdtempSync(join(tmpdir(), "agent-office-bin-"));
    const log = join(bin, "calls.log");
    writeFileSync(join(bin, "curl"), `#!/bin/sh\necho called >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
    chmodSync(join(bin, "curl"), 0o755);
    return {
      bin,
      calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0),
    };
  }

  /** Runs a hook command under /bin/sh with a given env, as Claude Code would. */
  function runHook(command: string, agentEnvValue: string, bin: string) {
    return spawnSync("/bin/sh", ["-c", command], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" }),
      env: { ...process.env, AGENT_OFFICE_AGENT: agentEnvValue, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      encoding: "utf8",
      timeout: 10_000,
    });
  }

  async function hookCommandFor(dir: string): Promise<string> {
    await installHooks(agentFor(dir), "http://127.0.0.1:9");
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    return settings.hooks.PreToolUse[0].hooks[0].command as string;
  }

  it("exits 0 without posting for a session that is not this agent's", async () => {
    const command = await hookCommandFor(mkdtempSync(join(tmpdir(), "agent-office-guard-")));
    const curl = stubCurl();

    // The user's own Claude Code session in the same repo.
    expect(runHook(command, "", curl.bin).status).toBe(0);
    // A different agent of the same office, working in the same repo.
    expect(runHook(command, "b2", curl.bin).status).toBe(0);
    expect(curl.calls()).toBe(0);
  });

  it("still posts for the session the office spawned", async () => {
    const command = await hookCommandFor(mkdtempSync(join(tmpdir(), "agent-office-guard-")));
    const curl = stubCurl();
    expect(runHook(command, "a1", curl.bin).status).toBe(0);
    expect(curl.calls()).toBe(1);
  });

  it("keeps the marker, so uninstall still finds the guarded command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-office-guard-"));
    await installHooks(agentFor(dir), "http://127.0.0.1:9");
    const before = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(before.hooks.Stop[0].hooks[0].command).toContain(MARKER);
    expect(before.statusLine.command).toContain(MARKER);

    await uninstallHooks(agentFor(dir));
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks).toBeUndefined();
    expect(after.statusLine).toBeUndefined();
  });

  it("gates the statusline POST but still prints a status bar for anyone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-office-guard-"));
    await installHooks(agentFor(dir), "http://127.0.0.1:9");
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));

    // A foreign session keeps its status bar; the office just hears nothing.
    const foreign = spawnSync("/bin/sh", ["-c", settings.statusLine.command as string], {
      input: JSON.stringify({ model: { display_name: "Opus 5" } }),
      env: { ...process.env, AGENT_OFFICE_AGENT: "someone-else" },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(foreign.status).toBe(0);
    expect(foreign.stdout.trim()).toBe("[Opus 5]");
  });

  it("puts the agent id in the environment of a session the office spawns", () => {
    expect(agentEnv("a1")[AGENT_ENV_VAR]).toBe("a1");
    expect(agentEnv("a1", { PATH: "/usr/bin" })).toMatchObject({ PATH: "/usr/bin", [AGENT_ENV_VAR]: "a1" });
  });
});
