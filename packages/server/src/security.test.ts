import { describe, expect, it } from "vitest";
import { allowedHostPorts, allowedOrigins, isAllowedHost, isAllowedOrigin } from "./security.js";

/**
 * Regression tests for the drive-by RCE: an unauthenticated `ws://127.0.0.1`
 * socket that any page in any tab could open, hire a Bash-allowlisted agent on
 * and assign a ticket to.
 */
describe("allowedOrigins", () => {
  it("allows every loopback spelling of our own port", () => {
    const allowed = allowedOrigins({ port: 4177 });
    expect(allowed).toContain("http://127.0.0.1:4177");
    expect(allowed).toContain("http://localhost:4177");
    expect(allowed).toContain("http://[::1]:4177");
  });

  it("allows the Vite dev origin only in dev, where it serves the UI", () => {
    expect(allowedOrigins({ port: 4177, dev: true })).toContain("http://localhost:5173");
    expect(allowedOrigins({ port: 4177, dev: false })).not.toContain("http://localhost:5173");
  });

  it("takes extra origins from the env escape hatch", () => {
    expect(allowedOrigins({ port: 4177, extra: "http://a.test, http://b.test" })).toEqual(
      expect.arrayContaining(["http://a.test", "http://b.test"]),
    );
  });
});

describe("isAllowedOrigin", () => {
  const allowed = allowedOrigins({ port: 4177 });

  it("refuses a foreign origin — the drive-by hijack", () => {
    expect(isAllowedOrigin("https://evil.example", allowed)).toBe(false);
  });

  it("refuses an origin that merely starts with ours", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4177.evil.example", allowed)).toBe(false);
  });

  it("refuses our host on somebody else's port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5999", allowed)).toBe(false);
  });

  it("accepts our own UI", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4177", allowed)).toBe(true);
  });

  it("lets a non-browser caller through — it has no Origin to judge", () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
  });
});

describe("isAllowedHost", () => {
  it("refuses a rebound name, which is what makes DNS rebinding work", () => {
    expect(isAllowedHost("evil.example:4177", 4177)).toBe(false);
    expect(isAllowedHost("attacker.test", 4177)).toBe(false);
  });

  it("fails closed when Host is missing, since HTTP/1.1 requires it", () => {
    expect(isAllowedHost(undefined, 4177)).toBe(false);
  });

  it("accepts loopback names on our port", () => {
    expect(isAllowedHost("127.0.0.1:4177", 4177)).toBe(true);
    expect(isAllowedHost("localhost:4177", 4177)).toBe(true);
    expect(isAllowedHost("[::1]:4177", 4177)).toBe(true);
  });

  it("refuses loopback on a different port", () => {
    expect(isAllowedHost("127.0.0.1:9999", 4177)).toBe(false);
  });
});

/**
 * Vite rewrites Host to the proxy target for an ordinary request but leaves it
 * alone on a WebSocket upgrade. So under `pnpm dev` /api arrived claiming the
 * server's port and worked, while /ws arrived claiming :5173 and was refused —
 * the office's socket reconnected forever with no visible reason.
 */
describe("the dev proxy's Host header", () => {
  it("accepts the Vite port only in dev", () => {
    expect(isAllowedHost("localhost:5173", allowedHostPorts({ port: 4177, dev: true }))).toBe(true);
    expect(isAllowedHost("localhost:5173", allowedHostPorts({ port: 4177, dev: false }))).toBe(false);
  });

  it("still accepts the server's own port in either mode", () => {
    for (const dev of [true, false]) {
      expect(isAllowedHost("127.0.0.1:4177", allowedHostPorts({ port: 4177, dev }))).toBe(true);
    }
  });

  it("still refuses a port we do not serve, dev or not", () => {
    expect(isAllowedHost("localhost:9999", allowedHostPorts({ port: 4177, dev: true }))).toBe(false);
  });

  /** The hostname check is what stops DNS rebinding; the dev port must not weaken it. */
  it("still refuses a non-loopback name on the dev port", () => {
    expect(isAllowedHost("evil.com:5173", allowedHostPorts({ port: 4177, dev: true }))).toBe(false);
  });

  it("takes a single port as well as a list", () => {
    expect(isAllowedHost("localhost:4177", 4177)).toBe(true);
    expect(isAllowedHost("localhost:5173", 4177)).toBe(false);
  });

  it("accepts any loopback port when none are known, as before", () => {
    expect(isAllowedHost("localhost:1234", allowedHostPorts({ dev: false }))).toBe(true);
  });

  it("offers both loopback spellings of the dev origin", () => {
    const origins = allowedOrigins({ port: 4177, dev: true });
    expect(origins).toContain("http://localhost:5173");
    expect(origins).toContain("http://127.0.0.1:5173");
  });
});
