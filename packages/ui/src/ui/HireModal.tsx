import { useEffect, useState } from "react";
import { CLAUDE_MODELS, ROLE_PRESETS, type RoleId } from "@agent-office/shared";
import { useOffice } from "../store";
import { FolderPicker } from "./FolderPicker";

const NAMES = ["Ada", "Rex", "Mia", "Bo", "Kai", "Nia", "Otto", "Zed", "Lu", "Ivy", "Max", "Uma"];

export function HireModal() {
  const open = useOffice((s) => s.hireOpen);
  if (!open) return null;
  return <HireForm />;
}

/** Mounted fresh each time the modal opens, so defaults reflect current agents. */
function HireForm() {
  const setOpen = useOffice((s) => s.setHireOpen);
  const send = useOffice((s) => s.send);
  const agents = useOffice((s) => s.agents);
  const taken = new Set(Object.values(agents).map((a) => a.name));
  const [name, setName] = useState(() => NAMES.find((n) => !taken.has(n)) ?? `Agent ${taken.size + 1}`);
  const [role, setRole] = useState<RoleId>("coder");
  const [model, setModel] = useState(ROLE_PRESETS.coder.model);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [cwdError, setCwdError] = useState<string | null>(null);
  const preset = ROLE_PRESETS[role];

  // Start where you last hired from; a fresh install falls back to the home
  // folder. The old `~/code/project` placeholder pointed at nothing.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: { lastHireDir: string | null }) => s.lastHireDir && setCwd(s.lastHireDir))
      .catch(() => {});
  }, []);

  /** Hiring into a folder that doesn't exist used to fail silently (issue #1). */
  const checkCwd = async (path: string): Promise<boolean> => {
    if (!path.trim()) {
      setCwdError("pick a working folder");
      return false;
    }
    try {
      const res = await fetch(`/api/fs/stat?path=${encodeURIComponent(path)}`);
      const { exists, isDir } = (await res.json()) as { exists: boolean; isDir: boolean };
      if (!exists) setCwdError("that folder doesn't exist");
      else if (!isDir) setCwdError("that's a file, not a folder");
      else setCwdError(null);
      return exists && isDir;
    } catch {
      setCwdError("could not check that path");
      return false;
    }
  };

  const hire = async () => {
    if (!(await checkCwd(cwd))) return;
    send({ type: "agent.hire", payload: { name, role, cwd, model, ...(prompt && { systemPrompt: prompt }) } });
    setOpen(false);
  };

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Hire an agent</h3>
        <label>Role</label>
        <div className="roles">
          {(Object.keys(ROLE_PRESETS) as RoleId[]).map((r) => (
            <button
              key={r}
              className={r === role ? "sel" : ""}
              onClick={() => {
                setRole(r);
                setModel(ROLE_PRESETS[r].model);
              }}
            >
              {ROLE_PRESETS[r].label}
              <small>{ROLE_PRESETS[r].blurb}</small>
            </button>
          ))}
        </div>
        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.blurb}
            </option>
          ))}
        </select>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label>Working folder</label>
        <div className="folder-field">
          <input
            value={cwd}
            placeholder="~/code/your-project"
            onChange={(e) => {
              setCwd(e.target.value);
              setCwdError(null);
            }}
            onBlur={(e) => void checkCwd(e.target.value)}
          />
          <button onClick={() => setBrowsing(true)}>Browse…</button>
        </div>
        {cwdError && <div className="field-error">{cwdError}</div>}
        <label>Extra instructions (optional)</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={preset.systemPrompt || "..."} />
        <div className="actions">
          <button onClick={() => setOpen(false)}>Cancel</button>
          <button className="primary" disabled={Boolean(cwdError)} onClick={() => void hire()}>
            Hire
          </button>
        </div>
      </div>
      {browsing && (
        <FolderPicker
          start={cwd}
          onClose={() => setBrowsing(false)}
          onPick={(path) => {
            setCwd(path);
            setCwdError(null);
            setBrowsing(false);
          }}
        />
      )}
    </div>
  );
}
