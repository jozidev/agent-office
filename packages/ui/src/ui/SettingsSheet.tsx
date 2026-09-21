import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CLAUDE_MODELS, PERMISSION_MODES, type Agent, type PermissionMode } from "@agent-office/shared";

/**
 * Everything about how an agent is configured, in one place away from the
 * work. The header shows what it is set to; this is where you change it.
 *
 * Folder and runtime are read-only. Moving an agent's folder would mean
 * uninstalling hooks from the old one, installing into the new, and
 * invalidating any session bound to the old path; runtime has one value.
 * Showing them here is still worth it — it is the question "what is this
 * agent, exactly" and the answer belongs together.
 */
export function SettingsSheet({
  agent,
  onModel,
  onPermissionMode,
  onFire,
  onClose,
}: {
  agent: Agent;
  onModel: (model: string) => void;
  onPermissionMode: (mode: PermissionMode) => void;
  onFire: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-bg" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <h4>{agent.name} settings</h4>
          <button onClick={onClose}>×</button>
        </header>
        <div className="sheet-body">
          <label>
            <span>Model</span>
            <select value={agent.model} onChange={(e) => onModel(e.target.value)}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.blurb}
                </option>
              ))}
              {!CLAUDE_MODELS.some((m) => m.id === agent.model) && <option value={agent.model}>{agent.model}</option>}
            </select>
          </label>

          <label>
            <span>Permission mode</span>
            <select value={agent.permissionMode} onChange={(e) => onPermissionMode(e.target.value as PermissionMode)}>
              {PERMISSION_MODES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.blurb}
                </option>
              ))}
            </select>
          </label>
          <p className="sheet-note">Both apply to the agent&rsquo;s next run, not the one in flight.</p>

          <div className="sheet-fact">
            <span>Folder</span>
            <b title={agent.cwd}>{agent.cwd}</b>
          </div>
          <div className="sheet-fact">
            <span>Runtime</span>
            <b>{agent.runtime}</b>
          </div>
          <div className="sheet-fact">
            <span>Tools</span>
            <b>{agent.allowedTools.length ? agent.allowedTools.join(", ") : "none"}</b>
          </div>
        </div>
        <footer>
          <button className="danger" onClick={onFire}>
            Fire {agent.name}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
