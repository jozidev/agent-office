import { useState } from "react";
import type { Ticket, TicketStatus } from "@agent-office/shared";
import { useOffice, statusColor } from "../store";

/**
 * Three columns rather than one per ticket status. Assigned, in progress and
 * waiting are all "someone is on this"; splitting them made three sparse
 * columns that said less than one column with the agent's status on the card.
 */
const COLUMNS: { id: TicketStatus; label: string; holds: TicketStatus[] }[] = [
  { id: "backlog", label: "Backlog", holds: ["backlog"] },
  { id: "assigned", label: "Working", holds: ["assigned", "in_progress", "waiting"] },
  { id: "done", label: "Done", holds: ["done"] },
];

/** What the agent on this ticket is doing, in the ticket's language. */
function workLabel(ticket: TicketStatus, agentStatus?: string): string {
  if (agentStatus === "waiting" || ticket === "waiting") return "needs you";
  if (ticket === "assigned") return "assigned";
  return "in progress";
}

export function Board() {
  const open = useOffice((s) => s.boardOpen);
  const tickets = useOffice((s) => s.tickets);
  const agents = useOffice((s) => s.agents);
  const states = useOffice((s) => s.states);
  const send = useOffice((s) => s.send);
  const setDragging = useOffice((s) => s.setDragging);
  const setBoardOpen = useOffice((s) => s.setBoardOpen);
  const [title, setTitle] = useState("");
  const [over, setOver] = useState<TicketStatus | null>(null);

  if (!open) return null;

  const create = () => {
    if (!title.trim()) return;
    send({ type: "ticket.create", title: title.trim(), description: "" });
    setTitle("");
  };

  const inColumn = (holds: TicketStatus[]) =>
    Object.values(tickets)
      .filter((t) => holds.includes(t.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <section className="board">
      <header>
        <h3>Board</h3>
        <button onClick={() => setBoardOpen(false)}>×</button>
      </header>
      <div className="new">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New ticket title" onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="primary" onClick={create}>
          Add
        </button>
      </div>
      <div className="columns">
        {COLUMNS.map((c) => (
          <div
            key={c.id}
            className={`column ${over === c.id ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(c.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("ticket");
              // Dropping into Working without saying who is a no-op: an agent
              // is chosen by dropping on a desk, not by column.
              if (id && c.id !== "assigned") send({ type: "ticket.move", ticketId: id, status: c.id });
            }}
          >
            <h5>
              <span>{c.label}</span>
              <span>{inColumn(c.holds).length}</span>
            </h5>
            {inColumn(c.holds).map((t) => {
              const agent = t.assignedAgentId ? agents[t.assignedAgentId] : undefined;
              const agentStatus = t.assignedAgentId ? states[t.assignedAgentId]?.status : undefined;
              return (
                <Card
                  key={t.id}
                  ticket={t}
                  agentName={agent?.name}
                  agentColor={agent?.color}
                  work={c.id === "assigned" ? workLabel(t.status, agentStatus) : undefined}
                  workColor={agentStatus ? statusColor[agentStatus] : undefined}
                  onDragStart={() => setDragging(t.id)}
                  onDragEnd={() => setDragging(null)}
                  onDelete={() => send({ type: "ticket.delete", ticketId: t.id })}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="hint">Drag a ticket onto a desk in the office to assign it. Drag back to Backlog to unassign.</div>
    </section>
  );
}

function Card({
  ticket,
  agentName,
  agentColor,
  work,
  workColor,
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  ticket: Ticket;
  agentName?: string;
  agentColor?: string;
  work?: string;
  workColor?: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("ticket", ticket.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      title={ticket.description}
    >
      <span className="x" onClick={onDelete}>
        ×
      </span>
      <div className="t">{ticket.title}</div>
      <div className="who">
        {agentName ? (
          <>
            <i style={{ background: agentColor }} /> {agentName}
          </>
        ) : (
          "unassigned"
        )}
        {work && (
          <span className="work" style={{ color: workColor }}>
            {work}
          </span>
        )}
      </div>
    </div>
  );
}
