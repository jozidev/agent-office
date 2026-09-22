import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
      // No convertEol: the pty already sends \r\n, and rewriting \n interferes
      // with the cursor-addressed drawing Claude Code's TUI relies on.
      fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 12,
      scrollback: 5000,
      cursorBlink: true,
      macOptionIsMeta: true, // so Option+arrow jumps words, as in iTerm
      theme: {
        background: "#0d0f14",
        foreground: "#e8eaf0",
        cursor: "#4aa3df",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // The DOM renderer repaints far too slowly for a TUI that redraws on every
    // keystroke. WebGL is the difference between "laggy" and "a terminal".
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      // A lost context (GPU pressure, sleep/wake) must fall back to the DOM
      // renderer rather than leave a blank panel.
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null; // no WebGL here; the DOM renderer still works
    }

    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }

    let socket: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sentCols = 0;
    let sentRows = 0;

    const sendResize = () => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (term.cols === sentCols && term.rows === sentRows) return;
      sentCols = term.cols;
      sentRows = term.rows;
      socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    const connect = () => {
      if (disposed) return;
      // Spawn the pty at the size we already measured, so Claude Code draws its
      // UI once instead of drawing at 100x30 and reflowing.
      socket = new WebSocket(wsUrl(`/ws/terminal/${agentId}?cols=${term.cols}&rows=${term.rows}`));
      sentCols = term.cols;
      sentRows = term.rows;
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

    // Coalesce to one fit per frame: dragging a window edge otherwise fires a
    // resize storm, and every pty resize makes Claude Code repaint everything.
    let frame = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Hidden (another tab is showing) measures 0x0, and fitting to that
        // would resize the pty to nothing and reflow the whole session.
        if (!container.clientWidth || !container.clientHeight) return;
        try {
          fit.fit();
        } catch {
          /* ignore transient layout thrash */
        }
        sendResize();
      });
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      socket?.close();
      webgl?.dispose();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
}

export function TerminalBody({ agentId, className }: { agentId: string; className?: string }) {
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

interface TerminalApp {
  id: string;
  label: string;
}

interface NativeInfo {
  supported: boolean;
  selected: TerminalApp | null;
  available: TerminalApp[];
  command: string;
}

/**
 * Which terminal app the "open in ..." button uses. Server-side detection, so
 * it reflects what is actually installed rather than assuming iTerm — and on a
 * machine with no GUI terminal at all it hands back the command to paste.
 */
function useNativeTerminal(agentId: string) {
  const [info, setInfo] = useState<NativeInfo | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/terminal/${agentId}/native`)
      .then((r) => r.json())
      .then((i: NativeInfo) => live && setInfo(i))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId]);

  const choose = useCallback(async (id: string) => {
    await fetch("/api/settings/terminalApp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setInfo((prev) => (prev ? { ...prev, selected: prev.available.find((a) => a.id === id) ?? prev.selected } : prev));
  }, []);

  return { info, choose };
}

export function TerminalPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  /**
   * Whether the user has asked for a terminal. Mounting one spawns a real
   * `claude` process on the server, so opening an agent to read its status
   * used to start a session — costing money, firing SessionStart hooks, and
   * knocking the agent out of whatever state you opened it to look at.
   * Watching an agent and taking it over are different intentions.
   */
  const [takenOver, setTakenOver] = useState(false);
  const [popped, setPopped] = useState(false);
  const [pos, setPos] = useState<FloatPos>(DEFAULT_FLOAT);
  const [handedOff, setHandedOff] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const { info, choose } = useNativeTerminal(agentId);

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

  // A real OS window rather than a div: movable to a second display, and no
  // longer boxed in by the panel it was launched from.
  //
  // The docked terminal is released first. That window attaches to the same
  // pty, and leaving both mounted put two writers on it — every keystroke
  // echoed twice and the two fought over the size. openNative already lets go
  // for the same reason; this path did not.
  const openWindow = () => {
    setTakenOver(false);
    setPopped(false);
    window.open(`/terminal/${agentId}`, `agent-office-terminal-${agentId}`, "popup=yes,width=900,height=620");
  };

  const openNative = async () => {
    setMenuOpen(false);
    const res = await fetch(`/api/terminal/${agentId}/native`, { method: "POST" });
    const body = (await res.json()) as { ok?: boolean; app?: TerminalApp; command?: string };
    // The server kills the in-app pty on handoff (Claude Code will not resume
    // one session twice), so stop rendering it or it just reconnects.
    if (body.ok) {
      setHandedOff(body.app?.label ?? "your terminal");
      setTakenOver(false);
    }
  };

  const copyCommand = () => {
    if (info?.command) void navigator.clipboard?.writeText(info.command);
  };

  const nativeControls = (
    <>
      {info?.supported ? (
          <span className="split">
            <button onClick={openNative}>open in {info.selected?.label ?? "terminal"}</button>
            <button className="caret" onClick={() => setMenuOpen((o) => !o)} title="choose terminal app">
              ⌄
            </button>
            {menuOpen && (
              <div className="term-menu">
                {info.available.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      void choose(a.id);
                      setMenuOpen(false);
                    }}
                  >
                    {a.id === info.selected?.id ? "✓ " : "  "}
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </span>
        ) : (
          info && <button onClick={copyCommand} title={info.command}>copy command</button>
        )}
    </>
  );

  const bar = (
    <div className="terminal-panel-bar">
      <span>terminal</span>
      <div className="terminal-actions">
        <button onClick={() => setPopped(true)}>float</button>
        <button onClick={openWindow}>window</button>
        {nativeControls}
      </div>
    </div>
  );

  if (handedOff) {
    return (
      <div className="terminal-panel">
        {bar}
        <div className="terminal-handoff">
          <p>
            handed off to <b>{handedOff}</b>.
          </p>
          <p>the session is running there now — this panel let go of it so the two don't fight over it.</p>
          <button
            onClick={() => {
              setHandedOff(null);
              setTakenOver(true);
            }}
          >
            reopen here
          </button>
        </div>
      </div>
    );
  }

  // Nothing is running until asked for. The native handoff stays available
  // here: it starts the session in your own terminal, not in ours.
  if (!takenOver) {
    return (
      <div className="terminal-panel">
        <div className="terminal-panel-bar">
          <span>terminal</span>
          <div className="terminal-actions">
            <button className="primary" onClick={() => setTakenOver(true)}>
              Take over
            </button>
            <button onClick={openWindow}>window</button>
            {nativeControls}
          </div>
        </div>
        <div className="terminal-idle">
          Not attached. Taking over starts a session in this agent&rsquo;s folder and puts you at its prompt.
        </div>
      </div>
    );
  }

  if (popped) {
    // Portalled to <body>: .panel is overflow:hidden and 380px wide, so a
    // floating window rendered inside it gets clipped at the panel edge.
    return createPortal(
      <div className="float-window" style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}>
        <div
          className="float-titlebar"
          onMouseDown={(e) => {
            dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
          }}
        >
          <span>{agentName} — terminal</span>
          <div className="terminal-actions">
            <button onClick={openWindow}>window</button>
            <button onClick={() => setPopped(false)}>dock</button>
          </div>
        </div>
        <TerminalBody agentId={agentId} className="xterm-host xterm-host--float" />
      </div>,
      document.body,
    );
  }

  return (
    <div className="terminal-panel">
      {bar}
      <TerminalBody agentId={agentId} className="xterm-host" />
    </div>
  );
}
