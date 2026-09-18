# Agent Office

Manage Claude Code agents as characters in an isometric low-poly office. Each agent has a desk and a role; you see at a glance who is busy, idle, or needs you. Hover for a rich tooltip, click for the terminal, drag tickets from the board onto desks.

Status: milestone 4 of 9 (real sessions via headless CLI, hooks, terminal popup and chat UI). See `docs/architecture.md` for the plan.

## Run

```
pnpm install
pnpm dev          # server on :4177, Vite UI on :5173
```

Production-style single process (what `npx agent-office` will do):

```
pnpm build
node apps/cli/dist/index.js      # serves the built UI on http://127.0.0.1:4177
```

`SEED=0` starts with an empty office. `--no-open` skips opening the browser.

By default the server uses the real `claude` CLI (`CliRunner`) when `claude --version` succeeds on PATH, and falls back to `MockRunner` otherwise. Force one explicitly with `AGENT_OFFICE_RUNNER=cli` or `AGENT_OFFICE_RUNNER=mock`; whichever is active is logged on startup and served at `GET /api/runner`. `CliRunner` spawns `claude -p ... --output-format stream-json --verbose` per ticket in the agent's working folder, and also installs Claude Code hooks + a statusline forwarder into that folder's `.claude/settings.local.json` so interactive `claude` sessions started outside a ticket still show status.

The server depends on `node-pty` (used for the terminal popup, milestone 4), which ships as a
native addon and needs a compiler toolchain (Python 3 + a C++ toolchain) the first time you
`pnpm install`. If `node-gyp` can't download Node's headers (offline/sandboxed installs, or a
proxy that blocks `nodejs.org`), point it at the headers your local Node already has instead:

```
npm_config_nodedir=$(dirname $(dirname $(command -v node))) pnpm install
```

If `claude` isn't installed at all, the terminal popup falls back to your shell with a one-line
notice instead of failing.

## Layout

```
packages/shared   Zod schemas and role presets shared by server and UI
packages/server   Fastify + WebSocket, agent registry, session runners (mock + real CLI), hooks
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
