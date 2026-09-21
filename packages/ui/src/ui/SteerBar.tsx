import { forwardRef, useState } from "react";
import { CLAUDE_MODELS, PERMISSION_MODES, type PermissionMode } from "@agent-office/shared";

/**
 * Everything you do *to* a running agent, in one place at the foot of the pane.
 *
 * Steering is always "next turn", never mid-run: a model or permission change
 * is a flag baked in when a session spawns, and a reply is delivered when the
 * agent next asks or is resumed. The labels say so, because a control that
 * looks like it interrupts and doesn't is worse than no control.
 */
export const SteerBar = forwardRef<
  HTMLTextAreaElement,
  {
    model: string;
    permissionMode: PermissionMode;
    busy: boolean;
    canStop: boolean;
    onSend: (text: string) => void;
    onModel: (model: string) => void;
    onPermissionMode: (mode: PermissionMode) => void;
    onStop: () => void;
    onTakeOver: () => void;
  }
>(function SteerBar({ model, permissionMode, busy, canStop, onSend, onModel, onPermissionMode, onStop, onTakeOver }, ref) {
  const [reply, setReply] = useState("");

  const send = () => {
    const t = reply.trim();
    if (!t) return;
    onSend(t);
    setReply("");
  };

  return (
    <div className="steer">
      <textarea
        ref={ref}
        value={reply}
        placeholder={busy ? "reply — delivered on its next turn (Enter to send)" : "reply — Enter to send, Shift+Enter for a new line"}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
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
          <button onClick={onTakeOver}>Take over</button>
          <button className="primary" disabled={!reply.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
});
