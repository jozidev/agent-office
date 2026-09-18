import { Suspense } from "react";
import { Html } from "@react-three/drei";
import { Furniture } from "./Furniture";
import { islandCount, islandPosition, roomSize, KITCHEN_DEPTH, SIDE_DEPTH, PAD } from "./layout";
import { Island } from "./Island";

const WALL_H = 2.7;
const LOW_WALL_H = 0.55;
const T = 0.16;

/**
 * An enclosed office: full back walls with windows, low cut-away front walls
 * with a door, a kitchen strip along the back, meeting table and lounge along
 * the right, bookcase and supply closet on the left. Desk islands in the middle.
 */
export function Room({ agentCount }: { agentCount: number }) {
  const { w, d } = roomSize(agentCount);
  const hw = w / 2;
  const hd = d / 2;
  const islands = Array.from({ length: islandCount(agentCount) }, (_, i) => islandPosition(i, agentCount));
  const kitchenZ = -hd + KITCHEN_DEPTH / 2 + 0.2;
  const sideX = hw - SIDE_DEPTH / 2;

  return (
    <group>
      {/* floor: carpet with a lighter tile grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#3f5b63" />
      </mesh>
      <Grid w={w} d={d} />
      {/* kitchen floor: tiles */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, kitchenZ]}>
        <planeGeometry args={[w - 0.3, KITCHEN_DEPTH]} />
        <meshStandardMaterial color="#5b6370" />
      </mesh>

      {/* back walls */}
      <Wall position={[0, WALL_H / 2, -hd]} size={[w, WALL_H, T]} color="#3a4152" />
      <Wall position={[-hw, WALL_H / 2, 0]} size={[T, WALL_H, d]} color="#333a4a" />
      {/* low front walls (cut away so we can see in), with a door gap on the left-front wall */}
      <Wall position={[hw, LOW_WALL_H / 2, 0]} size={[T, LOW_WALL_H, d]} color="#3a4152" />
      <Wall position={[-1.2, LOW_WALL_H / 2, hd]} size={[w - 2.4 - 1.6, LOW_WALL_H, T]} color="#333a4a" />
      <Wall position={[hw - 0.8, LOW_WALL_H / 2, hd]} size={[1.6, LOW_WALL_H, T]} color="#333a4a" />
      {/* door in the gap at the front-left */}
      <group position={[-hw + 1.3, 0, hd]}>
        {/* frame */}
        <mesh position={[-0.62, 1.05, 0]}>
          <boxGeometry args={[0.1, 2.1, 0.2]} />
          <meshStandardMaterial color="#6b4a33" />
        </mesh>
        <mesh position={[0.62, 1.05, 0]}>
          <boxGeometry args={[0.1, 2.1, 0.2]} />
          <meshStandardMaterial color="#6b4a33" />
        </mesh>
        <mesh position={[0, 2.12, 0]}>
          <boxGeometry args={[1.34, 0.12, 0.2]} />
          <meshStandardMaterial color="#6b4a33" />
        </mesh>
        {/* door, ajar */}
        <group position={[-0.57, 0, 0]} rotation={[0, -0.6, 0]}>
          <mesh position={[0.55, 1.0, 0]}>
            <boxGeometry args={[1.1, 2.0, 0.06]} />
            <meshStandardMaterial color="#8a5a3c" />
          </mesh>
          <mesh position={[0.55, 1.3, 0.04]}>
            <boxGeometry args={[0.5, 0.5, 0.01]} />
            <meshStandardMaterial color="#9fc4e0" transparent opacity={0.8} />
          </mesh>
          <mesh position={[0.95, 1.0, 0.05]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#d9c27a" />
          </mesh>
        </group>
        <Suspense fallback={null}>
          <Furniture name="rugDoormat" position={[-0.4, 0.01, -0.5]} />
        </Suspense>
      </group>
      {/* skirting */}
      <mesh position={[0, 0.05, -hd + T / 2 + 0.02]}>
        <boxGeometry args={[w, 0.1, 0.04]} />
        <meshStandardMaterial color="#232733" />
      </mesh>
      <mesh position={[-hw + T / 2 + 0.02, 0.05, 0]}>
        <boxGeometry args={[0.04, 0.1, d]} />
        <meshStandardMaterial color="#232733" />
      </mesh>

      {/* windows on the back walls */}
      {[-hw + w * 0.62, -hw + w * 0.78].map((x, i) => (
        <Window key={`b${i}`} position={[x, 1.7, -hd + T / 2 + 0.01]} rotation={[0, 0, 0]} />
      ))}
      {[-hd + d * 0.45, -hd + d * 0.62].map((z, i) => (
        <Window key={`l${i}`} position={[-hw + T / 2 + 0.01, 1.7, z]} rotation={[0, Math.PI / 2, 0]} />
      ))}

      {/* whiteboard, clock, posters and server room on the back wall */}
      <Whiteboard position={[-hw + w * 0.42, 1.6, -hd + T / 2 + 0.02]} />
      <Clock position={[-hw + w * 0.52, 2.05, -hd + T / 2 + 0.02]} />
      <Poster position={[-hw + w * 0.9, 1.75, -hd + T / 2 + 0.02]} color="#b23a3a" accent="#f2c14e" />
      <Poster position={[-hw + w * 0.96, 1.75, -hd + T / 2 + 0.02]} color="#2a5f8f" accent="#e6e8ec" />
      <ServerDoor position={[hw - 1.3, 0, -hd + T / 2 + 0.02]} />

      {/* supply closet and bookcase on the left wall */}
      <Closet position={[-hw + T / 2 + 0.02, 0, -hd + d * 0.3]} />

      <Suspense fallback={null}>
        {/* kitchen strip along the back wall (left part) */}
        <group position={[-hw + 0.25, 0, -hd + 0.25]} scale={0.8}>
          <Furniture name="kitchenFridge" position={[0.2, 0, 0.55]} rotation={[0, Math.PI / 2, 0]} />
          <Furniture name="kitchenCabinetDrawer" position={[1.0, 0, 0.75]} />
          <Furniture name="kitchenSink" position={[2.05, 0, 0.75]} />
          <Furniture name="kitchenCabinet" position={[3.1, 0, 0.75]} />
          <Furniture name="kitchenMicrowave" position={[3.25, 0.95, 0.7]} scale={0.9} />
          <Furniture name="kitchenCoffeeMachine" position={[1.15, 0.95, 0.65]} />
          <Furniture name="kitchenCabinetUpper" position={[2.05, 1.55, 0.35]} />
          <Furniture name="trashcan" position={[4.2, 0, 0.5]} />
          <Label text="kitchen" position={[2.2, 2.3, 0.7]} />
        </group>
        {/* water cooler by the kitchen */}
        <group position={[-hw + 4.4, 0, -hd + 0.6]} scale={0.85}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.36, 1.0, 0.36]} />
            <meshStandardMaterial color="#e6e8ec" />
          </mesh>
          <mesh position={[0, 1.22, 0]}>
            <cylinderGeometry args={[0.15, 0.17, 0.45, 12]} />
            <meshStandardMaterial color="#7fc4e8" transparent opacity={0.8} />
          </mesh>
        </group>

        {/* left wall: bookcase and a plant */}
        <Furniture name="bookcaseClosedWide" position={[-hw + 0.22, 0, -hd + d * 0.55]} rotation={[0, Math.PI / 2, 0]} />
        <Furniture name="pottedPlant" position={[-hw + 0.7, 0, -hd + d * 0.72]} />

        {/* meeting table on the right side (back half) */}
        <group position={[sideX - 0.2, 0, -hd + d * 0.42]}>
          <Furniture name="rugRectangle" position={[-1.1, 0, 0.9]} scale={1.1} />
          <Furniture name="tableRound" position={[0, 0, 0]} scale={1.15} />
          {([[-1.05, 0], [1.05, 0], [0, -1.05], [0, 1.05]] as [number, number][]).map(([ox, oz], i) => (
            // chair model faces -z; turn it towards the table
            <Furniture key={i} name="chair" position={[ox, 0, oz]} rotation={[0, Math.atan2(-ox, -oz) + Math.PI, 0]} scale={0.85} />
          ))}
          <Furniture name="books" position={[0.1, 0.78, 0.1]} scale={0.7} />
          <Label text="meeting" position={[0, 1.5, 0]} />
        </group>

        {/* lounge on the right side (front half): sofa, coffee table, tv */}
        <group position={[sideX - 0.3, 0, hd - 2.6]} scale={0.85}>
          <Furniture name="rugRectangle" position={[-0.9, 0, 0.7]} />
          <Furniture name="loungeSofa" position={[1.1, 0, -0.6]} rotation={[0, -Math.PI / 2, 0]} />
          <Furniture name="tableCoffee" position={[-0.1, 0, 0.2]} rotation={[0, Math.PI / 2, 0]} />
          <Furniture name="cabinetTelevision" position={[-1.9, 0, 0.2]} rotation={[0, Math.PI / 2, 0]} />
          <Furniture name="televisionModern" position={[-1.75, 0.55, 0.2]} rotation={[0, Math.PI / 2, 0]} scale={0.7} />
          <Furniture name="plantSmall1" position={[1.3, 0, 1.4]} />
        </group>

        {/* desk islands */}
        {islands.map((p, i) => (
          <Island key={i} position={p} />
        ))}
      </Suspense>
    </group>
  );
}

