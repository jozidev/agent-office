import { Suspense } from "react";
import { Furniture } from "./Furniture";
import { rowEnds, roomSize, KITCHEN_DEPTH, PAD } from "./layout";

const WALL_H = 2.7;
const LOW_WALL_H = 0.55;
const T = 0.16;

/**
 * An enclosed office: full back walls with windows, low cut-away front walls
 * with a door, a kitchen strip along the back,
 * the front (+x), bookcase and supply closet on the left. Desk rows in the middle.
 */
export function Room({ agentCount }: { agentCount: number }) {
  const { w, d } = roomSize(agentCount);
  const hw = w / 2;
  const hd = d / 2;
  const ends = rowEnds(agentCount);
  const kitchenZ = -hd + KITCHEN_DEPTH / 2 + 0.2;

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
          <Furniture name="rugDoormat" position={[0, 0.01, -0.5]} />
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

      {/* Back wall, laid out left to right as slots so nothing overlaps:
          kitchen (fridge + 3 cabinets + bin + cooler, ~5.6) | whiteboard 1.9 | clock 0.6 | window 1.3 | window 1.3 | posters 1.4 | server door 1.0 */}
      {(() => {
        const zWall = -hd + T / 2 + 0.02;
        const gap = 0.45;
        let x = -hw + 0.3;
        const slot = (width: number) => {
          const cx = x + width / 2;
          x += width + gap;
          return cx;
        };
        const kitchenX = slot(5.6);
        const boardX = slot(1.9);
        const clockX = slot(0.6);
        const win1 = slot(1.3);
        const doorX = slot(1.0);
        const used = x - gap - (-hw + 0.3);
        // if the wall is wider than the content, spread the extra space to the right of the kitchen
        const extra = Math.max(0, w - 0.6 - used);
        const shift = (v: number) => v + (v > kitchenX ? extra : 0);
        return (
          <>
            <Whiteboard position={[shift(boardX), 1.6, zWall]} />
            <Clock position={[shift(clockX), 2.0, zWall]} />
            <Window position={[shift(win1), 1.7, zWall]} rotation={[0, 0, 0]} />
            <ServerDoor position={[shift(doorX), 0, zWall]} />
            <Suspense fallback={null}>
              <group position={[kitchenX - 2.8, 0, -hd + 0.65]} scale={0.8}>
                <Furniture name="kitchenFridge" position={[0.5, 0, 0.1]} rotation={[0, Math.PI / 2, 0]} />
                <Furniture name="kitchenCabinetDrawer" position={[1.65, 0, 0]} />
                <Furniture name="kitchenSink" position={[2.7, 0, 0]} />
                <Furniture name="kitchenCabinet" position={[3.75, 0, 0]} />
                <Furniture name="kitchenMicrowave" position={[3.75, 0.95, 0]} scale={0.9} />
                <Furniture name="kitchenCoffeeMachine" position={[1.65, 0.95, 0]} />
                <Furniture name="trashcan" position={[4.75, 0, 0]} />
                {/* water cooler */}
                <group position={[5.6, 0, 0]}>
                  <mesh position={[0, 0.5, 0]}>
                    <boxGeometry args={[0.36, 1.0, 0.36]} />
                    <meshStandardMaterial color="#e6e8ec" />
                  </mesh>
                  <mesh position={[0, 1.22, 0]}>
                    <cylinderGeometry args={[0.15, 0.17, 0.45, 12]} />
                    <meshStandardMaterial color="#7fc4e8" transparent opacity={0.8} />
                  </mesh>
                </group>
              </group>
            </Suspense>
          </>
        );
      })()}

      {/* left wall: window, posters above the bookcase, window */}
      <Window position={[-hw + T / 2 + 0.01, 1.7, -hd + d * 0.42]} rotation={[0, Math.PI / 2, 0]} />
      <Poster position={[-hw + T / 2 + 0.02, 1.9, -hd + d * 0.57]} rotation={[0, Math.PI / 2, 0]} color="#b23a3a" accent="#f2c14e" />
      <Poster position={[-hw + T / 2 + 0.02, 1.9, -hd + d * 0.64]} rotation={[0, Math.PI / 2, 0]} color="#2a5f8f" accent="#e6e8ec" />
      <Window position={[-hw + T / 2 + 0.01, 1.7, -hd + d * 0.82]} rotation={[0, Math.PI / 2, 0]} />

      {/* supply closet and bookcase on the left wall */}
      <Closet position={[-hw + T / 2 + 0.02, 0, -hd + d * 0.25]} />

      <Suspense fallback={null}>
        {/* left wall: bookcase and a plant */}
        <Furniture name="bookcaseClosedWide" position={[-hw + 0.45, 0, -hd + d * 0.6]} rotation={[0, Math.PI / 2, 0]} />
        <Furniture name="pottedPlant" position={[-hw + 0.7, 0, -hd + d * 0.72]} />


        {/* a plant at the aisle end of each row */}
        {ends.map((p, i) => (
          <Furniture key={i} name={i % 2 ? "plantSmall2" : "pottedPlant"} position={p} scale={i % 2 ? 1 : 0.8} />
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
    </group>
  );
}

function Poster({ position, rotation = [0, 0, 0], color, accent }: { position: [number, number, number]; rotation?: [number, number, number]; color: string; accent: string }) {
  return (
    <group position={position} rotation={rotation}>
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

export { PAD };
