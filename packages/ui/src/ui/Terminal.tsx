import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const RECONNECT_MS = 1500;

/** Same-host, protocol-matching ws:// or wss:// URL for a server route. */
function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

/**
 * One xterm.js instance wired to /ws/terminal/:agentId. Mounted once per
 * agent panel open; unmounting tears the socket down (the pty on the server
 * stays alive so history replays on the next mount).
 */
function useTerminalSession(containerRef: React.RefObject<HTMLDivElement | null>, agentId: string) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      convertEol: true,
      fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#0d0f14",
        foreground: "#e8eaf0",
        cursor: "#4aa3df",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }

    let socket: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const sendResize = () => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(wsUrl(`/ws/terminal/${agentId}`));
      socket.onopen = sendResize;
      socket.onmessage = (ev) => term.write(typeof ev.data === "string" ? ev.data : "");
      socket.onclose = () => {
        if (disposed) return;
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    const dataDisposable = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore transient layout thrash */
      }
      sendResize();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      socket?.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
}

function TerminalBody({ agentId, className }: { agentId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useTerminalSession(ref, agentId);
  return <div ref={ref} className={className ?? "xterm-host"} />;
}

/** Floating window position, kept while docked so it reopens where you left it. */
interface FloatPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_FLOAT: FloatPos = { x: 120, y: 90, w: 640, h: 420 };

export function TerminalPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [popped, setPopped] = useState(false);
  const [pos, setPos] = useState<FloatPos>(DEFAULT_FLOAT);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useLayoutEffect(() => {
    if (!popped) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos((p) => ({ ...p, x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [popped]);

  if (popped) {
    return (
      <div
        className="float-window"
        style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
      >
        <div
          className="float-titlebar"
          onMouseDown={(e) => {
            dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
          }}
        >
          <span>{agentName} — terminal</span>
          <button onClick={() => setPopped(false)}>dock</button>
        </div>
        <TerminalBody agentId={agentId} className="xterm-host xterm-host--float" />
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-bar">
        <span>terminal</span>
        <button onClick={() => setPopped(true)}>pop out</button>
      </div>
      <TerminalBody agentId={agentId} className="xterm-host" />
    </div>
  );
}
