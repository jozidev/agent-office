import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { useOffice } from "../store";
import { Desk } from "./Desk";
import { Room } from "./Room";
import { deskSlot } from "./layout";
import { preloadModels } from "./models";

preloadModels();

export function OfficeScene() {
  const agents = useOffice((s) => s.agents);
  const states = useOffice((s) => s.states);
  const setSelected = useOffice((s) => s.setSelected);
  const list = Object.values(agents);
  const zoom = Math.max(36, 90 - list.length * 2.5);

  return (
    <Canvas shadows dpr={[1, 2]} onPointerMissed={() => setSelected(null)} className="canvas">
      {/* classic isometric-ish: equal x/z, elevated */}
      <OrthographicCamera makeDefault position={[12, 12, 12]} zoom={zoom} near={0.1} far={100} onUpdate={(c) => c.lookAt(0, 0.4, 0)} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[6, 12, 4]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} />
      <hemisphereLight args={["#c4ccdf", "#3a3f4c", 0.6]} />
      <Room agentCount={list.length} />
      {list.map((a) => {
        const st = states[a.id];
        if (!st) return null;
        return <Desk key={a.id} agent={a} state={st} position={deskSlot(a.desk, list.length).position} />;
      })}
    </Canvas>
  );
}
