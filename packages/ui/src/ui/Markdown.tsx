import { withFileLinks } from "./FilePath";
import { blocks, type Block } from "./markdownBlocks";

/**
 * Just enough markdown to make what an agent writes readable: headings,
 * bullets, numbered steps, fenced code and paragraphs. Anything else falls
 * through as plain text, which is the right failure mode for output we do not
 * control.
 *
 * Rendered as React elements, never as HTML — this text comes from a model,
 * and `dangerouslySetInnerHTML` on it would be an injection waiting to happen.
 */

/** Inline `code`, **bold**, and any absolute path, which becomes clickable. */
export function inline(text: string, keyPrefix: string, baseDir?: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(...withFileLinks(text.slice(last, m.index), `${keyPrefix}-${last}`, baseDir));
    if (m[1] !== undefined) out.push(<code key={`${keyPrefix}-${m.index}`}>{withFileLinks(m[1], `c${m.index}`, baseDir)}</code>);
    else out.push(<strong key={`${keyPrefix}-${m.index}`}>{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...withFileLinks(text.slice(last), `${keyPrefix}-${last}`, baseDir));
  return out;
}

export function Markdown({ text, baseDir }: { text: string; baseDir?: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        if (b.kind === "rule") return <hr key={i} />;
        if (b.kind === "table")
          return (
            <table key={i} className="md-table">
              {b.head.length > 0 && (
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j}>{inline(c, `th${i}-${j}`, baseDir)}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j}>{inline(c, `td${i}-${r}-${j}`, baseDir)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        if (b.kind === "code") return <pre key={i}>{b.text}</pre>;
        if (b.kind === "head") {
          const Tag = (b.level && b.level <= 2 ? "h4" : "h5") as "h4" | "h5";
          return <Tag key={i}>{inline(b.text, `h${i}`, baseDir)}</Tag>;
        }
        if (b.kind === "quote") return <blockquote key={i}>{inline(b.text, `q${i}`, baseDir)}</blockquote>;
        if (b.kind === "para") return <p key={i}>{inline(b.text, `p${i}`, baseDir)}</p>;
        return (
          <div key={i} className="md-item">
            <span className="md-marker">{b.kind === "bullet" ? "•" : "›"}</span>
            <span>{inline(b.text, `l${i}`, baseDir)}</span>
          </div>
        );
      })}
    </>
  );
}
