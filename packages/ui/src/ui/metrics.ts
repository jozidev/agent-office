/** Shared between the hover tooltip and the workspace header, so they agree. */
export function elapsed(iso: string | null): string {
  if (!iso) return "-";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}
