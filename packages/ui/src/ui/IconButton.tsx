/**
 * One icon button for every close and every gear, so they are the same size
 * and the same target wherever they appear. Text glyphs (× and ⚙) render thin
 * and inconsistently across platforms at this size.
 */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon" title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
