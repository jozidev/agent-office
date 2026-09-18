import { useEffect, useState } from "react";
import type { Agent } from "@agent-office/shared";
import { TerminalBody } from "./Terminal";

/**
 * The whole page for /terminal/:agentId, opened by the panel's "window" button
 * as a real OS window. No office scene, no store connection — just the terminal
 * filling the viewport, so it can be dragged to a second display and used as a
 * terminal rather than as a box inside a side panel.
 */
export function StandaloneTerminal({ agentId }: { agentId: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/snapshot")
      .then((r) => r.json())
      .then((snap: { agents: Agent[] }) => {
        if (!live) return;
        const agent = snap.agents.find((a) => a.id === agentId);
        setName(agent?.name ?? null);
        document.title = agent ? `${agent.name} — terminal` : "terminal";
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId]);

  return (
    <div className="standalone-terminal">
      <div className="standalone-bar">{name ? `${name} — terminal` : "terminal"}</div>
      <TerminalBody agentId={agentId} className="xterm-host xterm-host--fill" />
    </div>
  );
}
