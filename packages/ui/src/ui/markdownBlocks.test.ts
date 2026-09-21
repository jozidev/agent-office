import { describe, expect, it } from "vitest";
import { blocks } from "./markdownBlocks.js";

describe("blocks", () => {
  it("keeps paragraphs apart", () => {
    expect(blocks("one\n\ntwo").map((b) => b.kind)).toEqual(["para", "para"]);
  });

  it("reads headings, lists and quotes", () => {
    const kinds = blocks("## Head\n- a\n1. b\n> c").map((b) => b.kind);
    expect(kinds).toEqual(["head", "bullet", "number", "quote"]);
  });

  /** Review output is mostly tables; rendering their pipes inline is unreadable. */
  it("reads a table with a header", () => {
    const [b] = blocks("| # | Severity | Issue |\n|---|---|---|\n| 1 | High | Broken |\n| 2 | Low | Nit |");
    expect(b).toEqual({
      kind: "table",
      head: ["#", "Severity", "Issue"],
      rows: [
        ["1", "High", "Broken"],
        ["2", "Low", "Nit"],
      ],
    });
  });

  it("reads a table with no header row", () => {
    const [b] = blocks("| a | b |\n| c | d |");
    expect(b).toMatchObject({ kind: "table", head: [], rows: [["a", "b"], ["c", "d"]] });
  });

  it("accepts an aligned divider", () => {
    const [b] = blocks("| a | b |\n|:--|--:|\n| c | d |");
    expect(b).toMatchObject({ kind: "table", head: ["a", "b"] });
  });

  it("leaves a lone pipe-wrapped line as prose", () => {
    expect(blocks("| not really a table |")[0]?.kind).toBe("para");
  });

  it("returns to ordinary blocks after a table", () => {
    const kinds = blocks("| a |\n|---|\n| b |\n\nAfter the table.").map((k) => k.kind);
    expect(kinds).toEqual(["table", "para"]);
  });

  it("keeps fenced code whole, pipes and all", () => {
    const [b] = blocks("```\n| this | is | code |\nconst x = 1;\n```");
    expect(b).toEqual({ kind: "code", text: "| this | is | code |\nconst x = 1;" });
  });

  it("still shows an unterminated fence", () => {
    expect(blocks("```\nconst x = 1;")[0]).toMatchObject({ kind: "code" });
  });

  it("reads a horizontal rule", () => {
    expect(blocks("---")[0]?.kind).toBe("rule");
  });
});
