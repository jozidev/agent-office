import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import { changesFor, diffFor, registerChangesRoutes, repoRoot } from "./changes.js";

let dir: string;

/** A real repository with one committed file, so HEAD exists to diff against. */
function makeRepo(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "agent-office-changes-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: d, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  writeFileSync(join(d, "tracked.txt"), "one\ntwo\nthree\n");
  git("add", ".");
  git("commit", "-qm", "first");
  return d;
}

beforeEach(() => {
  dir = makeRepo();
});

describe("repoRoot", () => {
  it("finds the repository a folder belongs to", async () => {
    expect(await repoRoot(dir)).toBeTruthy();
  });

  it("returns null for a folder that is not in a repository", async () => {
    expect(await repoRoot(realpathSync(mkdtempSync(join(tmpdir(), "agent-office-plain-"))))).toBeNull();
  });
});

describe("changesFor", () => {
  it("counts what changed in the files the agent touched", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    const report = await changesFor(dir, [join(dir, "tracked.txt")]);
    expect(report.repo).toBe(true);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({ display: "tracked.txt", additions: 1, deletions: 0 });
  });

  /**
   * The whole reason the list comes from the agent's events rather than from
   * `git status`: an agent often shares a checkout with the person running it.
   */
  it("ignores changes the agent did not make", async () => {
    writeFileSync(join(dir, "tracked.txt"), "edited by a human\n");
    writeFileSync(join(dir, "mine.txt"), "also mine\n");
    const report = await changesFor(dir, []);
    expect(report.files).toEqual([]);
  });

  it("lists a file the agent created that git has never seen", async () => {
    writeFileSync(join(dir, "new.txt"), "brand new\n");
    const report = await changesFor(dir, [join(dir, "new.txt")]);
    expect(report.files[0]?.display).toBe("new.txt");
  });

  it("keeps a file the agent wrote outside the repo, without asking git about it", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "agent-office-outside-")));
    writeFileSync(join(outside, "plan.md"), "a plan\n");
    const report = await changesFor(dir, [join(outside, "plan.md")]);
    expect(report.files.map((f) => f.display)).toContain(join(outside, "plan.md"));
  });

  it("still lists files when the folder is not a repository at all", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "agent-office-plain-")));
    writeFileSync(join(plain, "notes.md"), "notes\n");
    const report = await changesFor(plain, [join(plain, "notes.md")]);
    expect(report.repo).toBe(false);
    expect(report.root).toBeNull();
    expect(report.files[0]?.display).toBe("notes.md");
  });

  it("resolves a relative path against the agent's folder", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    const report = await changesFor(dir, ["tracked.txt"]);
    expect(report.files[0]?.additions).toBe(1);
  });
});

describe("diffFor", () => {
  it("returns a unified diff for a tracked file", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nCHANGED\n");
    const diff = await diffFor(dir, join(dir, "tracked.txt"));
    expect(diff).toContain("+CHANGED");
    expect(diff).toContain("-three");
  });

  it("renders a brand new file as all additions rather than nothing", async () => {
    writeFileSync(join(dir, "new.txt"), "hello\n");
    expect(await diffFor(dir, join(dir, "new.txt"))).toContain("+hello");
  });

  it("returns nothing outside a repository, instead of failing", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "agent-office-plain-")));
    writeFileSync(join(plain, "notes.md"), "notes\n");
    expect(await diffFor(plain, join(plain, "notes.md"))).toBe("");
  });
});

describe("routes", () => {
  async function serve(touched: string[], cwd: string) {
    const office = new Office(new MockRunner(), { roots: ["/"] });
    const agent = office.hire({ name: "Ada", role: "coder", cwd });
    for (const path of touched) office.ingestExternal(agent.id, { kind: "file_touched", path });
    const app = Fastify({ logger: false });
    registerChangesRoutes(app, office, { roots: ["/"] });
    return { app, agentId: agent.id };
  }

  it("reports the agent's changes", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    const { app, agentId } = await serve([join(dir, "tracked.txt")], dir);
    const res = await app.inject({ url: `/api/agent/${agentId}/changes` });
    expect(res.statusCode).toBe(200);
    expect(res.json().files[0]).toMatchObject({ display: "tracked.txt", additions: 1 });
  });

  it("404s for an agent that does not exist", async () => {
    const { app } = await serve([], dir);
    expect((await app.inject({ url: "/api/agent/nope/changes" })).statusCode).toBe(404);
  });

  /** The path becomes a git argument, so it is checked against what the agent reported. */
  it("refuses a diff for a file this agent never touched", async () => {
    const { app, agentId } = await serve([join(dir, "tracked.txt")], dir);
    const res = await app.inject({ url: `/api/agent/${agentId}/diff?path=${encodeURIComponent(join(dir, "other.txt"))}` });
    expect(res.statusCode).toBe(403);
  });

  it("returns the diff for a file it did touch", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nCHANGED\n");
    const { app, agentId } = await serve([join(dir, "tracked.txt")], dir);
    const res = await app.inject({ url: `/api/agent/${agentId}/diff?path=${encodeURIComponent(join(dir, "tracked.txt"))}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("+CHANGED");
  });

  it("needs a path", async () => {
    const { app, agentId } = await serve([], dir);
    expect((await app.inject({ url: `/api/agent/${agentId}/diff` })).statusCode).toBe(400);
  });
});

/**
 * `git diff HEAD` says nothing about files git has never seen, which is most
 * of what a new agent produces — so counts came back +0/-0 for every new file.
 */
describe("counts for files git has not seen", () => {
  it("counts a newly created file as all additions", async () => {
    writeFileSync(join(dir, "new.txt"), "one\ntwo\n");
    const report = await changesFor(dir, [join(dir, "new.txt")]);
    expect(report.files[0]).toMatchObject({ display: "new.txt", additions: 2, deletions: 0 });
  });

  it("still counts a modified tracked file the normal way", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\n");
    const report = await changesFor(dir, [join(dir, "tracked.txt")]);
    expect(report.files[0]).toMatchObject({ additions: 0, deletions: 1 });
  });

  it("reports both kinds together", async () => {
    writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(join(dir, "new.txt"), "hello\n");
    const report = await changesFor(dir, [join(dir, "tracked.txt"), join(dir, "new.txt")]);
    expect(report.files.map((f) => [f.display, f.additions, f.deletions])).toEqual([
      ["tracked.txt", 1, 0],
      ["new.txt", 1, 0],
    ]);
  });
});