function Wall({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return (
    <mesh position={position} receiveShadow castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Window({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[1.3, 0.95, 0.04]} />
        <meshStandardMaterial color="#d9dde6" />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[1.15, 0.8, 0.02]} />
        <meshStandardMaterial color="#8fb7d9" emissive="#5a86b3" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.04, 0.8, 0.01]} />
        <meshStandardMaterial color="#d9dde6" />
      </mesh>
    </group>
  );
}

function Whiteboard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
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
  );
}

function Clock({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
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
  );
}

function Poster({ position, color, accent }: { position: [number, number, number]; color: string; accent: string }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.6, 0.85, 0.03]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.15, 0.02]}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      <mesh position={[0, -0.25, 0.02]}>
        <boxGeometry args={[0.4, 0.06, 0.01]} />
        <meshStandardMaterial color={accent} />
      </mesh>
    </group>
  );
}

function ServerDoor({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[1.0, 2.0, 0.08]} />
        <meshStandardMaterial color="#4b5570" />
      </mesh>
      <mesh position={[0, 1.55, 0.05]}>
        <boxGeometry args={[0.5, 0.35, 0.02]} />
        <meshStandardMaterial color="#1c2230" emissive="#2b6cb0" emissiveIntensity={0.5} />
      </mesh>
      <Label text="server room" position={[0, 2.25, 0]} />
    </group>
  );
}

function Closet({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[0.08, 2.0, 1.1]} />
        <meshStandardMaterial color="#6b4a33" />
      </mesh>
      <mesh position={[0.05, 1.0, 0.4]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#d9c27a" />
      </mesh>
      <Label text="supply closet" position={[0, 2.25, 0]} />
    </group>
  );
}

/** Floor grid clipped to the room. */
function Grid({ w, d }: { w: number; d: number }) {
  const step = 1.4;
  const lines: [number, number, number, number][] = [];
  for (let x = -w / 2; x <= w / 2 + 0.001; x += step) lines.push([x, -d / 2, x, d / 2]);
  for (let z = -d / 2; z <= d / 2 + 0.001; z += step) lines.push([-w / 2, z, w / 2, z]);
  return (
    <group position={[0, 0.003, 0]}>
      {lines.map(([x1, z1, x2, z2], i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([x1, 0, z1, x2, 0, z2]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#4a6870" />
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

export { PAD };
