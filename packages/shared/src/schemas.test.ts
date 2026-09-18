import { describe, expect, it } from "vitest";
import { ClientMessage, ServerMessage, ROLE_PRESETS, RoleId } from "./index.js";

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
