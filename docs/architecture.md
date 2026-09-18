# Agent Office: architecture and decisions

Last updated: 2026-09-18. Canonical copy lives in the Claude Project "agentic UI" (design/architecture.md); this is a snapshot for whoever works in the repo.

## Concept

A local app for managing Claude Code agents as characters in an isometric low-poly office. Each agent has a desk and a role. You see at a glance who is busy, idle, or waiting for input. Hovering an agent shows a rich tooltip; clicking opens its terminal (or a chat box for chat-role agents). Subagents appear as a video-call bubble above the parent. A kanban board lets you create tickets and drag them onto agents. Office props double as usage gauges (limits, resets, spend). A supply closet manages MCP servers, skills, plugins, and subagent definitions, globally and per agent.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Agent backend | Real `claude` CLI in a pty, headless `claude -p --output-format stream-json` for ticket dispatch, hooks for state. Agent SDK only as optional API-key mode. | Anthropic docs prohibit third-party products offering claude.ai (Pro/Max) login, including SDK-built agents. Running the user's own CLI is Claude Code itself and works with subscriptions. |
| State tracking | Claude Code hooks (SessionStart, PreToolUse, PostToolUse, SubagentStop, Stop, SessionEnd, Notification) POSTing to the local server; statusline command forwarding context-window JSON | Reliable for both headless and interactive sessions; no terminal parsing |
| Roles | Hire presets: Coder, Reviewer, Chat, Assistant, plus custom | Gives non-technical users chat/assistant agents without new backend; different costume per role |
| Subagents | Shown as a video-call bubble above the parent, one tile per live subagent; inspect and define, no per-subagent kill | Detected from PreToolUse on the Agent tool and SubagentStop; Claude Code offers no way to stop one subagent alone |
| Config management | MCPs, skills, plugins, subagent definitions, CLAUDE.md and settings managed through the app, per agent (project scope) and global (user scope) | All file- and CLI-based, documented, per-project scoping maps directly onto per-agent folders |
| Chat / Cowork / cloud sessions | Not integrated | No API or local surface exists; scraping would be brittle and against ToS |
| Distribution v1 | `npx agent-office`: local Node server + browser tab | No packaging, fastest iteration |
| Distribution v2 | Tauri desktop app wrapping the same server as a sidecar | Native Mac/PC feel; nothing rewritten |
| Art style | Low-poly isometric, fixed orthographic camera. CC0 packs (Kenney) for models where they beat procedural geometry. | Readable, cheap, no licensing work |
| Stack | TypeScript, pnpm monorepo. UI: Vite + React + react-three-fiber + drei + Zustand + xterm.js. Server: Node + Fastify + ws + node-pty + better-sqlite3. Shared: Zod schemas. No Next.js. | SPA against a local WebSocket server; SSR adds nothing and conflicts with the Tauri sidecar model |

## Packages

```
agent-office/
  packages/
    server/    Node: agent registry, session runner (CLI headless + pty), hook receiver, inventory manager, usage collector, SQLite, WebSocket
    ui/        Vite + React + react-three-fiber + xterm.js
    shared/    Types and event schemas shared by both
  apps/
    cli/       the `npx agent-office` entry point (starts server, serves UI, opens browser)
    desktop/   (later) Tauri shell with server as sidecar
```

Rule: anything that touches the filesystem, processes, or the CLI lives in `server`. The UI only speaks WebSocket. Server modules sit behind interfaces (`SessionRunner`) so alternatives (CLI runner, SDK runner) are a second implementation, not a rewrite.

## Server

- **Agent registry**: record per agent (id, name, role preset, colour, model, working directory, system prompt, allowed tools, permission mode, desk). In-memory now; SQLite under `~/.agent-office/` later.
- **Role presets**: Coder (full tools, acceptEdits, terminal UI), Reviewer (read-only, plan mode), Chat (no tools, chat UI), Assistant (file and web tools, chat UI), Custom.
- **Session runner**: per ticket, spawns `claude -p "<ticket>" --output-format stream-json --verbose` in the agent's cwd with the agent's flags. Parses the JSON stream for messages, tool use, usage, cost, and result. Session id kept for `--resume`. `CliRunner` (real) and `MockRunner` (demo/dev) both implement `SessionRunner`; `pickRunner()` chooses between them (env override, else whether `claude` is on PATH).
- **Terminal manager**: spawns `claude --resume <sessionId>` in a node-pty; streams to xterm.js. Pty stays alive when the popup closes; killed on agent delete.
- **Hook receiver**: `POST /api/hook` and `POST /api/statusline`. On hire the app writes hooks (SessionStart, PreToolUse, PostToolUse, SubagentStop, Stop, SessionEnd, Notification) into the agent project's `.claude/settings.local.json` (`hooks.ts: installHooks`/`uninstallHooks`, everything it owns marked `agent-office`) plus a statusline command that forwards context-window JSON. Normalised into `RunnerEvent`s (`hooks.ts: hookToEvents`) and applied via `Office.ingestExternal`/`forceIdle`, which update status/subagents/log the same way a ticket-driven session does but never touch ticket state — so an interactive terminal session in an agent's folder shows status without needing a ticket, without a stray `Stop`/`SessionEnd` from that session ending a real ticket run.
- **Subagent tracking**: PreToolUse on the Agent tool gives type, description, prompt; SubagentStop closes it. No per-subagent stop exists.
- **Board**: tickets; assign = start a session run. One ticket per agent at a time.
- **Inventory manager**: MCP servers (`claude mcp`, `~/.claude.json`, `.mcp.json`), skills (`SKILL.md` folders), plugins (`claude plugin`, `enabledPlugins`), subagent definitions (`.claude/agents/*.md`), CLAUDE.md and settings editor.
- **Usage collector**: transcripts under `~/.claude/projects/**/*.jsonl` (undocumented format, parse defensively); plan limits via whatever `/usage` calls, with transcript-based estimation as fallback.
- **Transport**: single WebSocket, JSON messages validated with Zod on both ends.

