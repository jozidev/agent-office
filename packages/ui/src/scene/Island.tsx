import { Suspense } from "react";
import { Furniture } from "./Furniture";

/** Shared desk block that up to four agents sit around. */
export function Island({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* top */}
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.08, 2.4]} />
        <meshStandardMaterial color="#5a4030" />
      </mesh>
      {/* body / drawers */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[2.1, 0.72, 2.1]} />
        <meshStandardMaterial color="#3e2c20" />
      </mesh>
      {/* cable tray + a few desk things */}
      <mesh position={[0.6, 0.82, 0.6]}>
        <boxGeometry args={[0.35, 0.04, 0.25]} />
        <meshStandardMaterial color="#d9c9a0" />
      </mesh>
      <mesh position={[0.75, 0.86, 0.15]}>
        <cylinderGeometry args={[0.06, 0.05, 0.12, 10]} />
        <meshStandardMaterial color="#e05a5a" />
      </mesh>
      <Suspense fallback={null}>
        <Furniture name="rugRectangle" position={[-1.9, 0.002, 1.6]} scale={1.75} />
        <Furniture name="plantSmall2" position={[0.75, 0.8, -0.2]} scale={0.7} />
        <Furniture name="lampSquareTable" position={[0.55, 0.8, 0.85]} scale={0.8} />
      </Suspense>
    </group>
  );
}
