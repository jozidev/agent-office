/**
 * A working folder is usually a long absolute path whose first half is the
 * same for every agent. The last two segments are what tells them apart; the
 * whole thing is a hover away.
 */
export function shortFolder(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}

export function FolderPath({ path }: { path: string }) {
  return (
    <span className="folder-path" title={path}>
      {shortFolder(path)}
    </span>
  );
}
