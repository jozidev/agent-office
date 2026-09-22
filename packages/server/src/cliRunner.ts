import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { contextWindowFor } from "@agent-office/shared";
import type { Agent, RunnerEvent, Ticket } from "@agent-office/shared";
import type { RunningSession, SessionRunner } from "./runner.js";
import { touchedPath } from "./claudeTools.js";
import { agentEnv } from "./hooks.js";
import { expandHome } from "./setup.js";

/**
 * Parser + process management for real headless sessions, verified against
 * `claude` 2.1.276 (Claude Code) on 2026-09-18 by running:
 *   claude -p "Reply with the single word pong" --output-format stream-json --verbose --max-turns 1
 *   claude -p "List the files ... using the Bash tool ..." --output-format stream-json --verbose --allowedTools Bash --permission-mode acceptEdits
 *   claude -p "Use the Task tool to launch a general-purpose subagent ..." --output-format stream-json --verbose --allowedTools Task,Bash --permission-mode acceptEdits
 *   claude -p "..." --output-format stream-json --verbose --allowedTools Bash --permission-mode acceptEdits --max-turns 1   (forced error_max_turns)
 * NDJSON captured from those runs lives in ./__fixtures__ and drives cliRunner.test.ts.
 *
 * Observed shape (this account's CLI build emits a few extra message types
 * — active_goal, autocompact_state, rate_limit_event, stream_event — beyond
 * the documented minimum; the parser below only reacts to the types the
 * milestone cares about and silently ignores everything else, so those
 * extras and any future additions are harmless):
 *   {"type":"system","subtype":"init","session_id":...,"cwd":...,"model":...,...}
 *   {"type":"assistant","message":{"content":[...]},"parent_tool_use_id":null|string,"session_id":...}
 *   {"type":"user","message":{"content":[{"type":"tool_result",...}]},"parent_tool_use_id":...}
 *   {"type":"result","subtype":"success"|"error_max_turns"|...,"is_error":bool,"result":"...","usage":{...},"total_cost_usd":...}
 * Assistant message content blocks seen: {"type":"text","text":...} and
 * {"type":"tool_use","id":...,"name":...,"input":{...}}. A subagent is
 * launched via a tool_use block named "Agent" (this build's name for the
 * Task tool — "Task" is kept as a fallback in case another build/version
 * uses that name); its own tool calls arrive as ordinary "assistant"
 * messages carrying `parent_tool_use_id` set to that tool_use's id, which
 * doubles as the subagent id Office.onEvent matches on. The "Agent" tool
 * input observed had no `subagent_type` field, so we default to
 * "general-purpose" when it's missing.
 */


function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Length-capped but structure-preserving, for text meant to be read rather
 * than skimmed in a log line. `truncate` flattens every newline into a space,
 * which turned a review's headings, tables and code blocks into one unbroken
 * paragraph by the time they reached the panel.
 */
function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Build a short "doing now" string from a tool_use input, e.g. a file path or command. */
function summarizeToolInput(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i["file_path"] ?? i["path"] ?? i["command"] ?? i["pattern"] ?? i["url"] ?? i["description"] ?? i["prompt"];
  const s = typeof pick === "string" ? pick : JSON.stringify(i);
  return truncate(s, 60);
}

/**
 * Tools that exist to hand the turn back to the user. A headless `claude -p`
 * cannot prompt, so calling one of these ends the run — the stream reports a
 * perfectly successful `result` and the office used to call that "done". It is
 * not done; it is waiting on you.
 */
const ASK_TOOLS = new Set(["ExitPlanMode", "AskUserQuestion"]);

/**
 * Log lines get 300 characters because they scroll past. A question does not:
 * it is the one thing you have to read to answer, and a plan cut off at
 * "Findings, worst first…" is useless.
 */
const QUESTION_LIMIT = 8000;

/** The question to show on the agent's bubble, dug out of the ask tool's input. */
function askPrompt(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (tool === "AskUserQuestion") {
    const questions = Array.isArray(i["questions"]) ? (i["questions"] as Record<string, unknown>[]) : [];
    const first = questions[0]?.["question"];
    if (typeof first === "string") return clamp(first, QUESTION_LIMIT);
  }
  if (typeof i["plan"] === "string") return clamp(i["plan"] as string, QUESTION_LIMIT);
  return `${tool} needs your answer`;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Loose shape of one NDJSON line; every field is optional because unknown/future types must not crash the parser. */
interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: ContentBlock[]; usage?: AnthropicUsage };
  usage?: AnthropicUsage;
  total_cost_usd?: number;
  is_error?: boolean;
  result?: string;
}

/**
 * Stateful NDJSON -> RunnerEvent parser, factored out of CliRunner so it can
 * be driven directly by tests against recorded fixtures without spawning a
 * process. One instance per session.
 */
export interface StreamParserOpts {
  /**
   * True when the agent runs in `plan` permission mode. Plan mode cannot act —
   * it can only propose — so a run that finishes has by definition produced
   * something for you to approve, whether or not it got as far as calling
   * ExitPlanMode. Without this, every plan-mode ticket reported itself done
   * and the agent went idle with your decision still outstanding.
   */
  proposesOnly?: boolean;
  /** The model's context window; the gauge is meaningless without it. */
  contextWindow?: number;
}

