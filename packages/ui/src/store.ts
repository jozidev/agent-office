import { create } from "zustand";
import type { Agent, AgentState, ClientMessage, ServerMessage, Ticket } from "@agent-office/shared";

interface Toast {
  id: number;
  text: string;
}

interface OfficeStore {
  connected: boolean;
  agents: Record<string, Agent>;
  states: Record<string, AgentState>;
  tickets: Record<string, Ticket>;
  hoveredAgentId: string | null;
  selectedAgentId: string | null;
  boardOpen: boolean;
  hireOpen: boolean;
  /** ticket currently being dragged from the board (so desks can accept it) */
  draggingTicketId: string | null;
  toasts: Toast[];

  apply(m: ServerMessage): void;
  send(m: ClientMessage): void;
  setHovered(id: string | null): void;
  setSelected(id: string | null): void;
  setBoardOpen(v: boolean): void;
  setHireOpen(v: boolean): void;
  setDragging(id: string | null): void;
  toast(text: string): void;
}

let socket: WebSocket | null = null;
let toastSeq = 0;

export const useOffice = create<OfficeStore>((set, get) => ({
  connected: false,
  agents: {},
  states: {},
  tickets: {},
  hoveredAgentId: null,
  selectedAgentId: null,
  boardOpen: false,
  hireOpen: false,
  draggingTicketId: null,
  toasts: [],

  apply(m) {
    switch (m.type) {
      case "snapshot":
        set({
          agents: Object.fromEntries(m.payload.agents.map((a) => [a.id, a])),
          states: Object.fromEntries(m.payload.states.map((s) => [s.agentId, s])),
          tickets: Object.fromEntries(m.payload.tickets.map((t) => [t.id, t])),
        });
        break;
      case "agent.upsert":
        set((s) => ({ agents: { ...s.agents, [m.agent.id]: m.agent } }));
        break;
      case "agent.removed":
        set((s) => {
          const agents = { ...s.agents };
          const states = { ...s.states };
          delete agents[m.agentId];
          delete states[m.agentId];
          return { agents, states, selectedAgentId: s.selectedAgentId === m.agentId ? null : s.selectedAgentId };
        });
        break;
      case "state.update":
        set((s) => ({ states: { ...s.states, [m.state.agentId]: m.state } }));
        break;
      case "ticket.upsert":
        set((s) => ({ tickets: { ...s.tickets, [m.ticket.id]: m.ticket } }));
        break;
      case "ticket.removed":
        set((s) => {
          const tickets = { ...s.tickets };
          delete tickets[m.ticketId];
          return { tickets };
        });
        break;
      case "error":
        get().toast(m.message);
        break;
    }
  },

  send(m) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    else get().toast("not connected");
  },

  setHovered: (hoveredAgentId) => set({ hoveredAgentId }),
  setSelected: (selectedAgentId) => set({ selectedAgentId }),
  setBoardOpen: (boardOpen) => set({ boardOpen }),
  setHireOpen: (hireOpen) => set({ hireOpen }),
  setDragging: (draggingTicketId) => set({ draggingTicketId }),
  toast(text) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
  },
}));

export function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  const open = () => {
    socket = new WebSocket(url);
    socket.onopen = () => useOffice.setState({ connected: true });
    socket.onmessage = (ev) => useOffice.getState().apply(JSON.parse(ev.data));
    socket.onclose = () => {
      useOffice.setState({ connected: false });
      setTimeout(open, 1500);
    };
  };
  open();
}

/** Derived helpers */
export const statusLabel: Record<AgentState["status"], string> = {
  idle: "idle",
  thinking: "thinking",
  tool_use: "working",
  waiting: "needs you",
  done: "done",
  error: "error",
};

export const statusColor: Record<AgentState["status"], string> = {
  idle: "#9aa3ad",
  thinking: "#7bd88f",
  tool_use: "#7bd88f",
  waiting: "#f2c14e",
  done: "#5ec8c0",
  error: "#e05a5a",
};
