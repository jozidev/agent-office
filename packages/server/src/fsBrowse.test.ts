import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { listDirs, registerFsRoutes, statPath } from "./fsBrowse.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-office-fs-"));
  mkdirSync(join(dir, "beta"));
  mkdirSync(join(dir, "alpha"));
  mkdirSync(join(dir, ".hidden"));
  writeFileSync(join(dir, "notes.txt"), "not a folder");
});

afterEach(() => {
  dir = "";
});

describe("listDirs", () => {
  it("lists only folders, sorted, so files cannot be picked as a working folder", async () => {
    const listing = await listDirs(dir);
    expect(listing.entries.map((e) => e.name)).toEqual(["alpha", "beta"]);
  });

  it("hides dotfolders unless they are asked for", async () => {
    expect((await listDirs(dir, { hidden: true })).entries.map((e) => e.name)).toEqual([".hidden", "alpha", "beta"]);
  });

  it("defaults to the home folder when given nothing", async () => {
    expect((await listDirs(undefined)).path).toBe(homedir());
    expect((await listDirs("  ")).path).toBe(homedir());
  });

  it("expands ~ the way the rest of the app does", async () => {
    expect((await listDirs("~")).path).toBe(homedir());
  });

  it("offers a parent to go up to, and none at the filesystem root", async () => {
    expect((await listDirs(dir)).parent).not.toBeNull();
    expect((await listDirs(sep)).parent).toBeNull();
  });

  it("resolves .. rather than treating it literally", async () => {
    expect((await listDirs(join(dir, "alpha", ".."))).path).toBe((await listDirs(dir)).path);
  });

  it("rejects a folder that is not there", async () => {
    await expect(listDirs(join(dir, "nope"))).rejects.toThrow();
  });
});

describe("statPath", () => {
  it("tells a folder, a file and nothing apart", async () => {
    expect(await statPath(dir)).toMatchObject({ exists: true, isDir: true });
    expect(await statPath(join(dir, "notes.txt"))).toMatchObject({ exists: true, isDir: false });
    expect(await statPath(join(dir, "nope"))).toMatchObject({ exists: false, isDir: false });
  });
});

describe("fs routes", () => {
  it("answers an unreadable folder with a message the picker can show, not a 500", async () => {
    const app = Fastify({ logger: false });
    registerFsRoutes(app);

    const ok = await app.inject({ url: `/api/fs/list?path=${encodeURIComponent(dir)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().entries.map((e: { name: string }) => e.name)).toEqual(["alpha", "beta"]);

    const bad = await app.inject({ url: `/api/fs/list?path=${encodeURIComponent(join(dir, "nope"))}` });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBeTruthy();

    const stat = await app.inject({ url: `/api/fs/stat?path=${encodeURIComponent(join(dir, "nope"))}` });
    expect(stat.json()).toMatchObject({ exists: false });
  });
});
