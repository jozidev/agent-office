import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "@agent-office/shared";
import { hookToEvents, installHooks, MARKER, uninstallHooks } from "./hooks.js";

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
    model: "claude-sonnet-5",
    cwd,
    systemPrompt: "",
    allowedTools: [],
    permissionMode: "default",
    uiMode: "terminal",
    desk: 0,
    createdAt: new Date().toISOString(),
  };
}

const settingsFile = (cwd: string) => join(cwd, ".claude", "settings.local.json");

describe("installHooks / uninstallHooks", () => {
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
