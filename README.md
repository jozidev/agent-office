# Agent Office

Manage Claude Code agents as characters in an isometric low-poly office. Each agent has a desk and a role; you see at a glance who is busy, idle, or needs you. Hover for a rich tooltip, click for the terminal, drag tickets from the board onto desks.

Status: milestone 5 of 9 (persistence, verified end to end on macOS against the real `claude` CLI). See `docs/architecture.md` for the plan.

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

Agents and the board are stored in SQLite under `~/.agent-office/office.db`, so a
restart puts everyone back at their desks. Live session state is not stored: a
restored agent is idle, and any ticket that was mid-flight goes back to the
backlog, because the `claude` process that was working it is gone. The agent's
last session id is kept, so its terminal can still `--resume` that conversation.

`--no-open` skips opening the browser. `AGENT_OFFICE_HOME` moves the database
elsewhere, `AGENT_OFFICE_PERSIST=0` runs a throwaway office that writes nothing,
and `AGENT_OFFICE_DEBUG=1` turns on full request logging. Demo data (`SEED`) is
only used for an empty office under the mock runner — the real runner would try
to run those tickets in folders that don't exist — and `SEED=1` forces it anyway.

By default the server uses the real `claude` CLI (`CliRunner`) when `claude --version` succeeds on PATH, and falls back to `MockRunner` otherwise. Force one explicitly with `AGENT_OFFICE_RUNNER=cli` or `AGENT_OFFICE_RUNNER=mock`; whichever is active is logged on startup and served at `GET /api/runner`. `CliRunner` spawns `claude -p ... --output-format stream-json --verbose` per ticket in the agent's working folder, and also installs Claude Code hooks + a statusline forwarder into that folder's `.claude/settings.local.json` so interactive `claude` sessions started outside a ticket still show status.

The server depends on two native addons, `node-pty` (terminal) and `better-sqlite3`
(persistence). Both ship prebuilds; if one has to build from source you need Python 3
and a C++ toolchain. If `node-gyp` can't download Node's headers (offline/sandboxed
installs, or a proxy that blocks `nodejs.org`), point it at the headers your local Node
already has instead:

```
npm_config_nodedir=$(dirname $(dirname $(command -v node))) pnpm install
```

`postinstall` runs `scripts/fix-pty-permissions.mjs`, which makes node-pty's
`spawn-helper` executable. Package managers extract it without the executable bit, and
without it *every* pty spawn fails with `posix_spawnp failed.` and the terminal panel
just stays blank.

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
pnpm build        # run first: apps/cli typechecks against packages/server's built .d.ts
pnpm typecheck
pnpm test
pnpm release:dry  # packs the CLI, installs the tarball with npm, runs it, opens a terminal
node scripts/screenshot.mjs screenshots   # needs a server on :4177
```

`release:dry` is the only check that sees what `npx agent-office` actually does:
it packs `apps/cli`, installs the tarball into a temp directory with plain npm
(so both native dependencies come from the registry), starts the installed
binary, and confirms it serves the UI and can open a working pty.
