# Agent state, config, and reading what agents write

Session of 2026-09-18, following the macOS verification work in
[macos-verification.md](macos-verification.md). Paused mid-thread; the open
decision is at the bottom and is the first thing to settle.

## What shipped

Eight commits on `main`, nothing pushed. `8159ca3..c0ce17e`.

| Commit | What |
|---|---|
| `8542420` | terminal performance, pop-out, model picker, folder picker at hire |
| `a6cbd62` | docs for the above |
| `3f21591` | **written by two Reviewer agents run from the office**, reviewed before landing: filesystem root confinement + Host/Origin checks |
| `a0eec01` | the "needs you" state actually works; model and permission mode editable |
| `037c3aa` | the question leads the panel, rendered as markdown; files agents write are readable in the app |
| `d378464` | command injection fix on Windows (found by automated security review) |
| `06f6584` | stop showing a second answer box for a prompt the terminal owns |
| `c0ce17e` | relative paths link correctly; `packages/ui` has vitest |

### Three findings worth remembering

**A `result` line ends a turn, not the session.** One `claude -p` run can
re-init and take several turns, emitting a result each. Captured from a real
plan-mode run: two results with a second `system/init` between them. The
parser settled on the first, which marked the ticket done and dropped the
session *while the agent was still working*. This was the actual cause of
"it moves the ticket to done and sits idle". Now settled on process exit.

**Headless Claude Code never signals that it needs you.** Verified by
capturing every hook of a real `claude -p` run: SessionStart,
PreToolUse/PostToolUse pairs, Stop, SessionEnd, and `subtype: "success"`. No
`Notification` hook at all. So `hooks.ts`'s Notification → `waiting` mapping
is dead for ticket runs and only ever worked under `MockRunner`. Detection now
comes from the stream: a turn ending on `ExitPlanMode`/`AskUserQuestion`, or
any completed run by a `plan`-mode agent, which cannot act and so has by
definition produced something for you to decide on.

**The permission modes were wrong.** `claude --permission-mode` accepts
`manual, auto, acceptEdits, plan, dontAsk, bypassPermissions`. The app offered
`"default"`, which is not one of them, and had no `auto`. Agents stored under
the old value migrate to `manual` on load (`legacyPermissionMode`).

## The open decision — settle this first

**Reading files agents write is over-engineered and still does not do the job.**

The approach so far is: find file paths in an agent's prose and make them
clickable. That text is written by a model, so there is always another shape
that was not anticipated. Three wrong ones so far, each fixed by adding a rule:

- absolute-only detection matched *inside* relative paths, so
  `docs/architecture.md` linked to `/architecture.md` (fixed in `c0ce17e`)
- prose like `and/or` linked to `/or` (fixed in `c0ce17e`)
- **globs still link**: `**/*.md` resolves to `<cwd>/**/*.md` (not fixed)

It also does not answer what was actually asked. The ticket that prompted this
was *"find a markdown file in the repo and prompt me so I can view it"* — an
agent being used as a file browser, because the office has not got one, with
the file then printed back into the terminal by hand.

Everything needed already exists and is not wired to anything reachable:
`/api/fs/list` (folder browsing), `/api/file` (reading, root-confined,
text-only), and `FilePreview` (the reading window).

**Recommended:** a Files button on the agent panel that browses its working
folder; click a markdown file, it opens in the existing preview. Then shrink
link detection back to absolute paths only, which are unambiguous — deleting
`resolvePath`'s relative branch, the extension rule, and the `baseDir`
threading through `Markdown`/`AskCard`/`AgentPanel`. **Net less code than now.**

Two alternatives were on the table: just excluding `*` and `?` from path
tokens and stopping there, or removing path linking entirely and adding only
the browser. Johan had not answered when the session ended — he had a question
about the options that was never asked. **Ask before building.**

## Design thought worth picking up (Johan, end of session)

Raised as "just a thought" while heading out, but it reframes the open decision
above, so read it first.

