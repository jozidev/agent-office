/**
 * Splitting an agent's answer into blocks, kept free of React so it can be
 * tested directly.
 *
 * Deliberately small: headings, lists, quotes, fenced code, tables, rules and
 * paragraphs. Anything else falls through as a paragraph, which is the right
 * failure mode for output we do not control.
 */

export type Block =
  | { kind: "para" | "bullet" | "number" | "head" | "quote"; text: string; level?: number }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" };

const isTableRow = (line: string) => /^\|.*\|$/.test(line);

/** `|---|:--:|` and friends: the row that marks the one above it as a header. */
const isTableDivider = (line: string) => /^\|[\s:|-]+\|$/.test(line) && line.includes("-");

function cells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split("\n");
  let fence: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;

    if (/^\s*```/.test(raw)) {
      if (fence) {
        out.push({ kind: "code", text: fence.join("\n") });
        fence = null;
      } else fence = [];
      continue;
    }
    if (fence) {
      fence.push(raw);
      continue;
    }

    const line = raw.trim();
    if (!line) continue;

    // A table is the one block that spans lines, so it is consumed here rather
    // than line by line. Review output is mostly tables, and rendering their
    // pipes inline is unreadable.
    if (isTableRow(line)) {
      const rows: string[][] = [];
      let head: string[] | null = null;
      let j = i;
      for (; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (!isTableRow(t)) break;
        if (isTableDivider(t)) {
          head = rows.pop() ?? null;
          continue;
        }
        rows.push(cells(t));
      }
      // A single pipe-wrapped line is more likely prose than a table.
      if (head || rows.length > 1) {
        out.push({ kind: "table", head: head ?? [], rows });
        i = j - 1;
        continue;
      }
    }

    if (/^([-*_])\1{2,}$/.test(line)) {
      out.push({ kind: "rule" });
      continue;
    }
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const number = /^\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (head) out.push({ kind: "head", text: head[2]!, level: head[1]!.length });
    else if (bullet) out.push({ kind: "bullet", text: bullet[1]! });
    else if (number) out.push({ kind: "number", text: number[1]! });
    else if (quote) out.push({ kind: "quote", text: quote[1]! });
    else out.push({ kind: "para", text: line });
  }

  // An unterminated fence still has content worth showing.
  if (fence?.length) out.push({ kind: "code", text: fence.join("\n") });
  return out;
}
