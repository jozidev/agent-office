import { createServer } from "./server.js";
import { pickRunner } from "./pickRunner.js";

const port = Number(process.env.PORT ?? 4177);
const { runner, kind } = await pickRunner((msg) => console.log(`[agent-office] ${msg}`));
const { app, office } = await createServer({ seed: process.env.SEED !== "0", runner, runnerKind: kind, port });
await app.listen({ port, host: "127.0.0.1" });
const { agents, tickets } = office.snapshot();
console.log(`agent-office server on http://127.0.0.1:${port} (${agents.length} agents, ${tickets.length} tickets, runner: ${kind})`);
