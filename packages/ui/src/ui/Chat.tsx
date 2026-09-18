import { useEffect, useRef, useState } from "react";

type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "result"; costUsd: number }
  | { type: "error"; message: string }
  | { type: "closed" };

interface ChatLine {
  id: number;
  kind: "you" | "assistant" | "tool" | "error";
  text: string;
}

function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

const RECONNECT_MS = 1500;

export function ChatPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingId = useRef<number | null>(null);

  const append = (kind: ChatLine["kind"], text: string) => {
    const id = ++seq.current;
    setLines((ls) => [...ls, { id, kind, text }]);
    return id;
  };

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(wsUrl(`/ws/chat/${agentId}`));
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (ev) => {
        let e: ChatEvent;
        try {
          e = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (e.type) {
          case "text":
            if (streamingId.current === null) {
              streamingId.current = append("assistant", e.text);
            } else {
              const id = streamingId.current;
              setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text: l.text + e.text } : l)));
            }
            break;
          case "tool":
            append("tool", `${e.name} ${e.summary}`);
            break;
          case "result":
            streamingId.current = null;
            break;
          case "error":
            streamingId.current = null;
            append("error", e.message);
            setBusy(false);
            break;
          case "closed":
            streamingId.current = null;
            setBusy(false);
            break;
          case "session":
            break;
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (disposed) return;
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket.close();
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    append("you", text);
    socket.send(JSON.stringify({ type: "message", text }));
    setDraft("");
    setBusy(true);
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-bar">
        <span>chat with {agentName}</span>
        <span className={connected ? "chat-dot ok" : "chat-dot"} title={connected ? "connected" : "reconnecting"} />
      </div>
      <div className="chat-log" ref={scrollRef}>
        {lines.length === 0 && <div className="chat-empty">say something to get started</div>}
        {lines.map((l) => (
          <div key={l.id} className={`chat-line chat-${l.kind}`}>
            {l.kind === "you" && <b>you: </b>}
            {l.text}
          </div>
        ))}
        {busy && <div className="chat-line chat-tool">thinking…</div>}
      </div>
      <div className="chat-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="message…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="primary" onClick={send} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
