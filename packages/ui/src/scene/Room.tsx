import { Suspense } from "react";
import { Html } from "@react-three/drei";
import { Furniture } from "./Furniture";
import { podPositions, roomSize } from "./layout";

/**
 * Floor, two back walls, and the dressing that makes it feel like an office:
 * pod partitions and plants, a lounge corner, bookcase and lamp along the
 * left wall, coffee bar on the back wall, whiteboard and clock (usage gauges later).
 */
export function Room({ agentCount }: { agentCount: number }) {
  const { w, d } = roomSize(agentCount);
  const wallH = 2.6;
  const pods = podPositions(agentCount);

  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#454c5e" />
      </mesh>
      <Grid w={w} d={d} />
      {/* skirting */}
      <mesh position={[0, 0.06, -d / 2 + 0.08]}>
        <boxGeometry args={[w, 0.12, 0.04]} />
        <meshStandardMaterial color="#232733" />
      </mesh>
      <mesh position={[-w / 2 + 0.08, 0.06, 0]}>
        <boxGeometry args={[0.04, 0.12, d]} />
        <meshStandardMaterial color="#232733" />
      </mesh>
      {/* back wall (-z) and left wall (-x) */}
      <mesh position={[0, wallH / 2, -d / 2]} receiveShadow>
        <boxGeometry args={[w, wallH, 0.15]} />
        <meshStandardMaterial color="#353b4c" />
      </mesh>
      <mesh position={[-w / 2, wallH / 2, 0]} receiveShadow>
        <boxGeometry args={[0.15, wallH, d]} />
        <meshStandardMaterial color="#2f3444" />
      </mesh>

      {/* wall props (usage gauges in milestone 7) */}
      <group position={[-w / 6, 1.55, -d / 2 + 0.1]}>
        <mesh>
          <boxGeometry args={[1.9, 1.05, 0.05]} />
          <meshStandardMaterial color="#6a7080" />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[1.75, 0.9, 0.03]} />
          <meshStandardMaterial color="#e6e8ec" />
        </mesh>
        {[0.25, 0.05, -0.15].map((y, i) => (
          <mesh key={i} position={[-0.3 + i * 0.1, y, 0.05]}>
            <boxGeometry args={[0.9 - i * 0.2, 0.05, 0.01]} />
            <meshStandardMaterial color={["#4aa3df", "#e05a5a", "#3a3f4b"][i]} />
          </mesh>
        ))}
        <Label text="whiteboard" position={[0, 0.75, 0]} />
      </group>
      <group position={[w / 5, 1.85, -d / 2 + 0.1]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.05, 24]} />
          <meshStandardMaterial color="#e6e8ec" />
        </mesh>
        <mesh position={[0, 0.1, 0.04]}>
          <boxGeometry args={[0.03, 0.2, 0.01]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[0.07, 0.02, 0.04]} rotation={[0, 0, -1.1]}>
          <boxGeometry args={[0.03, 0.16, 0.01]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <Label text="clock" position={[0, 0.5, 0]} />
      </group>
      {/* server room door on the back wall, right side */}
      <group position={[w / 2 - 1.4, 0, -d / 2 + 0.12]}>
        <mesh position={[0, 1.0, 0]}>
          <boxGeometry args={[1.0, 2.0, 0.08]} />
          <meshStandardMaterial color="#4b5570" />
        </mesh>
        <mesh position={[0, 1.55, 0.05]}>
          <boxGeometry args={[0.5, 0.35, 0.02]} />
          <meshStandardMaterial color="#1c2230" emissive="#2b6cb0" emissiveIntensity={0.4} />
        </mesh>
        <Label text="server room" position={[0, 2.25, 0]} />
      </group>
      {/* supply closet on the left wall */}
      <group position={[-w / 2 + 0.12, 0, -d / 4]}>
        <mesh position={[0, 1.0, 0]}>
          <boxGeometry args={[0.08, 2.0, 1.0]} />
          <meshStandardMaterial color="#6b4a33" />
        </mesh>
        <mesh position={[0.05, 1.0, 0.35]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#d9c27a" />
        </mesh>
        <Label text="supply closet" position={[0, 2.25, 0]} />
      </group>

      <Suspense fallback={null}>
        {/* pod partitions + plant at the end of each pod */}
        {pods.map(([x, , z], i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0.9, 0.55, 0]}>
              <boxGeometry args={[0.06, 1.1, 3.3]} />
              <meshStandardMaterial color="#525a6e" />
            </mesh>
            <Furniture name="plantSmall2" position={[-0.9, 0, 1.75]} />
          </group>
        ))}

        {/* coffee bar on the back wall, left of the whiteboard */}
        <group position={[-w / 2 + 2.4, 0, -d / 2 + 0.55]}>
          <Furniture name="cabinetTelevision" position={[-0.7, 0, 0.3]} />
          <Furniture name="kitchenCoffeeMachine" position={[-0.45, 0.55, 0.35]} />
          <Furniture name="books" position={[0.3, 0.55, 0.3]} scale={0.8} />
          <Label text="coffee" position={[-0.2, 1.35, 0.3]} />
        </group>

        {/* bookcase + lamp along the left wall */}
        <Furniture name="bookcaseOpen" position={[-w / 2 + 0.2, 0, d / 4]} rotation={[0, Math.PI / 2, 0]} />
        <Furniture name="lampSquareFloor" position={[-w / 2 + 0.6, 0, d / 4 + 1.4]} />

        {/* lounge corner in the foreground (+x, +z) */}
        <group position={[w / 2 - 1.9, 0, d / 2 - 2.0]}>
          <Furniture name="rugRectangle" position={[-1.2, 0, 0.9]} />
          <Furniture name="tableCoffee" position={[-0.5, 0, 0.4]} rotation={[0, Math.PI / 2, 0]} />
          <Furniture name="loungeChair" position={[0.6, 0, -0.2]} rotation={[0, -Math.PI / 2, 0]} />
          <Furniture name="loungeChair" position={[-0.9, 0, 1.4]} rotation={[0, Math.PI, 0]} />
          <Furniture name="pottedPlant" position={[1.1, 0, 1.2]} />
        </group>
        <Furniture name="plantSmall1" position={[w / 2 - 0.5, 0, -d / 2 + 0.8]} />
      </Suspense>
    </group>
  );
}

/** Floor grid clipped to the room (gridHelper is always square). */
function Grid({ w, d }: { w: number; d: number }) {
  const step = 1.5;
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
          <lineBasicMaterial color="#535b6f" />
        </line>
      ))}
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
