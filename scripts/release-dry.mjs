#!/usr/bin/env node
/**
 * A dry run of `npx agent-office`, because packaging breaks in ways the
 * workspace never shows you: the CLI bundle is built from workspace packages
 * that won't exist on a user's machine, and both native dependencies
 * (node-pty, better-sqlite3) are installed fresh from the registry.
 *
 * Builds, packs the CLI, installs the tarball into a throwaway directory with
 * plain npm, runs the installed binary, and checks it actually serves.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const cliDir = join(repoRoot, "apps", "cli");
const PORT = Number(process.env.RELEASE_DRY_PORT ?? 4199);
const KEEP = process.argv.includes("--keep");

const log = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const capture = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error(`server never answered ${url} within ${timeoutMs}ms`);
}

/** Hires a throwaway agent and opens its terminal, failing if the pty produces nothing. */
async function hireAndOpenTerminal(base, cwd) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
  const agentId = await new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: "agent.hire", payload: { name: "Packy", role: "coder", cwd } }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "agent.upsert") resolve(m.agent.id);
    };
    ws.onerror = () => reject(new Error("control socket failed"));
    setTimeout(() => reject(new Error("no agent came back")), 10_000);
  });

  const chunks = await new Promise((resolve, reject) => {
    const term = new WebSocket(`${base.replace("http", "ws")}/ws/terminal/${agentId}`);
    const seen = [];
    term.onmessage = (e) => {
      seen.push(String(e.data));
      if (seen.join("").length > 40) {
        term.close();
        resolve(seen);
      }
    };
    term.onclose = () => resolve(seen);
    term.onerror = () => reject(new Error("terminal socket failed"));
    setTimeout(() => {
      term.close();
      resolve(seen);
    }, 12_000);
  });

  ws.close();
  const text = chunks.join("");
  if (!text) throw new Error("the terminal produced no output — the pty almost certainly could not spawn");
  if (text.includes("could not open a terminal")) throw new Error(`the pty refused to start: ${text.slice(0, 200)}`);
  return agentId;
}

const workDir = mkdtempSync(join(tmpdir(), "agent-office-release-"));
const officeHome = join(workDir, "office-home");
let server;

try {
  log("building the workspace");
  run("pnpm", ["-r", "build"], repoRoot);

  log("packing apps/cli");
  // pnpm pack rewrites workspace: protocol; npm pack would leave it in place.
  run("pnpm", ["pack", "--pack-destination", workDir], cliDir);
  const tarball = readdirSync(workDir).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");
  const tarballPath = join(workDir, tarball);
  const sizeMb = (statSync(tarballPath).size / 1024 / 1024).toFixed(1);
  console.log(`  ${tarball} (${sizeMb} MB)`);

  log("checking the packed manifest");
  const manifest = JSON.parse(capture("tar", ["-xOf", tarballPath, "package/package.json"], workDir));
  const workspaceDeps = Object.entries(manifest.dependencies ?? {}).filter(([, v]) => String(v).startsWith("workspace:"));
  if (workspaceDeps.length) {
    throw new Error(`workspace: protocol left in published dependencies: ${workspaceDeps.map(([k]) => k).join(", ")}`);
  }
  const files = capture("tar", ["-tf", tarballPath], workDir).split("\n");
  for (const required of ["package/dist/index.js", "package/ui/index.html", "package/scripts/fix-pty-permissions.mjs"]) {
    if (!files.includes(required)) throw new Error(`missing from the tarball: ${required}`);
  }
  console.log(`  ${files.length} files, dependencies: ${Object.keys(manifest.dependencies ?? {}).join(", ")}`);

  log("installing the tarball with npm, the way npx would");
  run("npm", ["init", "-y"], workDir);
  run("npm", ["install", "--no-audit", "--no-fund", tarballPath], workDir);

  log(`starting the installed binary on :${PORT}`);
  const binary = join(workDir, "node_modules", "agent-office", "dist", "index.js");
  server = spawn(process.execPath, [binary, "--no-open"], {
    cwd: workDir,
    env: { ...process.env, PORT: String(PORT), AGENT_OFFICE_HOME: officeHome, SEED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (c) => {
    output += c;
    process.stdout.write(`  ${c}`);
  });
  server.stderr.on("data", (c) => {
    output += c;
    process.stderr.write(`  ${c}`);
  });
  server.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`  server exited early with code ${code}`);
  });

  const base = `http://127.0.0.1:${PORT}`;
  await waitForServer(`${base}/api/health`);

  log("checking what it serves");
  const runner = await (await fetch(`${base}/api/runner`)).json();
  const setup = await (await fetch(`${base}/api/setup`)).json();
  const html = await (await fetch(base)).text();
  if (!html.includes("<div id=\"root\">")) throw new Error("the served page is not the built UI");
  const failed = setup.checks.filter((c) => c.status === "fail");

  console.log(`  runner: ${runner.runner}`);
  console.log(`  setup: ${setup.overall}${failed.length ? ` (${failed.map((c) => c.label).join(", ")})` : ""}`);
  console.log(`  UI: ${html.length} bytes of index.html`);
  if (!readFileSync(binary, "utf8").includes("agent-office")) throw new Error("binary looks wrong");

  log("opening a terminal in the installed package");
  // The reason this step exists: node-pty's spawn-helper ships without its
  // executable bit, and nothing else here would notice. A pty that cannot
  // spawn is exactly what a first npx user would hit.
  const agentId = await hireAndOpenTerminal(base, workDir);
  console.log(`  pty streamed output for agent ${agentId}`);

  log("\x1b[32mrelease dry run passed\x1b[0m");
  console.log(`  npx agent-office would install ${Object.keys(manifest.dependencies ?? {}).length} runtime deps and serve on :${PORT}`);
  if (output.includes("posix_spawnp")) throw new Error("pty spawn failure in the installed package");
} finally {
  server?.kill("SIGTERM");
  if (KEEP) console.log(`\nkept: ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}
