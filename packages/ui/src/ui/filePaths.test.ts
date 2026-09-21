import { describe, expect, it } from "vitest";
import { resolvePath, stripTrailingPunctuation } from "./filePaths.js";

/** Stand-in for an agent's working folder; nothing here depends on a real one. */
const CWD = "/repo";

describe("resolvePath", () => {
  it("takes absolute paths as they are", () => {
    expect(resolvePath("/repo/notes.md")).toBe("/repo/notes.md");
    expect(resolvePath("~/notes.md")).toBe("~/notes.md");
  });

  /**
   * The bug this replaced: scanning for "/" mid-string linked
   * `docs/architecture.md` as `/architecture.md`, which is either nothing or,
   * worse, a real and unrelated file.
   */
  it("resolves a relative path against the agent's folder, not the filesystem root", () => {
    expect(resolvePath("docs/architecture.md", CWD)).toBe(`${CWD}/docs/architecture.md`);
    expect(resolvePath("packages/ui/public/models/LICENSE.md", CWD)).toBe(`${CWD}/packages/ui/public/models/LICENSE.md`);
    expect(resolvePath("./hello.md", CWD)).toBe(`${CWD}/hello.md`);
  });

  it("leaves prose alone", () => {
    for (const token of ["and/or", "read/write", "km/h", "24/7"]) {
      expect(resolvePath(token, CWD)).toBeNull();
    }
  });

  it("ignores URLs", () => {
    expect(resolvePath("https://example.com/a.md", CWD)).toBeNull();
  });

  it("needs a separator — a bare filename is usually a mention, not a location", () => {
    expect(resolvePath("README.md", CWD)).toBeNull();
  });

  it("will not resolve a relative path with nothing to resolve against", () => {
    expect(resolvePath("docs/architecture.md")).toBeNull();
  });

  it("does not guess at ..", () => {
    expect(resolvePath("../other/notes.md", CWD)).toBeNull();
  });

  it("copes with a working folder that has a trailing slash", () => {
    expect(resolvePath("docs/a.md", `${CWD}/`)).toBe(`${CWD}/docs/a.md`);
  });

  it("rejects a lone separator", () => {
    expect(resolvePath("/", CWD)).toBeNull();
    expect(resolvePath("", CWD)).toBeNull();
  });
});

describe("stripTrailingPunctuation", () => {
  it("keeps the filename but drops the sentence", () => {
    expect(stripTrailingPunctuation("/x/notes.md.")).toBe("/x/notes.md");
    expect(stripTrailingPunctuation("/x/notes.md,")).toBe("/x/notes.md");
    expect(stripTrailingPunctuation("/x/notes.md?")).toBe("/x/notes.md");
    expect(stripTrailingPunctuation("/x/notes.md")).toBe("/x/notes.md");
  });
});