export function createStreamParser(emit: (e: RunnerEvent) => void, opts: StreamParserOpts = {}) {
  // Running totals: token counts accumulate across turns (real session
  // cost is the sum of each turn's contribution); cost comes verbatim
  // from the "result" message's total_cost_usd once it arrives.
  let sumInput = 0;
  let sumOutput = 0;
  let sumCacheRead = 0;
  let lastCostUsd = 0;
  const openSubagents = new Set<string>();
  let gotResult = false;
  /** Set when the turn's last action was asking the user something. */
  let pendingAsk: { tool: string; prompt: string } | null = null;
  /** The last "result" seen, settled once the process exits. */
  let outcome: { failed: boolean; text: string; ask: string | null } | null = null;

  const closeAllSubagents = () => {
    for (const id of openSubagents) emit({ kind: "subagent_stop", id });
    openSubagents.clear();
  };

  const applyUsage = (usage: AnthropicUsage | undefined, totalCostUsd: number | undefined) => {
    if (!usage) return;
    sumInput += usage.input_tokens ?? 0;
    sumOutput += usage.output_tokens ?? 0;
    sumCacheRead += usage.cache_read_input_tokens ?? 0;
    if (totalCostUsd !== undefined) lastCostUsd = totalCostUsd;
    emit({ kind: "usage", input: sumInput, output: sumOutput, cacheRead: sumCacheRead, costUsd: lastCostUsd });
  };

  const handleAssistant = (line: StreamLine) => {
    const content = line.message?.content ?? [];
    const inSubagent = Boolean(line.parent_tool_use_id);
    for (const block of content) {
      if (block.type === "text" && block.text && !inSubagent) {
        emit({ kind: "thinking" });
      } else if (block.type === "tool_use") {
        const name = block.name ?? "Tool";
        const summary = summarizeToolInput(block.input);
        // Only the main agent can be waiting on the user; a subagent's
        // ExitPlanMode is its own business. Any other tool means the turn
        // carried on, so an earlier ask no longer stands.
        if (!inSubagent) pendingAsk = ASK_TOOLS.has(name) ? { tool: name, prompt: askPrompt(name, block.input) } : null;
        if (inSubagent) {
          emit({ kind: "subagent_tool", id: line.parent_tool_use_id as string, name, summary });
        } else if (name === "Agent" || name === "Task") {
          const input = (block.input ?? {}) as { subagent_type?: string; description?: string };
          const id = block.id ?? "";
          if (id) openSubagents.add(id);
          emit({ kind: "subagent_start", id, type: input.subagent_type ?? "general-purpose", description: input.description ?? "" });
        } else {
          emit({ kind: "tool_use", name, summary });
          const path = touchedPath(name, block.input);
          if (path) emit({ kind: "file_touched", path });
        }
      }
    }
    const u = line.message?.usage;
    applyUsage(u, undefined);
    if (u && !inSubagent) {
      const pct = ((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)) / (opts.contextWindow ?? contextWindowFor(null));
      emit({ kind: "context", pct: clamp01(pct) });
    }
  };

  /**
   * A "result" line ends a *turn*, not the session: one `claude -p` run can
   * re-init and take several turns, emitting one result each. Emitting on the
   * first one marked the ticket done and dropped the session while the agent
   * was still working. So record the outcome and settle it once the process
   * actually exits, keeping whichever result came last.
   */
  const handleResult = (line: StreamLine) => {
    gotResult = true;
    applyUsage(line.usage, line.total_cost_usd);
    const failed = Boolean(line.is_error) || (line.subtype !== undefined && line.subtype !== "success");
    outcome = {
      failed,
      text: line.result ?? (failed ? "session ended with an error" : "done"),
      ask: pendingAsk?.prompt ?? null,
    };
  };

  /** Turn the last recorded result into the one event that ends the session. */
  const settle = () => {
    if (!outcome) return;
    const { failed, text, ask } = outcome;
    outcome = null;
    if (failed) {
      emit({ kind: "error", message: truncate(text, 300) });
      return;
    }
    // A clean result after an ask — or from an agent that can only propose —
    // is the headless CLI saying "I can't prompt you, so I stopped".
    if (ask || opts.proposesOnly) emit({ kind: "waiting", prompt: ask || clamp(text, QUESTION_LIMIT) });
    else emit({ kind: "done", summary: truncate(text, 300) });
  };

  const handleLine = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let line: StreamLine;
    try {
      line = JSON.parse(trimmed) as StreamLine;
    } catch {
      return; // not JSON (shouldn't happen with --output-format stream-json), ignore
    }
    switch (line.type) {
      case "system":
        if (line.subtype === "init" && line.session_id) emit({ kind: "started", sessionId: line.session_id });
        break;
      case "assistant":
        handleAssistant(line);
        break;
      case "result":
        handleResult(line);
        break;
      default:
        // stream_event, active_goal, autocompact_state, rate_limit_event, user, etc — not needed here.
        break;
    }
  };

  return {
    handleLine,
    /**
     * Always closes any subagent tiles still open. Also emits an `error`
     * when the process exited without ever sending a "result" message and
     * the exit wasn't requested via stop() (suppressErrorEmit).
     */
    onProcessClose: (code: number | null, stderrTail: string, suppressErrorEmit = false) => {
      closeAllSubagents();
      if (!suppressErrorEmit) settle();
      if (!gotResult && !suppressErrorEmit) {
        const detail = stderrTail ? `: ${stderrTail}` : "";
        emit({ kind: "error", message: truncate(`claude exited with code ${code ?? "unknown"}${detail}`, 500) });
      }
    },
    get gotResult() {
      return gotResult;
    },
  };
}

