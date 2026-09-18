import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedRoots, checkAgentCwd, isInsideRoot } from "./paths.js";

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-root-"));
  outside = mkdtempSync(join(tmpdir(), "agent-office-out-"));
  mkdirSync(join(root, "project"));
});

describe("allowedRoots", () => {
  it("defaults to the home directory", () => {
    expect(allowedRoots({})).toEqual([homedir()]);
  });

  it("takes a comma-separated override", () => {
    expect(allowedRoots({ AGENT_OFFICE_FS_ROOT: `${root},${outside}` })).toHaveLength(2);
  });
});

describe("isInsideRoot", () => {
  it("accepts a folder inside a root", () => {
    expect(isInsideRoot(join(root, "project"), [root])).toBe(true);
  });

  it("refuses traversal back out of a root", () => {
    expect(isInsideRoot(join(root, "..", "..", "etc"), [root])).toBe(false);
  });

  it("refuses an unrelated absolute path", () => {
    expect(isInsideRoot("/etc", [root])).toBe(false);
  });

  it("refuses a sibling whose name merely starts with the root's", () => {
    expect(isInsideRoot(`${root}-evil`, [root])).toBe(false);
  });

  it("refuses a symlink that points out of the root", () => {
    symlinkSync(outside, join(root, "escape"));
    expect(isInsideRoot(join(root, "escape"), [root])).toBe(false);
  });
});

describe("checkAgentCwd", () => {
  it("accepts a project folder inside a root", () => {
    expect(checkAgentCwd(join(root, "project"), [root])).toBe(realpathSync(join(root, "project")));
  });

  it("refuses a folder outside the roots", () => {
    expect(() => checkAgentCwd(outside, [root])).toThrow(/outside the allowed roots/);
  });

  /**
   * `cwd: "~"` resolves to $HOME, which makes installHooks write the *global*
   * ~/.claude/settings.local.json — hooks that then run on every Claude Code
   * session on the machine, not just this agent's.
   */
  it("refuses the root itself, which would install global hooks", () => {
    expect(() => checkAgentCwd(root, [root])).toThrow(/cannot be a root itself/);
  });

  it("refuses anything inside ~/.claude", () => {
    const roots = [homedir()];
    expect(() => checkAgentCwd(join(homedir(), ".claude"), roots)).toThrow(/~\/\.claude/);
    expect(() => checkAgentCwd(join(homedir(), ".claude", "projects"), roots)).toThrow(/~\/\.claude/);
  });
});
