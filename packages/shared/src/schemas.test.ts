import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS, ClientMessage, DEFAULT_MODEL, ServerMessage, ROLE_PRESETS, RoleId } from "./index.js";

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
