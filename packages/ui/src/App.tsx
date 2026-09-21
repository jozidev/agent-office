import { useOffice } from "./store";
import { OfficeScene } from "./scene/OfficeScene";
import { deskScreenPositions } from "./scene/Seat";
import { Hud } from "./ui/Hud";
import { Tooltip } from "./ui/Tooltip";
import { AgentPanel } from "./ui/AgentPanel";
import { HireModal } from "./ui/HireModal";
import { Board } from "./ui/Board";
import { SetupPage } from "./ui/SetupPage";
import { useEffect } from "react";

const DROP_RADIUS = 90;

function nearestDesk(x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = DROP_RADIUS;
  for (const [id, p] of deskScreenPositions) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function App() {
  const send = useOffice((s) => s.send);
  const setDragging = useOffice((s) => s.setDragging);
  const setHovered = useOffice((s) => s.setHovered);
  const dragging = useOffice((s) => s.draggingTicketId);
  const toasts = useOffice((s) => s.toasts);
  const setSetupOpen = useOffice((s) => s.setSetupOpen);
  const setSelected = useOffice((s) => s.setSelected);
  const setBoardOpen = useOffice((s) => s.setBoardOpen);
  const hireOpen = useOffice((s) => s.hireOpen);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const setupOpen = useOffice((s) => s.setupOpen);
  const selected = useOffice((s) => s.selectedAgentId);
  const boardOpen = useOffice((s) => s.boardOpen);

  // First run: open the setup page automatically when something fails.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((rep: { overall: string }) => {
        if (rep.overall === "fail" && !sessionStorage.getItem("setup-dismissed")) setSetupOpen(true);
      })
      .catch(() => {});
  }, [setSetupOpen]);

  // Escape closes the innermost thing that is open. Sheets and previews handle
  // their own, and stop the event, so by the time it reaches here they are shut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (setupOpen) setSetupOpen(false);
      else if (hireOpen) setHireOpen(false);
      else if (selected) setSelected(null);
      else if (boardOpen) setBoardOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setupOpen, hireOpen, selected, boardOpen, setSetupOpen, setHireOpen, setSelected, setBoardOpen]);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        setHovered(nearestDesk(e.clientX, e.clientY));
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("ticket");
        const agentId = nearestDesk(e.clientX, e.clientY);
        setDragging(null);
        setHovered(null);
        if (id && agentId) {
          e.preventDefault();
          send({ type: "ticket.assign", ticketId: id, agentId });
        }
      }}
    >
      {/* The canvas is given the remaining width so the room refits, rather
          than a pane sliding over a room drawn for the full screen. */}
      <div className={`canvas-host${selected ? " canvas--with-pane" : boardOpen ? " canvas--with-board" : ""}`}>
        <OfficeScene />
      </div>
      <Hud />
      <Tooltip />
      <Board />
      <AgentPanel />
      <HireModal />
      <SetupPage />
      {dragging && <div className="drop-hint">drop on a desk to assign</div>}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
