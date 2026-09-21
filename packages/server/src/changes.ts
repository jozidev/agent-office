import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Office } from "./office.js";
import { allowedRoots, isInsideRoot, normalisePath } from "./paths.js";
import { expandHome } from "./setup.js";

const run = promisify(execFile);

/**
 * "What has this agent changed."
 *
 * The file list comes from the agent's own events, not from the working tree,
 * so it attributes correctly when an agent shares a checkout with you — a
 * plain `git diff` there would show your changes as the agent's. Git supplies
 * only the contents of that diff, for the paths the agent already told us
 * about. A folder that is not a repo still gets the list.
 *
 * Nothing here knows which runtime produced the events.
 */

export interface ChangedFile {
  /** as the agent reported it, absolute */
  path: string;
  /** relative to the repo root when there is one, else to the agent's folder */
  display: string;
  additions: number;
  deletions: number;
  /** false once the file has been deleted or was never written after all */
  exists: boolean;
}

export interface ChangesReport {
  /** false when the agent's folder is not a git repository */
  repo: boolean;
  root: string | null;
  files: ChangedFile[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** The repository a folder belongs to, or null when it is not in one. */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return root ? normalisePath(root) : null;
  } catch {
    return null;
  }
}

/**
 * `git diff --numstat HEAD -- <paths>` for the files the agent touched.
 * Binary files report "-" for both counts; they become 0 rather than NaN.
 */
function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of out.split("\n")) {
    const [add, del, ...rest] = line.split("\t");
    const file = rest.join("\t").trim();
    if (!file) continue;
    counts.set(file, { additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  return counts;
}

export async function changesFor(rawCwd: string, touched: readonly string[]): Promise<ChangesReport> {
  // Resolve everything the same way before comparing. On macOS /var is a
  // symlink to /private/var, so an unresolved cwd never prefixes a resolved
  // path and every file would look like it lived outside the folder.
  const cwd = normalisePath(rawCwd);
  const paths = touched.map((p) => normalisePath(isAbsolute(p) ? p : resolve(cwd, p)));
  const root = await repoRoot(cwd);
  if (!root) {
    return { repo: false, root: null, files: paths.map((p) => plain(p, cwd)) };
  }

  // Paths the agent wrote outside this repo (a plan under ~/.claude, say) are
  // still its work, but git has nothing to say about them.
  const inRepo = paths.filter((p) => p === root || p.startsWith(`${root}/`));
  const counts = inRepo.length ? parseNumstat(await git(root, ["diff", "--numstat", "HEAD", "--", ...inRepo]).catch(() => "")) : new Map();

  // `git diff HEAD` is silent about files git has never seen, which is most of
  // what a new agent produces — without this every new file reported +0/-0.
  for (const p of inRepo) {
    const display = relative(root, p);
    if (counts.has(display)) continue;
    const out = await git(root, ["diff", "--numstat", "--no-index", "--", "/dev/null", p]).catch((e: { stdout?: string }) => e.stdout ?? "");
    const untracked = parseNumstat(out);
    // --no-index reports the path it was given, not one relative to the root.
    const first = [...untracked.values()][0];
    if (first) counts.set(display, first);
  }

  return {
    repo: true,
    root,
    files: paths.map((p) => {
      const display = p.startsWith(`${root}/`) ? relative(root, p) : p;
      const c = counts.get(display) ?? { additions: 0, deletions: 0 };
      return { path: p, display, additions: c.additions, deletions: c.deletions, exists: true };
    }),
  };
}

function plain(path: string, cwd: string): ChangedFile {
  return { path, display: path.startsWith(`${cwd}/`) ? relative(cwd, path) : path, additions: 0, deletions: 0, exists: true };
}

/** The unified diff for one file, or "" when git has nothing (new, untracked, unchanged). */
export async function diffFor(rawCwd: string, path: string): Promise<string> {
  const root = await repoRoot(normalisePath(rawCwd));
  if (!root) return "";
  const tracked = await git(root, ["diff", "HEAD", "--", path]).catch(() => "");
  if (tracked.trim()) return tracked;
  // A file git has never seen produces nothing above; --no-index against
  // /dev/null renders it as an all-additions diff instead of an empty pane.
  return await git(root, ["diff", "--no-index", "--", "/dev/null", path]).catch((e: { stdout?: string }) => e.stdout ?? "");
}

/** Registers `/api/agent/:agentId/changes` and `/api/agent/:agentId/diff`. */
export function registerChangesRoutes(app: FastifyInstance, office: Office, opts: { roots?: readonly string[] } = {}): void {
  const lookup = (agentId: string) => {
    const snap = office.snapshot();
    const agent = snap.agents.find((a) => a.id === agentId);
    const state = snap.states.find((s) => s.agentId === agentId);
    return agent && state ? { cwd: expandHome(agent.cwd), touched: state.touchedFiles } : null;
  };

  app.get("/api/agent/:agentId/changes", async (req, reply) => {
    const found = lookup((req.params as { agentId: string }).agentId);
    if (!found) return reply.code(404).send({ error: "unknown agent" });
    try {
      return await changesFor(found.cwd, found.touched);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/agent/:agentId/diff", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const raw = (req.query as { path?: string }).path;
    if (!raw) return reply.code(400).send({ error: "missing path" });
    const found = lookup(agentId);
    if (!found) return reply.code(404).send({ error: "unknown agent" });

    const path = normalisePath(raw);
    // Only files this agent actually reported, and only inside the roots:
    // the path arrives from the client and ends up as a git argument.
    if (!found.touched.some((t) => normalisePath(isAbsolute(t) ? t : resolve(found.cwd, t)) === path)) {
      return reply.code(403).send({ error: "that file is not one this agent changed" });
    }
    if (!isInsideRoot(path, opts.roots ?? allowedRoots())) {
      return reply.code(403).send({ error: "that path is outside the allowed roots" });
    }
    return { path, diff: await diffFor(found.cwd, path) };
  });
}