**The panel is a 380px column doing six jobs** — identity, config, the ask, a
terminal, a log, and a fire button. Nothing in it can be good at that width.
The isometric office is the ambient view; selecting an agent probably wants a
proper workspace pane or a full-width sheet, with the log, the terminal and the
changes as siblings rather than stacked in a sidebar.

**The missing content is file diffs.** The log says `Write /path/file.ts` and
stops there — you can see that an agent touched something, never what it did.
Every agent works in a git repo, so `git diff` in its working folder is exactly
"what has this agent changed", and it is far more useful than a list of tool
names. Nothing in the office surfaces it today.

This is also where the VS Code question lands. Johan asked whether VS Code can
run in a browser; it can, three ways (Monaco the embeddable component,
`code serve-web`, or code-server). But the part worth importing is **Monaco's
diff editor** — side-by-side, syntax-highlighted, collapsible — not Monaco as a
file viewer. A unified `git diff` with +/- colouring is perhaps fifty lines and
no bundle cost, so that is the honest first version; Monaco earns its few MB
only once the simple one proves the feature is wanted. Note the UI bundle is
already 1.6 MB with a Vite size warning, so Monaco would need lazy loading.

**How this changes the open decision:** a Changes view may matter more than a
file browser. "What did my agent just do" is a different and probably more
common question than "let me go find a file". Worth settling the panel's shape
before building either.

## Known loose ends

| # | Thing | Notes |
|---|---|---|
| 1 | `**/*.md` links as a path | Confirmed; `resolvePath` accepts any token with a `/` and an extension |
| 2 | Terminal paths are not clickable | The agent literally advises "click the path"; xterm's web-links addon only does URLs. A link provider could route them to `FilePreview` |
| 3 | **Hooks fire for *your* Claude Code sessions** | Hooks live in the agent's project folder, so a Claude Code session you run in that same repo is attributed to the agent. Observed: this session's `mcp__claude-in-chrome__*` calls appearing in Ada's log. This is the stranded-hooks loose end from milestone 5, now actually biting |
| 4 | No auth for non-browser callers | `security.ts` says they are "left to the session token"; there is no session token. Origin/Host stop the drive-by browser attack, nothing stops a local process |
| 5 | Windows native terminal handoff is broken | `buildCommand` POSIX-single-quotes a command that `writeLaunchScript` then writes into a `.cmd` batch file, where `'` is not a quote. Functionally broken rather than a security hole (the cwd is user-chosen, root-confined) |
| 6 | Agents cannot write to the board | No MCP server, no tool. Deferred by agreement to its own session — this is milestone 6's "supply closet" |
| 7 | `packages/shared/src/.index.ts.swp` | Untracked vim swap file, left alone in case the editor is open |

Still open from before: issues
[#2](https://github.com/jozidev/agent-office/issues/2) (tooltip reads 0k/0k)
and [#3](https://github.com/jozidev/agent-office/issues/3) (`setup.ts` seam).
Issue [#1](https://github.com/jozidev/agent-office/issues/1) was closed by
`8542420`.

## State

**Repo**: clean on `main`, 8 commits ahead of `8159ca3`, nothing pushed.

**Checks**, in this order — `apps/cli` typechecks against `packages/server`'s
built `.d.ts`, so build first:

```
pnpm -r build && pnpm -r typecheck && pnpm test
```

All green: **217 tests** (196 server, 11 shared, 10 ui). `pnpm release:dry`
was last run at `8542420` and passed; it has not been run since and new
endpoints have landed, so run it before any release.

**`packages/ui` has vitest now** (added in `c0ce17e`). Pure logic goes in a
React-free module beside the component — see `ui/filePaths.ts` next to
`ui/FilePath.tsx` — so tests need no DOM.

**Environment**: Node v25.6.0, pnpm 10.28.0, `claude` 2.1.276. Scratch project
for real agent runs is `~/Development/agent-office-scratch`. Johan's own office
runs on `:4177`; test servers in this session used `PORT=` with
`AGENT_OFFICE_HOME=` pointed at a scratch dir to avoid touching his database.
Note the CLI takes `PORT`, not `--port`.

**Milestones 1–5 done.** 6 (supply closet) and 7 (usage gauges) are next after
the decision above.
