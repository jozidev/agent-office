import { describe, expect, it } from "vitest";
import {
  Agent,
  CLAUDE_MODELS,
  contextWindowFor,
  ClientMessage,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_RUNTIME,
  Runtime,
  PERMISSION_MODES,
  PermissionMode,
  ServerMessage,
  ROLE_PRESETS,
  RoleId,
  legacyPermissionMode,
} from "./index.js";

describe("schemas", () => {
  it("accepts a valid client message and rejects an unknown type", () => {
    expect(ClientMessage.safeParse({ type: "ticket.create", title: "x" }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "agent.hire", payload: { name: "", role: "coder", cwd: "/x" } }).success).toBe(false);
  });

  it("has a preset for every role id", () => {
    for (const r of RoleId.options) expect(ROLE_PRESETS[r].id).toBe(r);
  });

  it("server error message shape", () => {
    expect(ServerMessage.parse({ type: "error", message: "m" })).toEqual({ type: "error", message: "m" });
  });
});

describe("models", () => {
  it("offers the default model in the list the hire form renders", () => {
    expect(CLAUDE_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
  });

  it("gives every model an id, a label and a blurb", () => {
    for (const m of CLAUDE_MODELS) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids, so the picker cannot show the same model twice", () => {
    expect(new Set(CLAUDE_MODELS.map((m) => m.id)).size).toBe(CLAUDE_MODELS.length);
  });

  it("hires every role on the default model unless told otherwise", () => {
    for (const r of RoleId.options) expect(ROLE_PRESETS[r].model).toBe(DEFAULT_MODEL);
  });
});

describe("permission modes", () => {
  it("offers only modes the claude CLI actually accepts", () => {
    // `claude --permission-mode` documents exactly these; "default" is not one
    // of them, which is why it was replaced by "manual".
    expect([...PermissionMode.options].sort()).toEqual(
      ["acceptEdits", "auto", "bypassPermissions", "dontAsk", "manual", "plan"].sort(),
    );
  });

  it("lists every mode in the picker, with the default among them", () => {
    expect(PERMISSION_MODES.map((p) => p.id).sort()).toEqual([...PermissionMode.options].sort());
    expect(PermissionMode.options).toContain(DEFAULT_PERMISSION_MODE);
  });

  it("migrates agents stored under the old \"default\" mode", () => {
    expect(legacyPermissionMode("default")).toBe("manual");
    expect(legacyPermissionMode("plan")).toBe("plan");
    expect(legacyPermissionMode("nonsense")).toBe(DEFAULT_PERMISSION_MODE);
  });

  it("accepts an agent.update and rejects an unknown mode", () => {
    expect(ClientMessage.safeParse({ type: "agent.update", agentId: "a1", permissionMode: "auto" }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: "agent.update", agentId: "a1", model: "claude-opus-5" }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: "agent.update", agentId: "a1", permissionMode: "default" }).success).toBe(false);
  });
});

describe("runtime", () => {
  it("defaults to claude when a stored agent predates the field", () => {
    const parsed = Agent.parse({
      id: "a1",
      name: "Ada",
      role: "coder",
      color: "#fff",
      model: "claude-opus-5",
      cwd: "/tmp",
      uiMode: "terminal",
      desk: 0,
      createdAt: "2026-01-01",
    });
    expect(parsed.runtime).toBe(DEFAULT_RUNTIME);
  });

  it("rejects a runtime the office cannot drive", () => {
    expect(Runtime.safeParse("claude").success).toBe(true);
    expect(Runtime.safeParse("gpt").success).toBe(false);
  });
});

/**
 * The gauge was a flat 200k for every model, so an agent on a 1M model read
 * five times fuller than it was — a run barely started looked close to
 * needing a compaction.
 */
describe("context window", () => {
  it("gives each model its real window", () => {
    expect(contextWindowFor("claude-opus-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-sonnet-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-fable-5-1")).toBe(1_000_000);
    expect(contextWindowFor("claude-haiku-4-5")).toBe(200_000);
  });

  it("resolves the aliases the CLI accepts", () => {
    expect(contextWindowFor("opus")).toBe(contextWindowFor("claude-opus-5"));
    expect(contextWindowFor("haiku")).toBe(200_000);
  });

  it("assumes the current generation for anything it does not know", () => {
    // Guessing small is what produced the overstated gauge in the first place.
    expect(contextWindowFor("some-future-model")).toBe(1_000_000);
    expect(contextWindowFor(null)).toBe(1_000_000);
  });

  it("gives every listed model a window", () => {
    for (const m of CLAUDE_MODELS) expect(m.contextWindow).toBeGreaterThan(0);
  });
});
