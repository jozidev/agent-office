#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { exec } from "node:child_process";
import { createServer } from "@agent-office/server";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "../ui");
const port = Number(process.env.PORT ?? 4177);
const open = !process.argv.includes("--no-open");

const { app } = await createServer({ uiDir, seed: process.env.SEED !== "0", logger: false });
await app.listen({ port, host: "127.0.0.1" });
const url = `http://127.0.0.1:${port}`;
console.log(`Agent Office running at ${url}`);

if (open) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`, () => {});
}
