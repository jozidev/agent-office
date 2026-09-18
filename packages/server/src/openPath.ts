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
      return mode === "reveal" ? ["explorer.exe", [`/select,${path}`]] : ["cmd.exe", ["/c", "start", "", path]];
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
