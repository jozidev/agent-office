import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { expandHome } from "./setup.js";

/**
 * Root confinement for the two places client input reaches the filesystem:
 * the folder picker (`fsBrowse`) and an agent's working folder (`hire`).
 *
 * Neither had any confinement. The picker would list any absolute path on the
 * disk, and `hire` would accept `cwd: "~"` — which makes `installHooks` write
 * the *global* `~/.claude/settings.local.json`, registering hooks that then run
 * on every future Claude Code session anywhere on the machine.
 */

/** Defaults to the home directory; AGENT_OFFICE_FS_ROOT overrides with a comma-separated list. */
export function allowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env["AGENT_OFFICE_FS_ROOT"];
  const roots = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [homedir()];
  return roots.map((r) => realOf(resolve(expandHome(r))));
}

/**
 * Resolve symlinks so a link inside a root cannot point out of it.
 *
 * A path that does not exist yet has no realpath of its own, so resolve the
 * nearest ancestor that does and re-attach the rest. Returning the unresolved
 * path instead would compare an unresolved path against resolved roots, and on
 * macOS (/var -> /private/var) that wrongly reads as "outside the roots".
 */
function realOf(p: string): string {
  const tail: string[] = [];
  let cur = p;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length ? join(real, ...[...tail].reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p; // hit the filesystem root, nothing resolvable
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/** The resolved, symlink-free form of client-supplied path input. */
export function normalisePath(input: string): string {
  return realOf(resolve(expandHome(input)));
}

/** `/` already ends in a separator; appending another gives `//`, which matches nothing. */
function withSep(r: string): string {
  return r.endsWith(sep) ? r : r + sep;
}

export function isInsideRoot(path: string, roots: readonly string[]): boolean {
  const p = normalisePath(path);
  // Roots are realpath'd too: on macOS $TMPDIR lives under /var, itself a
  // symlink to /private/var, so a raw root would never match a resolved path.
  return roots.map(realOf).some((r) => p === r || p.startsWith(withSep(r)));
}

/**
 * Validates a working folder for `hire`, returning the resolved path.
 *
 * Rejects the home directory itself and anything under `~/.claude`: both would
 * put our hook group into the user's global Claude Code settings rather than
 * into one project, which is the difference between "this agent reports its
 * status" and "every Claude Code session on this machine does".
 */
export function checkAgentCwd(cwd: string, roots: readonly string[] = allowedRoots()): string {
  const path = normalisePath(cwd);
  if (!isInsideRoot(path, roots)) throw new Error(`working folder is outside the allowed roots: ${path}`);
  if (roots.map(realOf).includes(path)) throw new Error("working folder cannot be a root itself — pick a project folder inside it");
  const claudeHome = join(homedir(), ".claude");
  if (path === claudeHome || path.startsWith(withSep(claudeHome))) {
    throw new Error("working folder cannot be inside ~/.claude");
  }
  return path;
}
