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
const { app } = await createServer({ uiDir, seed: process.env.SEED !== "0", logger: false, runner, runnerKind: kind, port });
await app.listen({ port, host: "127.0.0.1" });
const url = `http://127.0.0.1:${port}`;
console.log(`Agent Office running at ${url}`);

if (open) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`, () => {});
}
