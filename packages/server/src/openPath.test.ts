import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { isPreviewable, openArgs, registerOpenPathRoutes } from "./openPath.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-office-open-"));
  writeFileSync(join(dir, "plan.md"), "# Plan\n\n- step one\n- step two\n");
  writeFileSync(join(dir, "binary.png"), "not really a png");
  mkdirSync(join(dir, "sub"));
});

/** The roots are injected so the test does not depend on where tmp lives. */
function serve(launched: [string, string[]][] = []) {
  const app = Fastify({ logger: false });
  registerOpenPathRoutes(app, { roots: [dir], platform: "darwin", launch: (c, a) => launched.push([c, a]) });
  return app;
}

describe("openArgs", () => {
  it("opens and reveals on macOS", () => {
    expect(openArgs("/x/y.md", "open", "darwin")).toEqual(["open", ["/x/y.md"]]);
    expect(openArgs("/x/y.md", "reveal", "darwin")).toEqual(["open", ["-R", "/x/y.md"]]);
  });

  it("selects the file in Explorer on Windows", () => {
    expect(openArgs("C:\\x\\y.md", "reveal", "win32")).toEqual(["explorer.exe", ["/select,C:\\x\\y.md"]]);
  });

  /**
   * `cmd.exe /c` re-parses its command line and expands &, |, ^, <, > and
   * %VAR% back out of arguments Node already quoted. Those are all legal in
   * Windows filenames and agents create files, so routing a path through cmd
   * turns "click the file your agent wrote" into command execution.
   */
  it("never hands a Windows path to a shell", () => {
    for (const mode of ["open", "reveal"] as const) {
      const [cmd, args] = openArgs("C:\\x\\notes&calc.exe.md", mode, "win32")!;
      expect(cmd).toBe("explorer.exe");
      expect(args).toHaveLength(1);
      expect(args.join(" ")).toContain("notes&calc.exe.md"); // passed through intact, not interpreted
    }
  });

  it("does not use a shell on any platform", () => {
    const shells = ["cmd.exe", "cmd", "sh", "bash", "zsh", "powershell.exe"];
    for (const platform of ["darwin", "win32", "linux"] as const) {
      for (const mode of ["open", "reveal"] as const) {
        expect(shells).not.toContain(openArgs("/x/y.md", mode, platform)![0]);
      }
    }
  });

  it("falls back to opening the folder on linux, which has no portable reveal", () => {
    expect(openArgs("/x/y.md", "reveal", "linux")).toEqual(["xdg-open", ["/x"]]);
  });

  it("says so rather than guessing on a platform it does not know", () => {
    expect(openArgs("/x/y.md", "open", "aix")).toBeNull();
  });
});

describe("isPreviewable", () => {
  it("covers what an agent actually writes, and nothing else", () => {
    for (const p of ["/x/plan.md", "/x/notes.TXT", "/x/data.json", "/x/c.yaml"]) expect(isPreviewable(p)).toBe(true);
    for (const p of ["/x/a.png", "/x/a.exe", "/x/noext"]) expect(isPreviewable(p)).toBe(false);
  });
});

describe("POST /api/open", () => {
  it("hands the path to the OS", async () => {
    const launched: [string, string[]][] = [];
    const res = await serve(launched).inject({ method: "POST", url: "/api/open", payload: { path: join(dir, "plan.md") } });
    expect(res.statusCode).toBe(200);
    expect(launched[0]![0]).toBe("open");
  });

  it("refuses a path outside the roots — this opens whatever the desktop handles", async () => {
    const launched: [string, string[]][] = [];
    const res = await serve(launched).inject({ method: "POST", url: "/api/open", payload: { path: "/etc/passwd" } });
    expect(res.statusCode).toBe(403);
    expect(launched).toEqual([]);
  });

  it("refuses a traversal that climbs out of a root", async () => {
    const res = await serve().inject({ method: "POST", url: "/api/open", payload: { path: join(dir, "..", "..", "etc") } });
    expect(res.statusCode).toBe(403);
  });

  it("reports a file that has since been deleted", async () => {
    const res = await serve().inject({ method: "POST", url: "/api/open", payload: { path: join(dir, "gone.md") } });
    expect(res.statusCode).toBe(404);
  });

  it("needs a path", async () => {
    expect((await serve().inject({ method: "POST", url: "/api/open", payload: {} })).statusCode).toBe(400);
  });
});

describe("GET /api/file", () => {
  const get = (path: string) => serve().inject({ url: `/api/file?path=${encodeURIComponent(path)}` });

  it("returns the text so it can be read in the app", async () => {
    const res = await get(join(dir, "plan.md"));
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("step one");
    expect(res.json().truncated).toBe(false);
  });

  it("refuses a path outside the roots", async () => {
    expect((await get("/etc/passwd")).statusCode).toBe(403);
  });

  it("refuses a type it should not be streaming", async () => {
    expect((await get(join(dir, "binary.png"))).statusCode).toBe(415);
  });

  it("refuses a folder", async () => {
    expect((await get(join(dir, "sub"))).statusCode).toBe(415);
  });

  it("reports a missing file", async () => {
    expect((await get(join(dir, "gone.md"))).statusCode).toBe(404);
  });
});
