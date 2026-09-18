import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { allowedRoots, isInsideRoot, normalisePath } from "./paths.js";

/**
 * Read-only directory listing, so hiring an agent can offer a folder picker
 * instead of a text box you type a path into blind. A mistyped path used to
 * produce an agent whose folder does not exist (issue #1); now you browse to
 * it, and anything typed by hand is checked before the hire goes through.
 *
 * Directories only, never file contents, and confined to the allowed roots
 * (the home directory by default, AGENT_OFFICE_FS_ROOT to override). Without
 * that confinement this listed any absolute path on the disk.
 */

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  path: string;
  /** null at the filesystem root, where there is nowhere left to go up to */
  parent: string | null;
  entries: DirEntry[];
}

/**
 * Resolve first, then confine: `..` should mean what it means in a shell, and
 * the confinement check is only meaningful once the path is fully resolved.
 */
function normalise(input: string | undefined, roots: readonly string[]): string {
  const path = normalisePath(input && input.trim() ? input : homedir());
  if (!isInsideRoot(path, roots)) throw new Error(`path is outside the allowed roots: ${path}`);
  return path;
}

export async function listDirs(
  input: string | undefined,
  opts: { hidden?: boolean; roots?: readonly string[] } = {},
): Promise<DirListing> {
  const roots = opts.roots ?? allowedRoots();
  const path = normalise(input, roots);
  const dirents = await readdir(path, { withFileTypes: true });
  const entries = dirents
    .filter((d) => d.isDirectory() && (opts.hidden || !d.name.startsWith(".")))
    .map((d) => ({ name: d.name, path: join(path, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Stop "up" at a root rather than walking out of it.
  const parent = dirname(path);
  const canGoUp = parent !== path && isInsideRoot(parent, roots);
  return { path, parent: canGoUp ? parent : null, entries };
}

export async function statPath(
  input: string | undefined,
  opts: { roots?: readonly string[] } = {},
): Promise<{ path: string; exists: boolean; isDir: boolean }> {
  const path = normalise(input, opts.roots ?? allowedRoots());
  try {
    const s = await stat(path);
    return { path, exists: true, isDir: s.isDirectory() };
  } catch {
    return { path, exists: false, isDir: false };
  }
}

/** Registers `/api/fs/list` and `/api/fs/stat`. Call once from server.ts. */
export function registerFsRoutes(app: FastifyInstance, opts: { roots?: readonly string[] } = {}): void {
  const roots = opts.roots;
  app.get("/api/fs/list", async (req, reply) => {
    const q = req.query as { path?: string; hidden?: string };
    try {
      return await listDirs(q.path, { hidden: q.hidden === "1", ...(roots && { roots }) });
    } catch (err) {
      // An unreadable or missing folder is a normal thing to click on; answer
      // with a message the picker can show rather than a 500.
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/fs/stat", async (req, reply) => {
    try {
      return await statPath((req.query as { path?: string }).path, { ...(roots && { roots }) });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
