import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, SetupCheck, SetupReport } from "@agent-office/shared";

const run = promisify(execFile);

/** Expand a leading ~ the way a shell would. */
export function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writable(p: string): Promise<boolean> {
  try {
    await access(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs environment checks for the "Set up your office" page. Everything here
 * is read-only; fixes are separate, explicit actions. Each check reports
 * ok / warn / fail plus a plain-language hint.
 */
export async function runSetupChecks(agents: Agent[], hookHits = 0): Promise<SetupReport> {
  const checks: SetupCheck[] = [];
  const home = homedir();
  const claudeDir = join(home, ".claude");

  // Node
  const [major] = process.versions.node.split(".").map(Number);
  checks.push({
    id: "node",
    label: "Node.js",
    status: (major ?? 0) >= 20 ? "ok" : "fail",
    detail: `v${process.versions.node}`,
    hint: (major ?? 0) >= 20 ? undefined : "Agent Office needs Node 20 or newer.",
  });

  // Claude Code CLI
  let claudeVersion: string | null = null;
  try {
    const { stdout } = await run("claude", ["--version"], { timeout: 8000 });
    claudeVersion = stdout.trim();
  } catch {
    /* not installed or not on PATH */
  }
  checks.push({
    id: "claude-cli",
    label: "Claude Code CLI",
    status: claudeVersion ? "ok" : "fail",
    detail: claudeVersion ?? "not found on PATH",
    hint: claudeVersion ? undefined : "Install with: npm install -g @anthropic-ai/claude-code",
    fix: claudeVersion ? undefined : { label: "Show install command", command: "npm install -g @anthropic-ai/claude-code" },
  });

  // ~/.claude and login state (best effort: ~/.claude.json holds oauth account info when logged in)
  const hasClaudeDir = await exists(claudeDir);
  checks.push({
    id: "claude-dir",
    label: "Claude Code home folder",
    status: hasClaudeDir ? ((await writable(claudeDir)) ? "ok" : "warn") : "fail",
    detail: claudeDir,
    hint: hasClaudeDir ? undefined : "Run `claude` once in a terminal to create it.",
  });

  let loggedIn: boolean | null = null;
  try {
    const raw = await readFile(join(home, ".claude.json"), "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    loggedIn = Boolean(j["oauthAccount"] || j["primaryApiKey"]) || process.env.ANTHROPIC_API_KEY !== undefined;
  } catch {
    loggedIn = process.env.ANTHROPIC_API_KEY !== undefined ? true : null;
  }
  checks.push({
    id: "login",
    label: "Signed in to Claude",
    status: loggedIn === true ? "ok" : loggedIn === false ? "fail" : "warn",
    detail: loggedIn === true ? "account found" : loggedIn === false ? "no account in ~/.claude.json" : "could not read ~/.claude.json",
    hint: loggedIn === true ? undefined : "Run `claude` in a terminal and complete the login, or set ANTHROPIC_API_KEY.",
  });

  // Session transcripts folder (used by the usage collector later)
  const projectsDir = join(claudeDir, "projects");
  checks.push({
    id: "transcripts",
    label: "Session transcripts",
    status: (await exists(projectsDir)) ? "ok" : "warn",
    detail: projectsDir,
    hint: (await exists(projectsDir)) ? undefined : "Appears after your first Claude Code session. Needed for usage stats only.",
  });

  // Per-agent working folders and hook installation
  for (const a of agents) {
    const cwd = expandHome(a.cwd);
    let status: SetupCheck["status"] = "fail";
    let detail = cwd;
    let hint: string | undefined = "Folder does not exist. Create it or change the agent's working folder.";
    try {
      const s = await stat(cwd);
      if (s.isDirectory()) {
        const hooksFile = join(cwd, ".claude", "settings.local.json");
        let hooked = false;
        try {
          hooked = (await readFile(hooksFile, "utf8")).includes("agent-office");
        } catch {
          /* no file */
        }
        status = hooked ? "ok" : "warn";
        detail = hooked ? `${cwd} (hooks installed)` : `${cwd} (hooks not installed)`;
        hint = hooked ? undefined : "Hooks let the office see this agent's status. They are installed when you hire, so this usually means the folder was changed afterwards.";
      }
    } catch {
      /* missing */
    }
    checks.push({ id: `agent:${a.id}`, label: `${a.name}'s folder`, status, detail, hint });
  }

  // Confirms the loop is actually closed: hooks were installed AND at least one has POSTed back this run.
  checks.push({
    id: "hooks-reachable",
    label: "Claude Code hooks reachable",
    status: hookHits > 0 ? "ok" : "warn",
    detail: hookHits > 0 ? `${hookHits} hook event(s) received` : "no hook events received yet this run",
    hint: hookHits > 0 ? undefined : "Runs once an agent's session sends its first hook event (e.g. SessionStart). Not fired by pure mock sessions.",
  });

  const worst = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { checkedAt: new Date().toISOString(), overall: worst, checks };
}
