# macOS verification log

Everything through milestone 4 was built in a sandbox with no network access to
Claude, so nothing had ever run against the real `claude` CLI end to end. This
log records what the first real run on macOS turned up.

Machine: macOS (darwin 25.5.0, arm64), Node v25.6.0, pnpm 10.28.0, `claude` 2.1.276.

## Environment notes

- `pnpm` was not installed on this machine; `npm i -g pnpm@10.28.0` first.
- `node-pty` 1.1.0 needs no compiler here: it ships a `darwin-arm64` N-API
  prebuild that loads fine under Node 25. The README's `npm_config_nodedir`
  workaround was not needed.
- `pnpm -r typecheck` fails from a clean checkout until `pnpm -r build` has run
  once, because `apps/cli` imports `@agent-office/server`'s built `.d.ts`.
  Order is build, then typecheck.

## Bugs

| # | Bug | Severity | Status |
|---|---|---|---|
| 1 | A failed `claude` spawn killed the whole server | high | fixed |
| 2 | Demo seed ran real sessions in folders that don't exist | high | fixed |
| 3 | Hiring into a non-existent folder silently created it | medium | fixed |
| 4 | node-pty's spawn-helper installs without its executable bit, so no terminal ever opened | high | fixed |

### 1. A failed spawn took the server down

`CliRunner.start` attached no `error` listener to the child process, so any
spawn failure surfaced as an unhandled `error` event and exited the process.
One bad agent folder killed the office for every other agent.

Fixed in `cliRunner.ts`: an `error` listener turns the failure into a normal
`error` RunnerEvent for that one session, and the close handler no longer
double-reports it. A missing working folder is now detected before spawning,
because Node reports a missing `cwd` as `ENOENT` naming the *binary*, which
reads as "claude is not installed" and sends you hunting in the wrong place.

### 2. The demo seed ran real sessions

`seed()` hires four agents in invented folders (`~/code/shop-api`, ...) and
assigns two tickets immediately. With the real runner selected (any machine
with `claude` on PATH) that spawned `claude` in a folder that does not exist,
which — via bug 1 — crashed the server on startup. This was the entire
`npx agent-office` first-run path.

Fixed in `server.ts`: `shouldSeed()` gates the demo office on the mock runner.
The real runner starts empty; `SEED=1` still forces the demo for screenshots.

### 3. Hiring created folders

`installHooks` wrote `<cwd>/.claude/settings.local.json` with
`mkdir(recursive: true)`, so hiring an agent at a path that doesn't exist
invented the whole path rather than failing. A typo in the hire form would
scatter `.claude` folders around the disk. `installHooks` now requires the
folder to exist.

### 4. Every pty spawn failed: `posix_spawnp failed.`

Clicking an agent opened a permanently blank terminal. No claude process was
ever spawned, nothing appeared in the server output, and the client sat in a
reconnect loop.

Two causes stacked:

- `apps/cli` starts the server with `logger: false`, so the Fastify error was
  swallowed. Running `main.ts` (logger on) surfaced `posix_spawnp failed.`
  thrown by node-pty.
- node-pty ships `prebuilds/<platform>/spawn-helper`, and pnpm 10 extracted it
  as `-rw-r--r--`. Without the executable bit node-pty cannot spawn anything,
  not even `/bin/zsh`. `chmod +x` fixed every spawn immediately.

Fixed with `scripts/fix-pty-permissions.mjs`, run on postinstall from both the
workspace root and the published CLI package (npx installs node-pty fresh, so
it needs the same repair). The terminal route now also reports a spawn failure
into the terminal instead of closing the socket with no explanation.

## Verified working end to end

Against the real `claude` 2.1.276, runner `cli`, agent folder
`~/Development/agent-office-scratch`:

- Hire writes hooks + statusline into `<folder>/.claude/settings.local.json`.
- Drag-to-assign starts a real headless session; `hello.txt` and `goodbye.txt`
  were actually written by the agent.
- Ticket moved backlog to assigned to in_progress to done; agent returned to idle.
- Setup page "Claude Code hooks reachable" went to ok (5 hook events), overall ok.
- Tooltip showed live turns, elapsed, cost, context bar and the current tool.
- Idle "zzz" bubble appears after ~15s; typing animation while busy.
- Terminal panel runs `claude --resume <session id> --model sonnet
  --permission-mode acceptEdits` in a pty (confirmed in `ps`).
- Chat agent (no tools) answered a question through `/ws/chat/:agentId`.

Note for the docs: the first interactive terminal in a folder hits Claude
Code's own "Is this a project you trust?" prompt, which the user must answer in
the terminal before the resumed session appears. Not a bug, but nothing in
`docs/architecture.md` prepares you for it.
