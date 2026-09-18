import { Canvas, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { useOffice } from "../store";
import { Seat } from "./Seat";
import { Room } from "./Room";
import { roomSize, seatFor } from "./layout";
import { preloadModels } from "./models";

preloadModels();

/** Fit the room into the viewport: the iso footprint is roughly (w+d) wide and (w+d)/2 tall. */
function FitCamera({ w, d }: { w: number; d: number }) {
  const { size } = useThree();
  // camera on the (1,1,1) diagonal: screen width = (w+d)/√2, screen height = (w+d)/√2·sin(35.26°) + wall height·cos(35.26°)
  const hspan = (w + d) / Math.SQRT2 + 1.0;
  const vspan = ((w + d) / Math.SQRT2) * 0.577 + 2.7 * 0.816 + 1.2;
  const zoom = Math.min(size.width / hspan, size.height / vspan) * 0.96;
  return <OrthographicCamera makeDefault position={[14, 14, 14]} zoom={zoom} near={0.1} far={100} onUpdate={(c) => c.lookAt(0, 0.5, 0)} />;
}

export function OfficeScene() {
  const agents = useOffice((s) => s.agents);
  const states = useOffice((s) => s.states);
  const setSelected = useOffice((s) => s.setSelected);
  const list = Object.values(agents);
  const { w, d } = roomSize(list.length);

  return (
    // resize.debounce 0: with a debounce, react-three-fiber can miss its first
    // container measurement and leave the canvas at the HTML default 300x150 —
    // an empty office then paints nothing at all, because no store update ever
    // arrives to force the re-render that would measure it again. Only shows up
    // in a production build; StrictMode's double render hides it in dev.
    <Canvas shadows dpr={[1, 2]} resize={{ debounce: 0, scroll: false }} onPointerMissed={() => setSelected(null)} className="canvas">
      <FitCamera w={w} d={d} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 12, 4]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
      <hemisphereLight args={["#c4ccdf", "#3a3f4c", 0.6]} />
      <Room agentCount={list.length} />
      {list.map((a) => {
        const st = states[a.id];
        if (!st) return null;
        const seat = seatFor(a.desk, list.length);
        return <Seat key={a.id} agent={a} state={st} position={seat.position} yaw={seat.yaw} />;
      })}
    </Canvas>
  );
}
