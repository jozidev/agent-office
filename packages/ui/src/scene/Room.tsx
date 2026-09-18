import { Suspense } from "react";
import { Html } from "@react-three/drei";
import { Furniture } from "./Furniture";
import { roomSize } from "./layout";

/** Floor, two back walls, and the wall props that will become usage gauges (M7). */
export function Room({ agentCount }: { agentCount: number }) {
  const { w, d } = roomSize(agentCount);
  const wallH = 2.6;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#4b5266" />
      </mesh>
      <Grid w={w} d={d} />
      {/* back wall (-z) */}
      <mesh position={[0, wallH / 2, -d / 2]} receiveShadow>
        <boxGeometry args={[w, wallH, 0.15]} />
        <meshStandardMaterial color="#3a4052" />
      </mesh>
      {/* left wall (-x) */}
      <mesh position={[-w / 2, wallH / 2, 0]} receiveShadow>
        <boxGeometry args={[0.15, wallH, d]} />
        <meshStandardMaterial color="#333849" />
      </mesh>

      {/* wall props, placeholders for M7 gauges */}
      <Prop position={[-w / 4, 1.5, -d / 2 + 0.1]} size={[1.6, 0.9, 0.04]} color="#e9e9e9" label="whiteboard" />
      <Prop position={[w / 4, 1.7, -d / 2 + 0.1]} size={[0.5, 0.5, 0.04]} color="#f4f4f4" label="clock" round />
      <Prop position={[w / 2 - 1.2, 1.0, -d / 2 + 0.12]} size={[0.9, 2.0, 0.08]} color="#4b5570" label="server room" />
      <Prop position={[-w / 2 + 0.12, 1.0, d / 4]} size={[0.08, 2.0, 0.9]} color="#8a5a3c" label="supply closet" />
      <Suspense fallback={null}>
        {/* coffee corner along the left wall */}
        <group position={[-w / 2 + 0.7, 0, -d / 4]} rotation={[0, Math.PI / 2, 0]}>
          <Furniture name="cabinetTelevision" position={[-0.6, 0, 0]} />
          <Furniture name="kitchenCoffeeMachine" position={[-0.25, 0.55, 0.05]} />
          <Label text="coffee" position={[0, 1.3, 0]} />
        </group>
        <Furniture name="pottedPlant" position={[w / 2 - 0.6, 0, -d / 2 + 0.6]} />
        <Furniture name="plantSmall1" position={[-w / 2 + 0.5, 0, d / 2 - 0.8]} />
        <Furniture name="bookcaseOpen" position={[-w / 2 + 0.2, 0, d / 4 + 1.4]} rotation={[0, Math.PI / 2, 0]} />
        <Furniture name="lampSquareFloor" position={[w / 2 - 0.5, 0, d / 2 - 0.6]} />
      </Suspense>
    </group>
  );
}

/** Floor grid clipped to the room (gridHelper is always square). */
function Grid({ w, d }: { w: number; d: number }) {
  const step = 1.6;
  const lines: [number, number, number, number][] = [];
  for (let x = -w / 2; x <= w / 2 + 0.001; x += step) lines.push([x, -d / 2, x, d / 2]);
  for (let z = -d / 2; z <= d / 2 + 0.001; z += step) lines.push([-w / 2, z, w / 2, z]);
  return (
    <group position={[0, 0.005, 0]}>
      {lines.map(([x1, z1, x2, z2], i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([x1, 0, z1, x2, 0, z2]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#5b6378" />
        </line>
      ))}
    </group>
  );
}

function Prop({
  position,
  size,
  color,
  label,
  round,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  label: string;
  round?: boolean;
}) {
  return (
    <group position={position}>
      <mesh>
        {round ? <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[2], 20]} /> : <boxGeometry args={size} />}
        <meshStandardMaterial color={color} />
      </mesh>
      <Label text={label} position={[0, size[1] / 2 + 0.25, 0]} />
    </group>
  );
}

function Label({ text, position }: { text: string; position: [number, number, number] }) {
  return (
    <Html position={position} center zIndexRange={[2, 0]} style={{ pointerEvents: "none" }}>
      <div style={{ color: "#9aa3ad", fontSize: 10, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", opacity: 0.8 }}>{text}</div>
    </Html>
  );
}
