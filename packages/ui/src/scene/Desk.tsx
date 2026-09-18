import { Suspense, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { Agent, AgentState } from "@agent-office/shared";
import { useOffice } from "../store";
import { Character } from "./Character";
import { Furniture } from "./Furniture";

interface Props {
  agent: Agent;
  state: AgentState;
  position: [number, number, number];
}

/** Screen-space desk positions, for HTML5 drag-and-drop from the board. */
export const deskScreenPositions = new Map<string, { x: number; y: number }>();

/** Rotate every desk so the character faces the camera (camera sits at +x,+y,+z). */
const DESK_YAW = Math.PI / 2;

export function Desk({ agent, state, position }: Props) {
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
      rotation={[0, DESK_YAW, 0]}
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
      {/* invisible pick target so hover works on the whole desk area */}
      <mesh position={[0, 0.5, 0]} visible={false}>
        <boxGeometry args={[2, 1.6, 2]} />
      </mesh>

      <Suspense fallback={null}>
        {/* desk model origin is its back-left corner; centre it and put it in front of the character */}
        <Furniture name="desk" position={[-0.75, 0, 0.55]} />
        <Furniture name="computerScreen" position={[-0.32, 0.8, 0.45]} scale={0.7} />
        <Furniture name="computerKeyboard" position={[-0.28, 0.8, 0.85]} scale={0.8} />
        <Furniture name="chairDesk" position={[-0.15, 0, -0.3]} rotation={[0, 0, 0]} />
        <group position={[0, 0, -0.25]}>
          <Character agent={agent} state={state} hovered={hovered || selected} />
        </group>
      </Suspense>

      {/* monitor glow when busy */}
      {busy && <pointLight position={[-0.1, 1.1, 0.3]} intensity={0.8} distance={1.6} color="#5aa9ff" />}

      {dragging && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.15, 1.3, 32]} />
          <meshBasicMaterial color={busy ? "#e05a5a" : "#7bd88f"} transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}
