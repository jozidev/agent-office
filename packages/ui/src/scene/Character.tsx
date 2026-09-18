import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import { ROLE_PRESETS, type Agent, type AgentState } from "@agent-office/shared";
import { statusColor } from "../store";
import { CallBubble } from "./CallBubble";

interface Props {
  agent: Agent;
  state: AgentState;
  hovered: boolean;
}

/**
 * Low-poly office worker. Animation is driven purely by state.status:
 * idle: slow sway (+ zzz after a while), thinking/tool_use: typing bob,
 * waiting: bounce with a "?" bubble, done: little hop + check, error: slump + "!".
 */
export function Character({ agent, state, hovered }: Props) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const idleSince = useRef<number | null>(null);
  const look = ROLE_PRESETS[agent.role].look;
  const busy = state.status === "thinking" || state.status === "tool_use";

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const g = root.current;
    const h = head.current;
    if (!g || !h) return;
    g.position.y = 0;
    g.rotation.z = 0;
    g.rotation.x = 0;
    h.rotation.y = 0;
    h.position.y = 1.15;
    switch (state.status) {
      case "idle":
        if (idleSince.current === null) idleSince.current = t;
        g.rotation.z = Math.sin(t * 0.8) * 0.03;
        h.rotation.y = Math.sin(t * 0.5) * 0.25;
        break;
      case "thinking":
        idleSince.current = null;
        h.rotation.y = Math.sin(t * 2.2) * 0.12;
        h.position.y = 1.15 + Math.sin(t * 6) * 0.015;
        break;
      case "tool_use":
        idleSince.current = null;
        g.position.y = Math.abs(Math.sin(t * 12)) * 0.03;
        h.position.y = 1.15 + Math.sin(t * 12) * 0.02;
        break;
      case "waiting":
        idleSince.current = null;
        g.position.y = Math.abs(Math.sin(t * 4)) * 0.22;
        h.rotation.y = Math.sin(t * 3) * 0.3;
        break;
      case "done":
        idleSince.current = null;
        g.position.y = Math.abs(Math.sin(t * 7)) * 0.12;
        g.rotation.z = Math.sin(t * 7) * 0.08;
        break;
      case "error":
        idleSince.current = null;
        g.rotation.x = 0.35;
        g.position.y = -0.08;
        break;
    }
  });

  const [showZzz, setShowZzz] = useState(false);
  useEffect(() => {
    if (state.status !== "idle") {
      setShowZzz(false);
      return;
    }
    const t = setTimeout(() => setShowZzz(true), 15000);
    return () => clearTimeout(t);
  }, [state.status]);
  const dot = statusColor[state.status];

  return (
    <group ref={root}>
      {/* body */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.5, 4, 8]} />
        <meshStandardMaterial color={agent.color} />
      </mesh>
      {/* head */}
      <group ref={head} position={[0, 1.15, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.26, 12, 10]} />
          <meshStandardMaterial color="#f1d3b5" />
        </mesh>
        {/* eyes: face towards camera-ish (+x,+z) */}
        <mesh position={[0.12, 0.05, 0.22]}>
          <sphereGeometry args={[0.035, 6, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[-0.05, 0.05, 0.25]}>
          <sphereGeometry args={[0.035, 6, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        {look.prop === "headset" && (
          <mesh rotation={[0, 0, 0]} position={[0, 0.08, 0]}>
            <torusGeometry args={[0.28, 0.035, 6, 16, Math.PI]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        )}
        {look.prop === "glasses" && (
          <group position={[0.04, 0.05, 0.24]}>
            <mesh position={[0.08, 0, 0]}>
              <boxGeometry args={[0.1, 0.07, 0.02]} />
              <meshStandardMaterial color="#222" />
            </mesh>
            <mesh position={[-0.09, 0, 0]}>
              <boxGeometry args={[0.1, 0.07, 0.02]} />
              <meshStandardMaterial color="#222" />
            </mesh>
          </group>
        )}
        {/* hair blob coloured per agent */}
        <mesh position={[0, 0.18, -0.05]}>
          <sphereGeometry args={[0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={agent.color} />
        </mesh>
      </group>
      {look.prop === "clipboard" && (
        <mesh position={[0.32, 0.6, 0.15]} rotation={[0.3, 0.4, 0]}>
          <boxGeometry args={[0.22, 0.3, 0.02]} />
          <meshStandardMaterial color="#d9c9a0" />
        </mesh>
      )}
      {/* status dot */}
      <mesh position={[0.35, 1.5, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color={dot} emissive={dot} emissiveIntensity={0.6} />
      </mesh>
      {/* hover ring */}
      {hovered && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.58, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}

      {/* bubbles */}
      {state.status === "waiting" && <Bubble text="?" color="#f2c14e" />}
      {state.status === "error" && <Bubble text="!" color="#e05a5a" />}
      {state.status === "done" && <Bubble text="✓" color="#5ec8c0" />}
      {showZzz && <Bubble text="zzz" color="#9aa3ad" small />}
      {busy && state.subagents.length > 0 && <CallBubble subagents={state.subagents} />}
    </group>
  );
}

function Bubble({ text, color, small }: { text: string; color: string; small?: boolean }) {
  return (
    <Html position={[0, 1.75, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
      <div
        style={{
          background: "#fff",
          color,
          fontWeight: 800,
          fontSize: small ? 11 : 18,
          padding: small ? "1px 6px" : "2px 9px",
          borderRadius: 10,
          border: `2px solid ${color}`,
          fontFamily: "ui-monospace, monospace",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 6px rgba(0,0,0,.4)",
          animation: small ? "none" : "pop .25s ease-out",
        }}
      >
        {text}
      </div>
    </Html>
  );
}
