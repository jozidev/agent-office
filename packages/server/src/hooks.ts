import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Agent, RunnerEvent } from "@agent-office/shared";
import { expandHome } from "./setup.js";

/**
 * Installs Claude Code hooks (docs: https://code.claude.com/docs/en/hooks)
 * and a statusLine forwarder (docs: https://code.claude.com/docs/en/statusline)
 * into an agent's project settings, so both headless (`claude -p`) and
 * interactive (`claude --resume`, terminal) sessions report their status
 * back to this server. Everything we write is marked with MARKER so it can
 * be found and removed later without touching anything a person configured
 * by hand.
 */
export const MARKER = "agent-office";

const HOOK_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "SubagentStop", "Stop", "SessionEnd", "Notification"] as const;

interface HookHandler {
  type: string;
  command: string;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}
interface StatusLine {
  type: string;
  command: string;
  [k: string]: unknown;
}
interface SettingsFile {
  hooks?: Record<string, HookGroup[]>;
  statusLine?: StatusLine;
  [k: string]: unknown;
}

function settingsPath(agent: Agent): string {
  return join(expandHome(agent.cwd), ".claude", "settings.local.json");
}

/** curl reads the hook's JSON off stdin and POSTs it verbatim; the event name travels inside that JSON (hook_event_name), so one command works for every event. */
function hookCommand(serverUrl: string, agentId: string): string {
  const url = `${serverUrl}/api/hook?agent=${encodeURIComponent(agentId)}`;
  return `curl -s -X POST -H 'content-type: application/json' --data-binary @- '${url}' >/dev/null 2>&1 # ${MARKER}`;
}

/**
 * Forwards the statusline JSON to the server AND still prints something to
 * the terminal's status bar. `node` is guaranteed on PATH (Claude Code
 * itself needs it), so we do both the read and the POST in one `node -e`
 * instead of relying on bash-specific tricks like `tee >(...)`.
 */
function statusLineCommand(serverUrl: string, agentId: string): string {
  const url = `${serverUrl}/api/statusline?agent=${encodeURIComponent(agentId)}`;
  const script = [
    "let d='';",
    "process.stdin.on('data',c=>d+=c);",
    "process.stdin.on('end',()=>{",
    "let m='agent';",
    "try{const j=JSON.parse(d);m=(j.model&&j.model.display_name)||m;}catch(e){}",
    `try{const u=new URL(${JSON.stringify(url)});const req=require(u.protocol==='https:'?'https':'http').request(u,{method:'POST',headers:{'content-type':'application/json'}});req.on('error',()=>{});req.end(d);}catch(e){}`,
    "console.log('['+m+']');",
    "});",
  ].join("");
  return `node -e ${JSON.stringify(script)} # ${MARKER}`;
}

async function readSettings(path: string): Promise<SettingsFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SettingsFile) : {};
  } catch {
    return {}; // missing file or invalid JSON: start fresh, still never touching anything else
  }
}

async function writeSettings(path: string, settings: SettingsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * Writes/merges `<agent cwd>/.claude/settings.local.json`: one hook group
 * per event (SessionStart, PreToolUse, PostToolUse, SubagentStop, Stop,
 * SessionEnd, Notification) plus a statusLine. Existing hook groups and a
 * foreign statusLine (one we didn't write) are left untouched — we only
 * ever add our own group, or replace a statusLine that is already ours.
 */
export async function installHooks(agent: Agent, serverUrl: string): Promise<void> {
  // The agent's folder must already exist. mkdir(recursive) below would happily
  // invent the whole path, so a typo in the hire form would scatter .claude
  // folders across the user's disk instead of failing visibly.
  const cwd = expandHome(agent.cwd);
  const dir = await stat(cwd).catch(() => null);
  if (!dir?.isDirectory()) throw new Error(`working folder does not exist: ${cwd}`);

  const path = settingsPath(agent);
  const settings = await readSettings(path);
  const hooks = { ...(settings.hooks ?? {}) };
  const ourGroup: HookGroup = { matcher: "", hooks: [{ type: "command", command: hookCommand(serverUrl, agent.id) }] };
  for (const event of HOOK_EVENTS) {
    const existing = (hooks[event] ?? []).filter((g) => !g.hooks.every((h) => h.command.includes(MARKER)));
    hooks[event] = [...existing, ourGroup];
  }
  settings.hooks = hooks;
  if (!settings.statusLine || settings.statusLine.command.includes(MARKER)) {
    settings.statusLine = { type: "command", command: statusLineCommand(serverUrl, agent.id) };
  }
  await writeSettings(path, settings);
}

/** Removes only what installHooks wrote (matched by MARKER); never touches anything else. */
export async function uninstallHooks(agent: Agent): Promise<void> {
  const path = settingsPath(agent);
  const settings = await readSettings(path);
  if (settings.hooks) {
    const hooks: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const kept = groups
        .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !h.command.includes(MARKER)) }))
        .filter((g) => g.hooks.length > 0);
      if (kept.length > 0) hooks[event] = kept;
    }
    settings.hooks = hooks;
    if (Object.keys(hooks).length === 0) delete settings.hooks;
  }
  if (settings.statusLine?.command.includes(MARKER)) delete settings.statusLine;
  await writeSettings(path, settings);
}

