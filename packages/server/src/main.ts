import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4177);
const { app, office } = await createServer({ seed: process.env.SEED !== "0" });
await app.listen({ port, host: "127.0.0.1" });
app.log.info(`agent-office server on http://127.0.0.1:${port} (${office.snapshot().agents.length} agents)`);
