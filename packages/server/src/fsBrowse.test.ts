import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { listDirs, registerFsRoutes, statPath } from "./fsBrowse.js";

/**
 * `root` stands in for the confinement root (the home directory in real use),
 * `dir` is the folder being browsed inside it, and `outside` is off-limits.
 */
let root: string;
let dir: string;
let outside: string;
let roots: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-root-"));
  outside = mkdtempSync(join(tmpdir(), "agent-office-out-"));
  roots = [root];
  dir = join(root, "workspace");
  mkdirSync(dir);
  mkdirSync(join(dir, "beta"));
  mkdirSync(join(dir, "alpha"));
  mkdirSync(join(dir, ".hidden"));
  writeFileSync(join(dir, "notes.txt"), "not a folder");
});

afterEach(() => {
  root = dir = outside = "";
  roots = [];
});

describe("listDirs", () => {
  it("lists only folders, sorted, so files cannot be picked as a working folder", async () => {
    const listing = await listDirs(dir, { roots });
    expect(listing.entries.map((e) => e.name)).toEqual(["alpha", "beta"]);
  });

  it("hides dotfolders unless they are asked for", async () => {
    expect((await listDirs(dir, { hidden: true, roots })).entries.map((e) => e.name)).toEqual([".hidden", "alpha", "beta"]);
  });

  it("defaults to the home folder when given nothing", async () => {
    expect((await listDirs(undefined)).path).toBe(homedir());
    expect((await listDirs("  ")).path).toBe(homedir());
  });

  it("expands ~ the way the rest of the app does", async () => {
    expect((await listDirs("~")).path).toBe(homedir());
  });

  it("resolves .. rather than treating it literally", async () => {
    expect((await listDirs(join(dir, "alpha", ".."), { roots })).path).toBe((await listDirs(dir, { roots })).path);
  });

  it("rejects a folder that is not there", async () => {
    await expect(listDirs(join(dir, "nope"), { roots })).rejects.toThrow();
  });

  it("offers a parent while one is still inside a root", async () => {
    expect((await listDirs(dir, { roots })).parent).not.toBeNull();
  });

  // The confinement. Each of these used to succeed and disclose the layout of
  // the disk — ~/.ssh, ~/.aws, /etc — to anything that could reach the server.
  it("stops going up at the root instead of walking out of it", async () => {
    expect((await listDirs(root, { roots })).parent).toBeNull();
  });

  it("refuses traversal out of the root", async () => {
    await expect(listDirs(join(dir, "..", "..", ".."), { roots })).rejects.toThrow(/outside the allowed roots/);
  });

  it("refuses an absolute path outside the root", async () => {
    await expect(listDirs(outside, { roots })).rejects.toThrow(/outside the allowed roots/);
    await expect(listDirs(sep, { roots })).rejects.toThrow(/outside the allowed roots/);
  });

  it("refuses a symlink pointing out of the root", async () => {
    symlinkSync(outside, join(dir, "escape"));
    await expect(listDirs(join(dir, "escape"), { roots })).rejects.toThrow(/outside the allowed roots/);
  });
});

describe("statPath", () => {
  it("tells a folder, a file and nothing apart", async () => {
    expect(await statPath(dir, { roots })).toMatchObject({ exists: true, isDir: true });
    expect(await statPath(join(dir, "notes.txt"), { roots })).toMatchObject({ exists: true, isDir: false });
    expect(await statPath(join(dir, "nope"), { roots })).toMatchObject({ exists: false, isDir: false });
  });

  it("refuses to act as an existence oracle for paths outside the root", async () => {
    await expect(statPath(outside, { roots })).rejects.toThrow(/outside the allowed roots/);
  });
});

describe("fs routes", () => {
  it("answers an unreadable folder with a message the picker can show, not a 500", async () => {
    const app = Fastify({ logger: false });
    registerFsRoutes(app, { roots });

    const ok = await app.inject({ url: `/api/fs/list?path=${encodeURIComponent(dir)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().entries.map((e: { name: string }) => e.name)).toEqual(["alpha", "beta"]);

    const bad = await app.inject({ url: `/api/fs/list?path=${encodeURIComponent(join(dir, "nope"))}` });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBeTruthy();

    const stat = await app.inject({ url: `/api/fs/stat?path=${encodeURIComponent(join(dir, "nope"))}` });
    expect(stat.json()).toMatchObject({ exists: false });
  });

  it("refuses a traversal attempt over HTTP with a 400, not a listing", async () => {
    const app = Fastify({ logger: false });
    registerFsRoutes(app, { roots });

    const escaped = await app.inject({ url: `/api/fs/list?path=${encodeURIComponent(outside)}` });
    expect(escaped.statusCode).toBe(400);
    expect(escaped.json().error).toMatch(/outside the allowed roots/);

    const stat = await app.inject({ url: `/api/fs/stat?path=${encodeURIComponent(outside)}` });
    expect(stat.statusCode).toBe(400);
  });
});
