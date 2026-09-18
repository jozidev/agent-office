# Agent Office

Manage Claude Code agents as characters in an isometric low-poly office. Each agent has a desk and a role; you see at a glance who is busy, idle, or needs you. Hover for a rich tooltip, click for the terminal, drag tickets from the board onto desks.

Status: milestone 2 of 9 (office scene, board, mocked sessions). See `docs/architecture.md` for the plan.

## Run

```
pnpm install
pnpm dev          # server on :4177 with mock agents, Vite UI on :5173
```

Production-style single process (what `npx agent-office` will do):

```
pnpm build
node apps/cli/dist/index.js      # serves the built UI on http://127.0.0.1:4177
```

`SEED=0` starts with an empty office. `--no-open` skips opening the browser.

## Layout

```
packages/shared   Zod schemas and role presets shared by server and UI
packages/server   Fastify + WebSocket, agent registry, session runner interface, mock runner
packages/ui       Vite + React + react-three-fiber office, board, panels
apps/cli          single-file bundle: starts the server and serves the UI
scripts/          screenshot.mjs (Playwright smoke run against a running server)
```

The UI only speaks WebSocket. Anything touching processes or the filesystem lives in `server`, so the later Tauri desktop shell wraps the same server as a sidecar.

## Checks

```
pnpm typecheck
pnpm test
node scripts/screenshot.mjs screenshots   # needs a server on :4177
```
