import { describe, expect, it } from "vitest";
import { shouldSeed } from "./server.js";

/**
 * The demo office (fake agents in ~/code/shop-api with tickets already
 * assigned) must never meet the real CLI runner: it spawns `claude` in a
 * folder that doesn't exist and writes hook config into invented folders.
 */
describe("shouldSeed", () => {
  it("seeds the demo office under the mock runner", () => {
    expect(shouldSeed(true, "mock", undefined)).toBe(true);
  });

  it("starts empty under the real CLI runner", () => {
    expect(shouldSeed(true, "cli", undefined)).toBe(false);
  });

  it("still allows an explicit SEED=1 demo against the CLI runner", () => {
    expect(shouldSeed(true, "cli", "1")).toBe(true);
  });

  it("never buries a restored office under demo data", () => {
    expect(shouldSeed(true, "mock", undefined, 2)).toBe(false);
    expect(shouldSeed(true, "cli", "1", 2)).toBe(false);
  });

  it("never seeds when seeding was turned off", () => {
    expect(shouldSeed(false, "mock", "1")).toBe(false);
    expect(shouldSeed(false, "cli", "1")).toBe(false);
  });
});