## UI

- **Office scene**: orthographic isometric camera, desks on a grid, character per role. Animations by status: idle sway (+ zzz after 15s), typing bob when busy, bounce with "?" when waiting, hop with check when done, slump with "!" on error.
- **Subagent call bubble**: video-call tiles above the parent, one per live subagent, "+N" overflow.
- **Hover tooltip**: name, role, status, ticket, doing-now, turns, elapsed, tokens, cost, context bar, subagents.
- **Usage props**: clock, coffee machine, whiteboard, server-room door. Placeholders until milestone 7.
- **Supply closet**: inventory view (milestone 6).
- **Agent panel**: details, waiting prompt with reply box, event log, terminal/chat (milestone 4), stop, fire.
- **Board**: kanban slide-over; drag a ticket to a column or onto a desk.
- **Hire modal**: role preset, name, folder, extra instructions.

## Milestones

1. Scaffold; office scene with mocked agents, roles, statuses, tooltips, call bubble. Done.
2. Board with drag-to-assign; mocked sessions. Done.
3. Real sessions via headless CLI; hooks and statusline forwarder. Done.
4. Pty terminal popup and chat-box UI. Done.
5. `npx` first-run setup (checks `claude` is installed and logged in).
6. Inventory: supply closet UI.
7. Usage collector, office gauges, stats view.
8. Optional SDK / API-key mode.
9. Tauri shell.

## Milestone 3 notes

Verified against `claude` 2.1.276 (Claude Code) with `--output-format stream-json --verbose`. NDJSON fixtures captured from real runs live in `packages/server/src/__fixtures__/` and drive `cliRunner.test.ts`.

- This account's CLI build emits extra NDJSON message types beyond the documented minimum (`active_goal`, `autocompact_state`, `rate_limit_event`, `stream_event` for token-level streaming deltas). The parser only reacts to `system`/`assistant`/`result` and ignores everything else, so this is harmless and future-proof against new types.
- The subagent tool this build launches is named **`Agent`**, not `Task`; the parser accepts either name. Its `input` had no `subagent_type` field (only `description`/`prompt`), so we default to `"general-purpose"`.
- A subagent's own tool calls arrive as ordinary `assistant` messages carrying `parent_tool_use_id` set to the `Agent`/`Task` tool_use's id — that id doubles as the subagent id everything else (Office, the UI tiles) keys on.
- Each assistant message's `usage` block (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) is per-turn, not cumulative, so CliRunner sums them itself for the running totals shown in the UI; `total_cost_usd` (cumulative) only appears on the final `result` message. Context-window percentage is computed per message directly (`(input + cache_read + output) / 200000`), not from the running sums, since `cache_read_input_tokens` already reflects how much prior conversation is in context.
- A failed run surfaces as `{"type":"result","subtype":"error_max_turns" (or other non-"success"),"is_error":true}` — confirmed by forcing `--max-turns 1` against a multi-tool-call prompt.
- Hooks (https://code.claude.com/docs/en/hooks) and statusline (https://code.claude.com/docs/en/statusline) field names were confirmed against the current docs, not just this account's CLI, since hooks weren't exercised as thoroughly as the stream-json parser: `hook_event_name`, `session_id`, `tool_name`, `tool_input`, `tool_use_id`, `agent_id` (subagent-only), `notification_type`/`message` (Notification), `last_assistant_message` (Stop/SubagentStop). Statusline's simplest context source is `context_window.used_percentage` (0–100).
- End-to-end smoke test: hired a real agent, assigned a ticket, let `CliRunner` run the actual `claude` CLI end to end — hooks installed into `.claude/settings.local.json`, hook POSTs arrived at `/api/hook` (`hooks-reachable` setup check went to `ok`), and the session's own `usage`/`context`/`done` events drove the agent to `idle` on completion.
- Not verified: a real `waiting` (permission-prompt) hook `Notification`, since headless `-p` sessions with `acceptEdits`/`bypassPermissions` never prompt; the mapping in `hooks.ts` follows the documented `notification_type`/`message` fields but wasn't exercised against a live prompt. Also not verified: hooks firing from an actual interactive `claude --resume` terminal session (pty terminal is milestone 4) — `ingestExternal`/`forceIdle` are covered by unit tests only.

## References

- Agent SDK overview (login restriction): https://code.claude.com/docs/en/agent-sdk/overview
- Hooks: https://code.claude.com/docs/en/hooks
- Statusline: https://code.claude.com/docs/en/statusline
- Sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- MCP: https://code.claude.com/docs/en/mcp
- Skills: https://code.claude.com/docs/en/skills
- Plugins: https://code.claude.com/docs/en/plugins
- Subagents: https://code.claude.com/docs/en/sub-agents
