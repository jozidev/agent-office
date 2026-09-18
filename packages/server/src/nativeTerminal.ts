import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Agent } from "@agent-office/shared";
import type { Office } from "./office.js";
import { expandHome } from "./setup.js";
import { SETTINGS, type Store } from "./store.js";
import { claudeArgsFor, type TerminalManager } from "./terminal.js";

/**
 * Handing a session to the machine's real terminal app. The in-app xterm is
 * good enough to glance at, but for actual work you want your own terminal:
 * your font, your key bindings, your tmux.
 *
 * Nothing here assumes a particular app. We probe for everything installed,
 * let the user pick, remember the pick, and when a machine has no GUI terminal
 * at all (a headless box, or the office opened from another machine) we hand
 * back the command so it can be pasted somewhere useful.
 */

export interface TerminalApp {
  /** stable key, persisted in settings */
  id: string;
  label: string;
}

/** A probe plus how to run a script once the probe has found something. */
interface Candidate extends TerminalApp {
  platform: NodeJS.Platform;
  /** macOS .app bundles to look for, in order */
  appPaths?: string[];
  /** executable to look for on PATH */
  bin?: string;
  /** always available on this platform, no probe needed */
  always?: boolean;
  /** argv for running `script`; `found` is the resolved bundle path or binary */
  argv(found: string, script: string): [string, string[]];
}

/** `open -a <bundle> <script>` — both Terminal.app and iTerm run a .command file this way. */
const openWith = (found: string, script: string): [string, string[]] => ["open", ["-a", found, script]];

const CANDIDATES: Candidate[] = [
  // darwin
  { id: "iterm", label: "iTerm", platform: "darwin", appPaths: ["/Applications/iTerm.app"], argv: openWith },
  { id: "ghostty", label: "Ghostty", platform: "darwin", bin: "ghostty", argv: (f, s) => [f, ["-e", s]] },
  { id: "wezterm", label: "WezTerm", platform: "darwin", bin: "wezterm", argv: (f, s) => [f, ["start", "--", s]] },
  { id: "kitty", label: "kitty", platform: "darwin", bin: "kitty", argv: (f, s) => [f, [s]] },
  { id: "alacritty", label: "Alacritty", platform: "darwin", bin: "alacritty", argv: (f, s) => [f, ["-e", s]] },
  // Terminal.app ships with macOS, so this list is never empty on a Mac. Last
  // because anyone with another terminal installed would rather use that one.
  {
    id: "terminal",
    label: "Terminal",
    platform: "darwin",
    appPaths: ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
    argv: openWith,
  },

  // linux — may legitimately find nothing (headless, or over SSH)
  { id: "gnome-terminal", label: "GNOME Terminal", platform: "linux", bin: "gnome-terminal", argv: (f, s) => [f, ["--", s]] },
  { id: "konsole", label: "Konsole", platform: "linux", bin: "konsole", argv: (f, s) => [f, ["-e", s]] },
  { id: "ghostty", label: "Ghostty", platform: "linux", bin: "ghostty", argv: (f, s) => [f, ["-e", s]] },
  { id: "kitty", label: "kitty", platform: "linux", bin: "kitty", argv: (f, s) => [f, [s]] },
  { id: "alacritty", label: "Alacritty", platform: "linux", bin: "alacritty", argv: (f, s) => [f, ["-e", s]] },
  { id: "wezterm", label: "WezTerm", platform: "linux", bin: "wezterm", argv: (f, s) => [f, ["start", "--", s]] },
  { id: "x-terminal-emulator", label: "Terminal", platform: "linux", bin: "x-terminal-emulator", argv: (f, s) => [f, ["-e", s]] },
  { id: "xterm", label: "xterm", platform: "linux", bin: "xterm", argv: (f, s) => [f, ["-e", s]] },

  // win32 — implemented from the documented flags; not exercised on a Mac.
  { id: "wt", label: "Windows Terminal", platform: "win32", bin: "wt.exe", argv: (f, s) => [f, ["cmd", "/c", s]] },
  { id: "cmd", label: "Command Prompt", platform: "win32", always: true, argv: (_f, s) => ["cmd.exe", ["/c", "start", "", s]] },
];

/** $TERM_PROGRAM of the shell that launched the office, mapped to a candidate id. */
const TERM_PROGRAM_IDS: Record<string, string> = {
  "iTerm.app": "iterm",
  Apple_Terminal: "terminal",
  ghostty: "ghostty",
  WezTerm: "wezterm",
  kitty: "kitty",
  alacritty: "alacritty",
};

export interface DetectDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => boolean;
}

function onPath(name: string, env: NodeJS.ProcessEnv, fileExists: (p: string) => boolean): string | null {
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, name);
    if (fileExists(full)) return full;
  }
  return null;
}

function defaultFileExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** A detected terminal plus everything needed to launch it. */
interface Installed extends TerminalApp {
  resolved: string;
  candidate: Candidate;
}

function detectInstalled(deps: DetectDeps): Installed[] {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? defaultFileExists;

  const found: Installed[] = [];
  for (const c of CANDIDATES) {
    if (c.platform !== platform) continue;
    let resolved: string | null = null;
    if (c.always) resolved = c.id;
    else if (c.appPaths) resolved = c.appPaths.find(fileExists) ?? null;
    else if (c.bin) resolved = onPath(c.bin, env, fileExists);
    if (resolved) found.push({ id: c.id, label: c.label, resolved, candidate: c });
  }

  // The terminal the office was launched from goes first: if you started it
  // from iTerm, iTerm is what you want back.
  const preferred = TERM_PROGRAM_IDS[env["TERM_PROGRAM"] ?? ""];
  return found.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}

