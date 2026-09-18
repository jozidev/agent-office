import { useState } from "react";
import type { Ticket, TicketStatus } from "@agent-office/shared";
import { useOffice } from "../store";

const COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
];

export function Board() {
  const open = useOffice((s) => s.boardOpen);
  const tickets = useOffice((s) => s.tickets);
  const agents = useOffice((s) => s.agents);
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

  const byStatus = (s: TicketStatus) =>
    Object.values(tickets)
      .filter((t) => t.status === s)
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
              if (id) send({ type: "ticket.move", ticketId: id, status: c.id });
            }}
          >
            <h5>
              <span>{c.label}</span>
              <span>{byStatus(c.id).length}</span>
            </h5>
            {byStatus(c.id).map((t) => (
              <Card key={t.id} ticket={t} agentName={t.assignedAgentId ? agents[t.assignedAgentId]?.name : undefined} agentColor={t.assignedAgentId ? agents[t.assignedAgentId]?.color : undefined} onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)} onDelete={() => send({ type: "ticket.delete", ticketId: t.id })} />
            ))}
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
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  ticket: Ticket;
  agentName?: string;
  agentColor?: string;
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
      </div>
    </div>
  );
}