/**
 * The flags every headless run for this agent needs. Shared by `start` and
 * `resume` so a resumed turn cannot quietly run with different permissions or
 * a different model than the run it is continuing.
 */
function headlessArgs(agent: Agent, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (agent.model) args.push("--model", agent.model);
  args.push("--permission-mode", agent.permissionMode);
  if (agent.allowedTools.length) args.push("--allowedTools", agent.allowedTools.join(","));
  if (agent.systemPrompt) args.push("--append-system-prompt", agent.systemPrompt);
  return args;
}

/** A session that never started: keeps the caller's bookkeeping uniform after a failed launch. */
function inertSession(): RunningSession {
  return { sessionId: "pending", respond: () => {}, stop: () => {}, isAlive: () => false };
}

/**
 * Spawns the real `claude` CLI headlessly for one ticket and turns its
 * NDJSON stream into RunnerEvents. See the file header for the exact shapes
 * this was written against.
 */
export class CliRunner implements SessionRunner {
  /** `command` is injectable so tests can exercise the spawn-failure path without a real binary. */
  constructor(private readonly command = "claude") {}

  start(agent: Agent, ticket: Ticket, emit: (e: RunnerEvent) => void): RunningSession {
    const prompt = ticket.description ? `${ticket.title}\n\n${ticket.description}` : ticket.title;
    return this.launch(agent, headlessArgs(agent, prompt), emit);
  }

  /**
   * Continue a conversation that stopped to ask the user something. The
   * original `claude -p` process is long gone by then, so answering means a
   * fresh run against the same session id rather than a write to its stdin.
   */
  resume(agent: Agent, sessionId: string, text: string, emit: (e: RunnerEvent) => void): RunningSession {
    return this.launch(agent, [...headlessArgs(agent, text), "--resume", sessionId], emit);
  }

  private launch(agent: Agent, args: string[], emit: (e: RunnerEvent) => void): RunningSession {
    const cwd = expandHome(agent.cwd);

    // spawn() reports a missing cwd as ENOENT naming the *binary*, which reads
    // as "claude is not installed" and hides the real cause. Check first.
    if (!existsSync(cwd)) {
      emit({ kind: "error", message: `working folder does not exist: ${cwd}` });
      return inertSession();
    }

    const proc = spawn(this.command, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"], env: agentEnv(agent.id) });

    const parser = createStreamParser(emit, { proposesOnly: agent.permissionMode === "plan", contextWindow: contextWindowFor(agent.model) });
    let stopped = false;
    let exited = false;
    let stderrTail = "";
    let stdoutBuf = "";

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const l of lines) parser.handleLine(l);
    });

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-500);
    });

    // Without this listener a spawn failure (binary missing, cwd vanished
    // between the check and the spawn, EACCES) is an unhandled "error" event,
    // which takes the whole server down instead of failing one ticket.
    let spawnFailed = false;
    proc.on("error", (err: NodeJS.ErrnoException) => {
      spawnFailed = true;
      const reason = err.code === "ENOENT" ? `\`${this.command}\` is not on PATH` : err.message;
      emit({ kind: "error", message: truncate(`could not start a session: ${reason}`, 500) });
    });

    proc.on("close", (code) => {
      exited = true;
      if (stdoutBuf) parser.handleLine(stdoutBuf); // flush a trailing line with no final newline
      parser.onProcessClose(code, stderrTail, stopped || spawnFailed);
    });

    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (proc.pid) process.kill(-proc.pid, signal);
        else proc.kill(signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          /* already dead */
        }
      }
    };

    return {
      sessionId: "pending", // real id arrives async via the "started" event once system/init is parsed
      isAlive: () => !exited,
      respond: (text: string) => {
        try {
          proc.stdin?.write(`${text}\n`);
        } catch {
          /* process may already be gone */
        }
      },
      stop: () => {
        stopped = true;
        killTree("SIGTERM");
        setTimeout(() => {
          // proc.killed only reflects proc.kill(); we signal the group, so it
          // stayed false and SIGKILL was sent even after a clean exit.
          if (!exited) killTree("SIGKILL");
        }, 2000);
      },
    };
  }
}

// exported for tests
export const __internal = { summarizeToolInput, truncate, clamp01 };
export type { StreamLine as CliStreamLine };
