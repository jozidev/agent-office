import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fixSpawnHelpers, spawnHelperPaths } from "../../../scripts/fix-pty-permissions.mjs";

let root;

/** Builds a fake install tree: layout can be "npm" (flat) or "pnpm" (store). */
function makeHelper(layout, version = "1.1.0", platform = "darwin-arm64", mode = 0o644) {
  const ptyRoot =
    layout === "npm"
      ? join(root, "node_modules", "node-pty")
      : join(root, "node_modules", ".pnpm", `node-pty@${version}`, "node_modules", "node-pty");
  const dir = join(ptyRoot, "prebuilds", platform);
  mkdirSync(dir, { recursive: true });
  const helper = join(dir, "spawn-helper");
  writeFileSync(helper, "#!/bin/sh\n");
  chmodSync(helper, mode);
  return helper;
}

const isExecutable = (p) => (statSync(p).mode & 0o111) !== 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-pty-"));
});

/**
 * node-pty's spawn-helper arriving without its executable bit makes every pty
 * spawn fail with "posix_spawnp failed." and leaves the terminal panel blank.
 */
describe("fixSpawnHelpers", () => {
  it("makes a non-executable helper executable in a pnpm store layout", () => {
    const helper = makeHelper("pnpm");
    expect(isExecutable(helper)).toBe(false);
    expect(fixSpawnHelpers(root)).toEqual([helper]);
    expect(isExecutable(helper)).toBe(true);
  });

  it("finds helpers in a flat npm layout too, which is what npx installs", () => {
    const helper = makeHelper("npm");
    expect(fixSpawnHelpers(root)).toEqual([helper]);
    expect(isExecutable(helper)).toBe(true);
  });

  it("fixes every shipped platform, not just the current one", () => {
    const arm = makeHelper("pnpm", "1.1.0", "darwin-arm64");
    const x64 = makeHelper("pnpm", "1.1.0", "darwin-x64");
    expect(fixSpawnHelpers(root).sort()).toEqual([arm, x64].sort());
  });

  it("leaves an already-executable helper alone, so repeat installs are quiet", () => {
    makeHelper("pnpm", "1.1.0", "darwin-arm64", 0o755);
    expect(fixSpawnHelpers(root)).toEqual([]);
  });

  it("does nothing when node-pty is not installed", () => {
    expect(spawnHelperPaths(root)).toEqual([]);
    expect(fixSpawnHelpers(root)).toEqual([]);
  });
});
