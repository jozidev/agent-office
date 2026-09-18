import { describe, expect, it } from "vitest";
import { parseStreamJsonLine } from "./chat.js";

describe("parseStreamJsonLine", () => {
  it("ignores blank lines and invalid json", () => {
    expect(parseStreamJsonLine("")).toEqual([]);
    expect(parseStreamJsonLine("   ")).toEqual([]);
    expect(parseStreamJsonLine("not json")).toEqual([]);
  });

  it("extracts the session id from the init system message", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", cwd: "/tmp", session_id: "abc123", tools: [] });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "session", sessionId: "abc123" }]);
  });

  it("ignores other system subtypes", () => {
    const line = JSON.stringify({ type: "system", subtype: "status", status: "requesting" });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  it("extracts assistant text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "pong" }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "text", text: "pong" }]);
  });

  it("drops empty text blocks", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "" }] } });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  it("extracts tool_use blocks as summarized tool events", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "tool", name: "Bash", summary: '{"command":"pnpm test"}' }]);
  });

  it("handles an assistant message with both text and a tool call", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool", name: "Read", summary: '{"file_path":"a.ts"}' },
    ]);
  });

  it("truncates very long tool summaries", () => {
    const bigValue = "x".repeat(200);
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { content: bigValue } }] } });
    const [event] = parseStreamJsonLine(line);
    expect(event?.type).toBe("tool");
    if (event?.type === "tool") {
      expect(event.summary.length).toBe(90);
      expect(event.summary.endsWith("...")).toBe(true);
    }
  });

  it("extracts cost and a fresh session id from the result message", () => {
    const line = JSON.stringify({ type: "result", session_id: "s2", total_cost_usd: 0.0370254, stop_reason: "end_turn" });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: "result", costUsd: 0.0370254 },
      { type: "session", sessionId: "s2" },
    ]);
  });

  it("defaults result cost to 0 when missing", () => {
    const line = JSON.stringify({ type: "result" });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "result", costUsd: 0 }]);
  });

  it("ignores stream_event deltas (full assistant messages are used instead)", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "po" } } });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  it("ignores unknown top-level types", () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }))).toEqual([]);
  });
});
