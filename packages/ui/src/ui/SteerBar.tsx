import { CLAUDE_MODELS, PERMISSION_MODES, type PermissionMode } from "@agent-office/shared";

/**
 * What you do *to* a running agent, at the foot of the pane: what it runs as,
 * and the two things you can do to it right now.
 *
 * Replying is not here. A reply only ever answers a question, so its box lives
 * in the ask card with the question; a reply box that is present whether or
 * not anything asked you is a control that does nothing most of the time.
 *
 * Steering is always "next turn", never mid-run: model and permission mode are
 * flags baked in when a session spawns. The bar says so, because a control
 * that looks like it interrupts and does not is worse than no control.
 */
export function SteerBar({
  model,
  permissionMode,
  busy,
  canStop,
  showTakeOver,
  onModel,
  onPermissionMode,
  onStop,
  onTakeOver,
}: {
  model: string;
  permissionMode: PermissionMode;
  busy: boolean;
  canStop: boolean;
  /** False on the Terminal tab, where you are already looking at the terminal. */
  showTakeOver: boolean;
  onModel: (model: string) => void;
  onPermissionMode: (mode: PermissionMode) => void;
  onStop: () => void;
  onTakeOver: () => void;
}) {
  return (
    <div className="steer">
      <div className="steer-controls">
        <label>
          <span>model</span>
          <select value={model} onChange={(e) => onModel(e.target.value)} title="Applies to the next run">
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!CLAUDE_MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>
        <label>
          <span>permissions</span>
          <select
            value={permissionMode}
            onChange={(e) => onPermissionMode(e.target.value as PermissionMode)}
            title={PERMISSION_MODES.find((p) => p.id === permissionMode)?.blurb}
          >
            {PERMISSION_MODES.map((p) => (
              <option key={p.id} value={p.id} title={p.blurb}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {busy && <span className="steer-note">changes apply to the next run</span>}
        <div className="steer-right">
          {canStop && <button onClick={onStop}>Stop</button>}
          {showTakeOver && <button onClick={onTakeOver}>Take over</button>}
        </div>
      </div>
    </div>
  );
}
