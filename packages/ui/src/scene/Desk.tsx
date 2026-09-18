import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { ROLE_PRESETS, type Agent, type AgentState } from "@agent-office/shared";
import { useOffice } from "../store";
import { Character } from "./Character";

interface Props {
  agent: Agent;
  state: AgentState;
  position: [number, number, number];
}

/** Screen-space desk positions, for HTML5 drag-and-drop from the board. */
export const deskScreenPositions = new Map<string, { x: number; y: number }>();

export function Desk({ agent, state, position }: Props) {
  const hovered = useOffice((s) => s.hoveredAgentId === agent.id);
  const selected = useOffice((s) => s.selectedAgentId === agent.id);
  const dragging = useOffice((s) => s.draggingTicketId !== null);
  const setHovered = useOffice((s) => s.setHovered);
  const setSelected = useOffice((s) => s.setSelected);
  const look = ROLE_PRESETS[agent.role].look;
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
      {/* desk top */}
      <mesh position={[0, 0.72, -0.55]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.08, 0.9]} />
        <meshStandardMaterial color="#8b6b4a" />
      </mesh>
      {/* legs */}
      {[-0.8, 0.8].map((x) =>
        [-0.95, -0.15].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.36, z]}>
            <boxGeometry args={[0.08, 0.72, 0.08]} />
            <meshStandardMaterial color="#5a4632" />
          </mesh>
        )),
      )}
      {/* monitor */}
      <group position={[0, 0.76, -0.8]}>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.9, 0.55, 0.05]} />
          <meshStandardMaterial color="#1a1d24" emissive={busy ? "#2b6cb0" : "#111"} emissiveIntensity={busy ? 0.7 : 0.1} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.2, 0.05, 0.15]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>
      {look.prop === "keyboard" && (
        <mesh position={[0, 0.78, -0.35]}>
          <boxGeometry args={[0.6, 0.03, 0.2]} />
          <meshStandardMaterial color="#2c2f38" />
        </mesh>
      )}
      {/* chair + character sit in front (+z) */}
      <mesh position={[0, 0.25, 0.35]}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 12]} />
        <meshStandardMaterial color="#3a3f4b" />
      </mesh>
      <group position={[0, 0.02, 0.35]} scale={0.85}>
        <Character agent={agent} state={state} hovered={hovered || selected} />
      </group>
      {/* drop highlight while dragging a ticket */}
      {dragging && (
        <mesh position={[0, 0.03, -0.1]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.05, 1.2, 32]} />
          <meshBasicMaterial color={busy ? "#e05a5a" : "#7bd88f"} transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}
