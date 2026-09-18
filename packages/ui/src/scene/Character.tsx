import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useAnimations } from "@react-three/drei";
import type { Group } from "three";
import type { Agent, AgentState } from "@agent-office/shared";
import { statusColor } from "../store";
import { CallBubble } from "./CallBubble";
import { CHARACTER_IDS, characterUrl, useModelClone } from "./models";
import { useGLTF } from "@react-three/drei";

interface Props {
  agent: Agent;
  state: AgentState;
  hovered: boolean;
}

/** Kenney character scale: the models are ~2 units tall; we want ~1.4 m in scene. */
const CHAR_SCALE = 0.62;

/** Which clip plays for which status. Names come from the Blocky Characters pack. */
const CLIP: Record<AgentState["status"], string> = {
  idle: "sit",
  thinking: "sit",
  tool_use: "interact-right",
  waiting: "idle",
  done: "emote-yes",
  error: "die",
};

export function pickCharacterId(agent: Agent): string {
  let h = 0;
  for (const c of agent.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHARACTER_IDS[h % CHARACTER_IDS.length]!;
}

/**
 * Animated Kenney character. Status drives the clip; a few statuses add a
 * small procedural motion on top (bounce while waiting, hop when done).
 */
export function Character({ agent, state, hovered }: Props) {
  const root = useRef<Group>(null);
  const url = characterUrl(pickCharacterId(agent));
  const model = useModelClone(url);
  const { animations } = useGLTF(url);
  const { actions } = useAnimations(animations, root);
  const busy = state.status === "thinking" || state.status === "tool_use";

  useEffect(() => {
    const name = CLIP[state.status];
    const action = actions[name];
    if (!action) return;
    Object.values(actions).forEach((a) => a && a !== action && a.fadeOut(0.2));
    action.reset().fadeIn(0.2);
    if (name === "die" || name === "emote-yes") {
      action.clampWhenFinished = true;
      action.setLoop(2200 /* LoopOnce */, 1);
    } else {
      action.setLoop(2201 /* LoopRepeat */, Infinity);
    }
    action.play();
  }, [state.status, actions]);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.position.y = 0;
    if (state.status === "waiting") g.position.y = Math.abs(Math.sin(t * 4)) * 0.2;
    if (state.status === "done") g.position.y = Math.abs(Math.sin(t * 7)) * 0.08;
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
  // seated clips put the character lower; standing ones (waiting) need no offset
  const seated = CLIP[state.status] === "sit";

  return (
    <group ref={root}>
      <primitive object={model} scale={CHAR_SCALE} position={[0, seated ? 0.02 : 0, seated ? 0 : 0.25]} />
      {/* status dot above the head */}
      <mesh position={[0.35, 1.55, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color={dot} emissive={dot} emissiveIntensity={0.6} />
      </mesh>
      {hovered && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.58, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}
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
    <Html position={[0, 1.8, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
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
