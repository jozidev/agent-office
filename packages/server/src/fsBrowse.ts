import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { expandHome } from "./setup.js";

/**
 * Read-only directory listing, so hiring an agent can offer a folder picker
 * instead of a text box you type a path into blind. A mistyped path used to
 * produce an agent whose folder does not exist (issue #1); now you browse to
 * it, and anything typed by hand is checked before the hire goes through.
 *
 * Directories only, never file contents, and the server is bound to 127.0.0.1.
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

/** Resolve first: `..` in a path should mean what it means in a shell, not something surprising. */
function normalise(input: string | undefined): string {
  return resolve(expandHome(input && input.trim() ? input : homedir()));
}

export async function listDirs(input: string | undefined, opts: { hidden?: boolean } = {}): Promise<DirListing> {
  const path = normalise(input);
  const dirents = await readdir(path, { withFileTypes: true });
  const entries = dirents
    .filter((d) => d.isDirectory() && (opts.hidden || !d.name.startsWith(".")))
    .map((d) => ({ name: d.name, path: join(path, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, entries };
}

export async function statPath(input: string | undefined): Promise<{ path: string; exists: boolean; isDir: boolean }> {
  const path = normalise(input);
  try {
    const s = await stat(path);
    return { path, exists: true, isDir: s.isDirectory() };
  } catch {
    return { path, exists: false, isDir: false };
  }
}

/** Registers `/api/fs/list` and `/api/fs/stat`. Call once from server.ts. */
export function registerFsRoutes(app: FastifyInstance): void {
  app.get("/api/fs/list", async (req, reply) => {
    const q = req.query as { path?: string; hidden?: string };
    try {
      return await listDirs(q.path, { hidden: q.hidden === "1" });
    } catch (err) {
      // An unreadable or missing folder is a normal thing to click on; answer
      // with a message the picker can show rather than a 500.
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/fs/stat", async (req) => statPath((req.query as { path?: string }).path));
}
