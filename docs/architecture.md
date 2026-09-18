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
- **Session runner**: per ticket, spawns `claude -p "<ticket>" --output-format stream-json --verbose` in the agent's cwd with the agent's flags. Parses the JSON stream for messages, tool use, usage, cost, and result. Session id kept for `--resume`. Currently `MockRunner`.
- **Terminal manager**: spawns `claude --resume <sessionId>` in a node-pty; streams to xterm.js. Pty stays alive when the popup closes; killed on agent delete.
- **Hook receiver**: `POST /api/hook`. On agent creation the app writes hooks into the agent project's `.claude/settings.local.json` plus a statusline command that forwards context-window JSON. Normalised into `RunnerEvent`s.
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
3. Real sessions via headless CLI; hooks and statusline forwarder.
4. Pty terminal popup and chat-box UI.
5. `npx` first-run setup (checks `claude` is installed and logged in).
6. Inventory: supply closet UI.
7. Usage collector, office gauges, stats view.
8. Optional SDK / API-key mode.
9. Tauri shell.

## References

- Agent SDK overview (login restriction): https://code.claude.com/docs/en/agent-sdk/overview
- Hooks: https://code.claude.com/docs/en/hooks
- Statusline: https://code.claude.com/docs/en/statusline
- Sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- MCP: https://code.claude.com/docs/en/mcp
- Skills: https://code.claude.com/docs/en/skills
- Plugins: https://code.claude.com/docs/en/plugins
- Subagents: https://code.claude.com/docs/en/sub-agents
