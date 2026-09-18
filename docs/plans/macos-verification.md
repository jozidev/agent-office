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
