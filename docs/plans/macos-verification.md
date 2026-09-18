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
| 5 | Every tool call was logged twice during a ticket run | medium | fixed |
| 6 | An empty office rendered as a black void in production builds | medium | fixed |

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

### 5. Every tool call logged twice

`docs/architecture.md` describes `ingestExternal` as the path "for sessions the
office didn't start itself". It isn't: hooks are installed in the agent's
*folder*, so they fire for the office's own headless `claude -p` ticket runs as
well. Every tool call arrived twice — once from the runner's NDJSON stream,
once from PreToolUse — and the event log showed each Write and Bash twice.

`ingestExternal` and `forceIdle` now ignore events for an agent whose ticket
session is still running: while the office started the session, that session's
own stream is the authority.

### 6. An empty office was a black void

A fresh `npx agent-office` (no agents yet) showed nothing but the HUD. The
canvas sat at the HTML default 300x150 while every container around it measured
1271x986: react-three-fiber missed its first measurement of the container and
nothing ever forced a re-measure, because with no agents no store update
arrives. Hiring someone, or any window resize, fixed it instantly.

Only reproducible in a production build — StrictMode's double render hides it
in `pnpm dev`, which is why it survived four milestones. `<Canvas>` now passes
`resize={{ debounce: 0, scroll: false }}`.

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

## Left as GitHub issues