// ---------- hook event -> RunnerEvent mapping (used by the /api/hook route) ----------

/**
 * Loose shape of one hook's stdin JSON, per https://code.claude.com/docs/en/hooks.
 * Common fields: session_id, hook_event_name, cwd, transcript_path, agent_id
 * (subagent hooks only). Tool events add tool_name/tool_input/tool_use_id.
 * Notification adds notification_type/message. Stop/SubagentStop add
 * last_assistant_message. Every field is optional: hook payloads vary by
 * event and by CLI version, and this must never throw on an unexpected one.
 */
export interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  agent_id?: string;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
}

function summarizeToolInput(input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const pick = i["file_path"] ?? i["path"] ?? i["command"] ?? i["pattern"] ?? i["url"] ?? i["description"] ?? i["prompt"];
  const s = typeof pick === "string" ? pick : JSON.stringify(i);
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

/**
 * Maps one hook payload to zero or more RunnerEvents, mirroring what the CLI
 * parser (cliRunner.ts) infers from the NDJSON stream, so a terminal session
 * started outside a ticket still drives the same UI states. SessionEnd is
 * handled by the /api/hook route directly (Office.forceIdle) rather than
 * here, because "go idle" has no RunnerEvent of its own.
 */
export function hookToEvents(payload: HookPayload): RunnerEvent[] {
  switch (payload.hook_event_name) {
    case "SessionStart":
      return payload.session_id ? [{ kind: "started", sessionId: payload.session_id }] : [];
    case "PreToolUse": {
      const name = payload.tool_name ?? "Tool";
      if (name === "Agent" || name === "Task") {
        const input = payload.tool_input ?? {};
        return [
          {
            kind: "subagent_start",
            id: payload.tool_use_id ?? "",
            type: typeof input["subagent_type"] === "string" ? (input["subagent_type"] as string) : "general-purpose",
            description: typeof input["description"] === "string" ? (input["description"] as string) : "",
          },
        ];
      }
      // agent_id present means this PreToolUse fired inside a subagent's own turn (docs: "agent_id: uuid (subagent only)") — route it to that tile.
      if (payload.agent_id) return [{ kind: "subagent_tool", id: payload.agent_id, name, summary: summarizeToolInput(payload.tool_input) }];
      return [{ kind: "tool_use", name, summary: summarizeToolInput(payload.tool_input) }];
    }
    case "PostToolUse":
      return [{ kind: "thinking" }];
    case "SubagentStop":
      // id resolution (matching by agent_id/tool_use_id, else the oldest open one) needs live state, so Office.ingestExternal does the matching; this just carries whatever id we have, possibly none.
      return [{ kind: "subagent_stop", id: payload.agent_id ?? payload.tool_use_id ?? "" }];
    case "Notification": {
      const t = payload.notification_type ?? "";
      if (t.includes("permission") || t.includes("idle") || payload.message) {
        return [{ kind: "waiting", prompt: payload.message ?? "needs your input" }];
      }
      return [];
    }
    case "Stop":
      return [{ kind: "done", summary: "turn finished" }];
    default:
      return [];
  }
}
