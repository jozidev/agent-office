import { useEffect, useState } from "react";

interface DirEntry {
  name: string;
  path: string;
}

interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

/**
 * Browse the machine's folders instead of typing a path blind. Server-side
 * listing rather than a native OS dialog: it behaves the same on macOS,
 * Windows and Linux, and still works when the office is open from another
 * machine.
 */
export function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (path?: string) => {
    fetch(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`)
      .then((r) => r.json())
      .then((l: DirListing) => (l.error ? setError(l.error) : (setListing(l), setError(null))))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    load(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal folder-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a working folder</h3>
        <div className="folder-path">{listing?.path ?? start}</div>
        {error && <div className="field-error">{error}</div>}
        <div className="folder-list">
          {listing?.parent && (
            <button className="folder-up" onClick={() => load(listing.parent!)}>
              ../
            </button>
          )}
          {listing?.entries.length === 0 && <div className="folder-empty">no subfolders</div>}
          {listing?.entries.map((e) => (
            <button key={e.path} onClick={() => load(e.path)}>
              {e.name}/
            </button>
          ))}
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
