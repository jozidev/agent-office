import { useOffice, statusColor } from "../store";

export function Hud() {
  const states = useOffice((s) => s.states);
  const connected = useOffice((s) => s.connected);
  const boardOpen = useOffice((s) => s.boardOpen);
  const setBoardOpen = useOffice((s) => s.setBoardOpen);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const list = Object.values(states);
  const busy = list.filter((s) => s.status === "thinking" || s.status === "tool_use").length;
  const idle = list.filter((s) => s.status === "idle").length;
  const waiting = list.filter((s) => s.status === "waiting").length;
  const errors = list.filter((s) => s.status === "error").length;

  return (
    <div className="hud">
      <span className="title">AGENT OFFICE</span>
      <span className="count">
        <i className="dot" style={{ background: statusColor.tool_use }} /> {busy} busy
      </span>
      <span className="count">
        <i className="dot" style={{ background: statusColor.idle }} /> {idle} idle
      </span>
      <span className="count">
        <i className="dot" style={{ background: statusColor.waiting }} /> {waiting} need you
      </span>
      {errors > 0 && (
        <span className="count">
          <i className="dot" style={{ background: statusColor.error }} /> {errors} error
        </span>
      )}
      <span className="spacer" />
      <span className="conn">{connected ? "● live" : "○ reconnecting"}</span>
      <button onClick={() => setBoardOpen(!boardOpen)}>{boardOpen ? "Close board" : "Board"}</button>
      <button className="primary" onClick={() => setHireOpen(true)}>
        + Hire
      </button>
    </div>
  );
}