| # | Issue | Why not fixed here |
|---|---|---|
| [#1](https://github.com/jozidev/agent-office/issues/1) | Hiring into a folder that doesn't exist fails silently | Needs hire-flow validation and modal error handling, not a one-line guard |
| [#2](https://github.com/jozidev/agent-office/issues/2) | Tooltip shows "0k/0k" tokens while cost reads $0.06 | Cache reads dominate real sessions; needs a display decision |
| [#3](https://github.com/jozidev/agent-office/issues/3) | `setup.ts` has no tests and needs a seam to get any | Requires injecting homedir and the command runner first |

Also fixed in passing: the CLI ran the server with `logger: false`, which is
what hid bug 4 behind a blank panel. It now logs at `warn` (set
`AGENT_OFFICE_DEBUG=1` for full request logging). Stale milestone copy on the
Setup page was corrected.

## Milestone 5

Agents and tickets now persist to SQLite at `~/.agent-office/office.db`; see
"Milestone 5 notes" in `docs/architecture.md` for what is and isn't stored and
why. Verified by hiring an agent, creating a ticket, killing the server and
starting it again: agent back at desk 0, ticket back on the board.

`pnpm release:dry` packs the CLI, installs the tarball with plain npm, runs the
installed binary and opens a terminal through it. Writing it immediately caught
two packaging bugs the workspace cannot show you:

- `better-sqlite3` cannot be bundled by tsup — it pulls in `bindings`, whose
  `__filename` cannot coexist with the top-level await in an ESM bundle. It is
  external now, like node-pty.
- The spawn-helper fix from bug 4 did not work under npm at all: npm *hoists*
  node-pty to a sibling of the installed package, and the fixer only looked
  inside the package's own `node_modules`. It now walks parent directories and
  resolves the copy Node itself would load.

One loose end worth knowing: hooks are written into an agent's project folder
and only removed when you fire the agent. Killing the server leaves them behind,
pointing at a port with nothing on it. They fail silently (`curl -s ... >/dev/null`)
so nothing breaks, and restored agents get theirs rewritten on boot, but an agent
whose database entry is gone leaves its hooks stranded in that folder.

## Handoff

State at the end of the macOS verification session (2026-09-18).

**Repo**: clean on `main`, 5 commits ahead of `7d11268`, nothing pushed yet.

```
e9f0e92 feat: persist agents and tickets in SQLite, add a release dry run
ff880a1 fix: surface server errors from the CLI, refresh stale setup copy
5b6daeb fix: stop double-logging tool calls, and render an empty office
9c74d8e fix: make node-pty's spawn-helper executable so terminals can spawn
bca996c fix: survive failed claude spawns, and stop demo seed from running real sessions
```

**Checks**: `pnpm -r build` first (apps/cli typechecks against packages/server's
built `.d.ts`), then `pnpm -r typecheck`, `pnpm test` (82 tests), and
`pnpm release:dry` for the packaging path. All green as of the last commit.

**Environment gotchas on this machine**: `pnpm` had to be installed globally
(`npm i -g pnpm@10.28.0`); Node is v25.6.0; `claude` is 2.1.276. Test scratch
project lives at `~/Development/agent-office-scratch` (holds `hello.txt` and
`goodbye.txt` written by real agents; its `.claude/settings.local.json` is an
empty `{}` left behind by uninstallHooks).

**Milestones 1-5 done.** Next up is 6 (supply closet: MCP servers, skills,
plugins, subagent definitions) and 7 (usage collector and office gauges).

**Open before starting 6**, all filed with full context:

- ~~[#1](https://github.com/jozidev/agent-office/issues/1) hiring into a folder that doesn't exist fails silently~~ — fixed, see "Terminal and hire flow" below
- [#2](https://github.com/jozidev/agent-office/issues/2) tooltip reads "0k/0k" tokens while cost reads $0.06
- [#3](https://github.com/jozidev/agent-office/issues/3) `setup.ts` has no tests and needs a seam first

**Unfiled loose end**: hooks are written into an agent's project folder and only
removed when the agent is fired, so an agent whose database row disappears
leaves them stranded (they fail silently). Worth deciding on during milestone 6,
since that milestone owns config management.

**Note for the next session**: the user had notes to pass on that did not come
through the terminal (the message arrived as "some notes:" with nothing after
it, twice). Ask for them before picking up new work.

## Terminal and hire flow (2026-09-18, second session)

Feedback after using the app for real: the terminal felt laggy, "pop out" was
clipped by the panel, and hiring let you pick neither the model nor the folder.

**Why the terminal was slow.** Three things stacked. xterm.js was on its DOM
renderer, which is the worst case for a TUI that repaints on every keystroke;
the server sent one WebSocket frame per `pty.onData` chunk, so one repaint
became dozens of frames; and `convertEol: true` rewrote `\n` for a pty that
already sends `\r\n`. Now: WebGL (falling back to DOM on context loss),
~4ms output batching, no convertEol, fits coalesced per frame, and the pty
spawns at the size the client already measured instead of 100x30-then-reflow.

**Why "pop out" was clipped.** `.float-window` is `position: absolute` and was
rendered inside `.panel`, which is `overflow: hidden` and 380px wide. Portalled
to `<body>` now. There are three ways out of the panel, because they serve
different moments: `float` (in-page), `window` (a real OS window at
`/terminal/:agentId`, works everywhere), and `open in <your terminal>`.

**The native handoff assumes no particular terminal.** `nativeTerminal.ts`
probes for every terminal installed, the choice is picked from a dropdown and
remembered, and a machine with no GUI terminal hands back the command to paste.
Resolution order is saved choice, then `$AGENT_OFFICE_TERMINAL_APP`, then
detection — the saved choice wins deliberately, or picking in the UI would do
nothing on a machine that exports the env var. On handoff the in-app pty is
released, because Claude Code will not resume one session in two places.
Windows support is written from the documented flags and has not been run.

**Hiring** gained a model picker (pinned ids, Opus 5 default — an agent keeps
the model it was hired with) and a folder browser backed by `/api/fs/list`.
Typed paths are checked before the hire goes through, which is what #1 needed.

**New seam:** a `settings` key/value table in `store.ts`. Milestones 6 and 7
both want machine-level preferences; this is where they go.

**Still true for the next session:** milestone 6 (supply closet) and 7 (usage
gauges) are next, #2 and #3 are still open, and the stranded-hooks loose end is
still unfiled.