/** Every terminal installed on this machine, best first. */
export function detectTerminals(deps: DetectDeps = {}): TerminalApp[] {
  return detectInstalled(deps).map(({ id, label }) => ({ id, label }));
}

export interface Resolution {
  selected: TerminalApp | null;
  available: TerminalApp[];
  /** true when a saved choice was ignored because that app is no longer installed */
  substituted: boolean;
}

/**
 * Saved choice wins, then $AGENT_OFFICE_TERMINAL_APP, then whatever was
 * detected. The saved choice beats the env var deliberately: otherwise picking
 * an app in the UI would silently do nothing on a machine that exports one.
 */
function resolveInstalled(saved: string | null, deps: DetectDeps): { selected: Installed | null; available: Installed[]; substituted: boolean } {
  const available = detectInstalled(deps);
  const env = deps.env ?? process.env;

  if (saved) {
    const hit = available.find((a) => a.id === saved);
    if (hit) return { selected: hit, available, substituted: false };
  }
  const fromEnv = env["AGENT_OFFICE_TERMINAL_APP"];
  if (fromEnv) {
    const hit = available.find((a) => a.id === fromEnv);
    if (hit) return { selected: hit, available, substituted: Boolean(saved) };
  }
  return { selected: available[0] ?? null, available, substituted: Boolean(saved) };
}

export function resolveTerminal(saved: string | null, deps: DetectDeps = {}): Resolution {
  const { selected, available, substituted } = resolveInstalled(saved, deps);
  return {
    selected: selected ? { id: selected.id, label: selected.label } : null,
    available: available.map(({ id, label }) => ({ id, label })),
    substituted,
  };
}

/** Quote for /bin/sh; cwds with spaces are the common case, not the exotic one. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The line a user can paste into any terminal to pick this session up by hand. */
export function buildCommand(agent: Agent, sessionId: string | null): string {
  const args = claudeArgsFor(agent, sessionId).map(shQuote).join(" ");
  return `cd ${shQuote(expandHome(agent.cwd))} && claude${args ? " " + args : ""}`;
}

/**
 * Terminal apps take a file to run, not a command line, so the command goes
 * into a throwaway script. Launched this way it runs under the user's login
 * shell, which is how `claude` ends up on PATH even when the GUI app was
 * started without one.
 */
export function writeLaunchScript(command: string, agentId: string, platform: NodeJS.Platform = process.platform): string {
  const win = platform === "win32";
  const path = join(tmpdir(), `agent-office-${agentId}-${Date.now()}.${win ? "cmd" : "command"}`);
  // Opening a new console window needs `start`, which is a cmd builtin, and
  // `cmd /c` expands these back out of arguments Node already quoted. Our half
  // of this path is a nanoid and a timestamp; %TMP% is not ours, so check it
  // rather than assume it is tame.
  if (win && /[&|^<>"%!]/.test(path)) throw new Error(`temp folder contains characters cmd.exe would reinterpret: ${path}`);
  writeFileSync(path, win ? `@echo off\r\n${command}\r\n` : `#!/bin/sh\n${command}\n`, { mode: 0o700 });
  if (!win) chmodSync(path, 0o700);
  return path;
}

export interface NativeTerminalDeps extends DetectDeps {
  launch?: (cmd: string, args: string[]) => void;
}

function defaultLaunch(cmd: string, args: string[]): void {
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

/** Registers `/api/terminal/:agentId/native` and `/api/settings/terminalApp`. */
export function registerNativeTerminalRoutes(
  app: FastifyInstance,
  office: Office,
  manager: TerminalManager,
  store: Store,
  deps: NativeTerminalDeps = {},
): void {
  const launch = deps.launch ?? defaultLaunch;
  const platform = deps.platform ?? process.platform;

  const agentOf = (agentId: string) => office.snapshot().agents.find((a) => a.id === agentId);
  const sessionOf = (agentId: string) => office.snapshot().states.find((s) => s.agentId === agentId)?.sessionId ?? null;

  app.get("/api/terminal/:agentId/native", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = agentOf(agentId);
    if (!agent) return reply.code(404).send({ error: "unknown agent" });
    const { selected, available, substituted } = resolveTerminal(store.getSetting(SETTINGS.terminalApp), deps);
    return {
      supported: selected !== null,
      selected,
      available,
      substituted,
      command: buildCommand(agent, sessionOf(agentId)),
    };
  });

  app.post("/api/terminal/:agentId/native", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = agentOf(agentId);
    if (!agent) return reply.code(404).send({ error: "unknown agent" });

    const command = buildCommand(agent, sessionOf(agentId));
    const { selected } = resolveInstalled(store.getSetting(SETTINGS.terminalApp), deps);
    if (!selected) return reply.code(422).send({ error: "no terminal app found on this machine", command });

    // Claude Code will not resume one session in two places, so the in-app pty
    // has to let go before the real terminal picks it up.
    manager.close(agentId);

    const script = writeLaunchScript(command, agentId, platform);
    const [cmd, args] = selected.candidate.argv(selected.resolved, script);
    try {
      launch(cmd, args);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err), command });
    }
    return { ok: true, app: { id: selected.id, label: selected.label }, command };
  });

  app.post("/api/settings/terminalApp", async (req, reply) => {
    const { id } = (req.body ?? {}) as { id?: string };
    if (!id) return reply.code(400).send({ error: "missing id" });
    if (!detectTerminals(deps).some((a) => a.id === id)) return reply.code(400).send({ error: `${id} is not installed` });
    store.setSetting(SETTINGS.terminalApp, id);
    return { ok: true, id };
  });
}
