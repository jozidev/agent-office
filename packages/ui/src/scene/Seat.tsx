import { Suspense, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Vector3 } from "three";
import type { Agent, AgentState } from "@agent-office/shared";
import { useOffice } from "../store";
import { Character } from "./Character";
import { Furniture } from "./Furniture";

interface Props {
  agent: Agent;
  state: AgentState;
  position: [number, number, number];
  /** π/2 faces +x, 0 faces +z */
  yaw: number;
}

/** Screen-space seat positions, for HTML5 drag-and-drop from the board. */
export const deskScreenPositions = new Map<string, { x: number; y: number }>();

/**
 * One workstation: desk, chair, character, monitor(s), keyboard, mug, name on
 * the floor, glow when busy. Coders get a second monitor.
 */
export function Seat({ agent, state, position, yaw }: Props) {
  const hovered = useOffice((s) => s.hoveredAgentId === agent.id);
  const selected = useOffice((s) => s.selectedAgentId === agent.id);
  const dragging = useOffice((s) => s.draggingTicketId !== null);
  const setHovered = useOffice((s) => s.setHovered);
  const setSelected = useOffice((s) => s.setSelected);
  const { camera, size } = useThree();
  const world = useRef(new Vector3());

  useFrame(() => {
    world.current.set(position[0], 0.8, position[2]).project(camera);
    deskScreenPositions.set(agent.id, {
      x: ((world.current.x + 1) / 2) * size.width,
      y: ((1 - world.current.y) / 2) * size.height,
    });
  });

  const busy = state.status !== "idle";

  return (
    <group
      position={position}
      rotation={[0, yaw, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(agent.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        setSelected(selected ? null : agent.id);
      }}
    >
      {/* pick target */}
      <mesh position={[0, 0.7, 0.4]} visible={false}>
        <boxGeometry args={[1.6, 1.6, 2.2]} />
      </mesh>

      <Suspense fallback={null}>
        {/* local +z is the facing direction: desk in front, monitor and keyboard on it */}
        <Furniture name="desk" position={[0, 0, 0.85]} />
        <Furniture name="computerScreen" position={[-0.15, 0.8, 0.95]} scale={0.7} />
        {agent.role === "coder" && <Furniture name="computerScreen" position={[0.45, 0.8, 0.9]} scale={0.6} rotation={[0, -0.35, 0]} />}
        <Furniture name="computerKeyboard" position={[-0.1, 0.8, 0.6]} scale={0.8} />
        <Furniture name="chairDesk" position={[0, 0, -0.1]} />
        {/* mug */}
        <mesh position={[0.6, 0.86, 0.6]}>
          <cylinderGeometry args={[0.055, 0.05, 0.11, 10]} />
          <meshStandardMaterial color={agent.color} />
        </mesh>
        <Character agent={agent} state={state} hovered={hovered || selected} />
      </Suspense>

      {/* name on the floor behind the chair */}
      <Html position={[0, 0.02, -0.75]} center zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
        <div
          style={{
            color: hovered || selected ? "#fff" : "#aeb6c2",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            whiteSpace: "nowrap",
            opacity: 0.85,
            textShadow: "0 1px 2px rgba(0,0,0,.6)",
          }}
        >
          {agent.name}
        </div>
      </Html>

      {busy && <pointLight position={[-0.2, 1.1, 0.6]} intensity={0.7} distance={1.6} color="#5aa9ff" />}

      {dragging && (
        <mesh position={[0, 0.03, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.8, 0.92, 32]} />
          <meshBasicMaterial color={busy ? "#e05a5a" : "#7bd88f"} transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}
