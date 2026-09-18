#!/usr/bin/env node
/**
 * node-pty ships its macOS/Linux `spawn-helper` inside prebuilds/, and the
 * extracted file can land without its executable bit (seen with pnpm 10 on
 * macOS arm64). node-pty then fails every single pty spawn with the useless
 * message "posix_spawnp failed." — the terminal panel just stays blank.
 *
 * Runs on postinstall. Idempotent, silent when there is nothing to fix, and
 * never fails the install: a missing helper only means no terminal.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/** node_modules directories to search: the package's own, then every parent's (npm hoists). */
function moduleDirs(root) {
  const dirs = [];
  let current = root;
  const { root: fsRoot } = parse(root);
  while (true) {
    const modules = join(current, "node_modules");
    if (existsSync(modules)) dirs.push(modules);
    if (current === fsRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/** Every node-pty install this package could load: hoisted by npm, nested, or in a pnpm store. */
function nodePtyRoots(root) {
  const roots = new Set();

  // Authoritative: the copy Node itself would resolve from this script.
  try {
    roots.add(dirname(createRequire(import.meta.url).resolve("node-pty/package.json")));
  } catch {
    /* not resolvable from here — fall back to the scans below */
  }

  for (const modules of moduleDirs(root)) {
    const direct = join(modules, "node-pty");
    if (existsSync(direct)) roots.add(direct);
    const pnpmStore = join(modules, ".pnpm");
    if (existsSync(pnpmStore)) {
      for (const entry of readdirSync(pnpmStore)) {
        if (!entry.startsWith("node-pty@")) continue;
        const nested = join(pnpmStore, entry, "node_modules", "node-pty");
        if (existsSync(nested)) roots.add(nested);
      }
    }
  }
  return [...roots];
}

/** Absolute paths of every spawn-helper shipped in a node-pty install. */
export function spawnHelperPaths(root) {
  const found = [];
  for (const ptyRoot of nodePtyRoots(root)) {
    const prebuilds = join(ptyRoot, "prebuilds");
    if (!existsSync(prebuilds)) continue;
    for (const platform of readdirSync(prebuilds)) {
      const helper = join(prebuilds, platform, "spawn-helper");
      if (existsSync(helper)) found.push(helper);
    }
  }
  return found;
}

/** Adds the executable bit where it is missing. Returns the paths it changed. */
export function fixSpawnHelpers(root) {
  const fixed = [];
  for (const helper of spawnHelperPaths(root)) {
    const mode = statSync(helper).mode;
    const withExec = mode | 0o111;
    if (mode === withExec) continue;
    try {
      chmodSync(helper, withExec);
      fixed.push(helper);
    } catch {
      /* read-only store or no permission: the terminal will fall back to an error message */
    }
  }
  return fixed;
}

const invokedDirectly = process.argv[1] && statSync(process.argv[1]).ino === statSync(fileURLToPath(import.meta.url)).ino;
if (invokedDirectly) {
  const root = process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url)));
  for (const path of fixSpawnHelpers(root)) console.log(`[agent-office] made node-pty's spawn-helper executable: ${path}`);
}
