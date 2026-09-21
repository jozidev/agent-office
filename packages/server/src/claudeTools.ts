/**
 * Claude Code's tool vocabulary, kept in one place.
 *
 * Everything above the runner — the office, the HTTP and WebSocket routes, the
 * panel — deals in RunnerEvents and knows nothing about tools called `Write`
 * or `ExitPlanMode`. This module is where that knowledge is allowed to live,
 * alongside cliRunner.ts, hooks.ts and terminal.ts, so a second runtime can be
 * added without touching anything else.
 */

/** Tools that write to a file, and where each keeps the path. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * The path a write tool operated on, if it named one. Returns null for every
 * other tool, which is how callers decide whether to emit `file_touched`.
 */
export function touchedPath(tool: string, input: unknown): string | null {
  if (!WRITE_TOOLS.has(tool)) return null;
  const i = (input ?? {}) as Record<string, unknown>;
  const path = i["file_path"] ?? i["notebook_path"] ?? i["path"];
  return typeof path === "string" && path ? path : null;
}
