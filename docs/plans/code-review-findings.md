# Code review findings

Session of 2026-09-22. A full-codebase review run as three Sonnet subagents, one
per slice (server core and state; process execution and the security surface; UI,
shared and CLI), partitioned so no file was read twice. Roughly 372k tokens total.

Baseline at review time was clean: `pnpm typecheck` green across all four packages,
292 tests passing (255 server, 20 ui, 17 shared, none in apps/cli). Everything below
is therefore a live bug the suite does not catch.

The table is ordered by what I would actually do first, not strictly by severity
label.

**Status, 2026-09-22.** 1, 3, 4, 5, 6, 7, 11 and 12 are fixed, each confirmed
against the source first; see the Outcome section at the end for what was done
and what was deliberately left.

## Findings

| # | Finding | Where | Sev | Verified |
|---|---|---|---|---|
| 1 | `/api/open` has no extension allowlist; one click runs an agent-written `.command`/`.app` | `openPath.ts:72-95` | critical | yes |
| 2 | `/api/hook` unauthenticated + `file_touched` path unvalidated, giving cross-repo diff read | `server.ts:89`, `office.ts:549` | high | yes |
| 3 | `assign()` re-entry starts a second session on one agent, orphaning the first | `office.ts:248-254` | high | yes |
| 4 | `openWindow` leaves the docked terminal mounted, so two writers share one pty | `Terminal.tsx:229` | high | yes |
| 5 | `<primitive>` missing `dispose={null}` over shared GLTF clones | `Furniture.tsx:22`, `Character.tsx:88` | high | yes |
| 6 | `done`/`error` `setTimeout` not cancelled on fire or reassign | `office.ts:427-454` | high | relayed |
| 7 | `respond()` writes to stdin without re-checking `status === "waiting"` | `office.ts:320-341` | high | relayed |
| 8 | POSIX `shQuote` reused for the Windows `.cmd` batch path | `nativeTerminal.ts:182-212` | high | relayed |
| 9 | `/api/file` reads the whole file into memory before applying its 512KB cap | `openPath.ts:117` | medium | yes |
| 10 | UI never runs inbound WS frames through the `ServerMessage` Zod schema | `ui/store.ts:125` | medium | relayed |
| 11 | xterm can `write()` after `dispose()`; `socket.onmessage` never cleared | `Terminal.tsx:89` | medium | relayed |
| 12 | `proc.killed` is always false after a group kill, so the SIGKILL guard is dead | `cliRunner.ts:395` | low | relayed |
| 13 | `office.ts` holds three separate state machines in 620 lines | `office.ts` | low | yes |

"Verified" means read end to end against the source during the review session.
"Relayed" means a subagent reported it and it was not independently confirmed, so
check the code path before fixing.

## The ones that need explaining

**#1, and it is the one to fix first.** This is not an attack path, it is the normal
UI working as designed. `FilePath.tsx` auto-links any path-shaped token in agent
output; clicking a non-previewable one POSTs to `/api/open`, which confines the path
to the allowed roots, stats it, and hands it to `open`. An agent that writes a
`.command` file anywhere under the roots turns a routine click into execution. The
fix already exists in the same file: `/api/file` gates on a `PREVIEWABLE` allowlist a
few lines below. Apply the same shape to `mode: "open"`. `reveal` can stay
unrestricted since it only selects the file in Finder.

Worth noting that the header comment in `openPath.ts` reasons carefully about
metacharacters in filenames and explicitly rejects `cmd /c start` for that reason.
The gap is not carelessness, it is that the threat considered was the filename
rather than the file.

**#2 is narrower than it first looks.** The diff route does gate on `isInsideRoot`,
so this is cross-repo read *within* the configured roots, not arbitrary filesystem
read. Still worth closing: it lets one agent surface diffs from a repo it never
touched, and `/api/snapshot` hands out the agent ids unauthenticated. Validate
`file_touched` paths against the agent's own cwd before storing them.

**#3 is a one-line guard.** `assign()` returns "busy" only when
`state.ticketId !== ticketId`, so reassigning the same ticket to the same working
agent falls straight through to `startSession`. That resets metrics and subagents and
calls `sessions.set`, overwriting the old `RunningSession` without stopping it. Both
processes then emit into the same `AgentState`. Short-circuit when the agent is
already running that exact ticket.

**#4 and #5 are both "the author knew, in the other branch."** `openNative` unmounts
the in-app terminal and says why in a comment; `openWindow` never does, so the docked
`TerminalBody` stays live alongside the popout and both write to one pty. Similarly,
`SkeletonUtils.clone` copies geometry and material by reference, and R3F auto-disposes
a `<primitive>` subtree on unmount unless told otherwise, so firing one agent disposes
resources every other desk is still using.

## Two things no agent could find

There is no ESLint, Prettier or Biome config anywhere in the repo, and no CLAUDE.md.
Given the house rule is to defer to the linter, adding one is probably worth more than
the bottom half of the table above.

Coverage is lopsided: 255 server tests against 20 for 2.5k lines of UI, and none for
`apps/cli`. Findings 4, 5 and 11 all live in the untested UI, which is not a
coincidence. `Terminal.tsx` and `ui/store.ts` are where tests would pay for themselves
fastest.

## Suggested order

1. #1: small, and it is a live foot-gun on every click
2. #3 then #2: cheap guards, real state corruption and real data exposure
3. #4 and #5: UI correctness, both one-liners, both need a regression test
4. #6 and #7: state-machine robustness in `office.ts`
5. Add a linter, then revisit #13 and the rest

## Outcome

| # | Outcome |
|---|---|
| 1 | Fixed. A denylist, not the suggested allowlist: the common case is opening a source file an agent just wrote, and an allowlist wide enough for that is every extension in the repo. Anything carrying the executable bit is refused too, which is what actually makes a file runnable whatever it is called. `reveal` left open. |
| 2 | **Left.** Real, but narrower than it reads — cross-repo read *within* the configured roots. It is the same gap as "no auth for local callers", already tracked, and belongs with it rather than being half-closed here. |
| 3 | Fixed. Short-circuits when the agent is already running that exact ticket. |
| 4 | Fixed. `openWindow` releases the docked terminal, as `openNative` already did. |
| 5 | Fixed. `dispose={null}` on both `<primitive>` sites. |
| 6 | Fixed. One settle timer per agent, cancelled on assign, stop and fire. |
| 7 | Fixed. `respond` returns unless the agent is actually waiting. |
| 8 | **Left.** Confirmed — and already recorded in the milestone-5 handoff as a known Windows gap. The whole Windows handoff path is written from documentation and has never been run, so fixing the quoting without being able to test it would be guessing twice. |
| 9 | **Left.** Reachable only through the extension allowlist, all text, bounded by what an agent writes. |
| 10 | **Left.** The server is the only writer on that socket, and it serialises from the same schema the UI would validate against. |
| 11 | Fixed. The message handler checks `disposed`, and is detached on cleanup. |
| 12 | Fixed. `proc.killed` only reflects `proc.kill()`, and the runner signals the process group, so it never became true and SIGKILL was sent even after a clean exit. The `exited` flag added for `isAlive` is the right check. |
| 13 | **Left.** A refactor, not a fix. |

Both "things no agent could find" stand and are not addressed here: there is still
no linter, and `apps/cli` still has no tests.
