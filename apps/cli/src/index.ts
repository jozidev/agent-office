#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { exec } from "node:child_process";
import { createServer, pickRunner } from "@agent-office/server";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "../ui");
const port = Number(process.env.PORT ?? 4177);
const open = !process.argv.includes("--no-open");

const { runner, kind } = await pickRunner((msg: string) => console.log(`[agent-office] ${msg}`));
// Silencing the logger entirely hid a server-side pty spawn failure behind a
// blank terminal panel; "warn" keeps request noise out but lets errors through.
const logger = process.env.AGENT_OFFICE_DEBUG ? true : { level: "warn" };
const { app, office } = await createServer({ uiDir, seed: process.env.SEED !== "0", logger, runner, runnerKind: kind, port });
await app.listen({ port, host: "127.0.0.1" });
const url = `http://127.0.0.1:${port}`;
const { agents, tickets } = office.snapshot();
console.log(`Agent Office running at ${url} (${agents.length} agents, ${tickets.length} tickets, runner: ${kind})`);

if (open) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`, () => {});
}
