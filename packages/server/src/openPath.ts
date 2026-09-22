import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { dirname } from "node:path";
import type { FastifyInstance } from "fastify";
import { allowedRoots, isInsideRoot, normalisePath } from "./paths.js";

/**
 * Open a file an agent produced in whatever the OS uses for it — an editor, a
 * viewer, Finder. Agents write plans and reports constantly and the office
 * showed their paths as dead text, so reading one meant copying the path into
 * a terminal.
 *
 * Confined to the same roots as the folder picker: this hands a path to the
 * desktop's "open anything" handler, so it must never take an arbitrary one.
 */

/** `reveal` shows the file in a file manager instead of opening it. */
export type OpenMode = "open" | "reveal";

export function openArgs(path: string, mode: OpenMode, platform: NodeJS.Platform): [string, string[]] | null {
  switch (platform) {
    case "darwin":
      return ["open", mode === "reveal" ? ["-R", path] : [path]];
    case "win32":
      // explorer.exe both opens a file with its default handler and selects it
      // with /select, each as a single argv element with no shell involved.
      //
      // Never `cmd.exe /c start`: cmd re-parses its own command line and
      // expands &, |, ^, <, > and %VAR% even out of arguments Node quoted. All
      // of those are legal in Windows filenames, and agents create files — so
      // an agent could write `notes&calc.md` and clicking it in the log would
      // run a command.
      return ["explorer.exe", mode === "reveal" ? [`/select,${path}`] : [path]];
    case "linux":
      // No reveal equivalent that is present everywhere; open the folder.
      return ["xdg-open", [mode === "reveal" ? dirname(path) : path]];
    default:
      return null;
  }
}

/**
 * Readable in the app rather than handed to the OS. Deliberately a list
 * rather than "anything that looks like text": this streams file contents to
 * the browser, so it should only ever be what an agent plausibly wrote.
 */
const PREVIEWABLE = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".log"]);

/** Enough for a long plan, small enough not to wedge the panel. */
const PREVIEW_LIMIT = 512 * 1024;

export function isPreviewable(path: string): boolean {
  return PREVIEWABLE.has(extname(path).toLowerCase());
}

/**
 * Things the OS runs rather than opens. Agents write files inside the roots
 * and the UI auto-links any path in their output, so an agent that writes
 * `notes.command` turns a routine click into execution.
 *
 * A denylist rather than an allowlist, deliberately: the common case is
 * opening a source file the agent just wrote, and an allowlist broad enough
 * for that is every extension in the repo. The executable bit is checked too,
 * which is what actually makes a file runnable whatever it is called.
 */
const EXECUTABLE = new Set([
  ".command", ".app", ".sh", ".bash", ".zsh", ".fish", ".tool", ".workflow",
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".ps1", ".vbs", ".wsf",
  ".scpt", ".applescript", ".jar", ".pkg", ".dmg", ".run", ".appimage",
]);

/** Why this path must not be handed to the OS, or null if it may be. */
export async function refuseToOpen(path: string): Promise<string | null> {
  if (EXECUTABLE.has(extname(path).toLowerCase())) {
    return `${extname(path)} files are run rather than opened — reveal it instead`;
  }
  try {
    const s = await stat(path);
    if (s.mode & 0o111) return "that file is executable — reveal it instead";
  } catch {
    /* the caller stats it too and reports a missing file properly */
  }
  return null;
}

export interface OpenPathDeps {
  platform?: NodeJS.Platform;
  roots?: readonly string[];
  launch?: (cmd: string, args: string[]) => void;
}

function defaultLaunch(cmd: string, args: string[]): void {
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

/** Registers `POST /api/open`. Call once from server.ts. */
export function registerOpenPathRoutes(app: FastifyInstance, deps: OpenPathDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const launch = deps.launch ?? defaultLaunch;

  app.post("/api/open", async (req, reply) => {
    const { path: raw, mode } = (req.body ?? {}) as { path?: string; mode?: OpenMode };
    if (!raw) return reply.code(400).send({ error: "missing path" });

    const path = normalisePath(raw);
    const roots = deps.roots ?? allowedRoots();
    if (!isInsideRoot(path, roots)) {
      return reply.code(403).send({ error: "that path is outside the allowed roots" });
    }
    try {
      await stat(path);
    } catch {
      return reply.code(404).send({ error: "that file is not there any more" });
    }

    // `reveal` only selects the file in a file manager, so it stays open to
    // anything; `open` is the one that can execute.
    if (mode !== "reveal") {
      const refusal = await refuseToOpen(path);
      if (refusal) return reply.code(403).send({ error: refusal, path });
    }

    const argv = openArgs(path, mode === "reveal" ? "reveal" : "open", platform);
    if (!argv) return reply.code(422).send({ error: `opening files is not wired up for ${platform}` });
    try {
      launch(argv[0], argv[1]);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { ok: true, path };
  });

  /** Read a file an agent wrote, so it can be previewed without leaving the office. */
  app.get("/api/file", async (req, reply) => {
    const raw = (req.query as { path?: string }).path;
    if (!raw) return reply.code(400).send({ error: "missing path" });

    const path = normalisePath(raw);
    if (!isInsideRoot(path, deps.roots ?? allowedRoots())) {
      return reply.code(403).send({ error: "that path is outside the allowed roots" });
    }
    if (!isPreviewable(path)) return reply.code(415).send({ error: `${extname(path) || "that file"} cannot be previewed here` });

    let size: number;
    try {
      const s = await stat(path);
      if (s.isDirectory()) return reply.code(415).send({ error: "that is a folder" });
      size = s.size;
    } catch {
      return reply.code(404).send({ error: "that file is not there any more" });
    }

    const content = await readFile(path, "utf8");
    return {
      path,
      content: size > PREVIEW_LIMIT ? content.slice(0, PREVIEW_LIMIT) : content,
      truncated: size > PREVIEW_LIMIT,
    };
  });
}
