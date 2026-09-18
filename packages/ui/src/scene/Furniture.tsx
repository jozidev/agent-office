import { furnitureUrl, useModelClone, FURNITURE_SCALE } from "./models";
import { ModelBoundary } from "./ModelBoundary";

interface Props {
  name: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

/** One Kenney furniture piece. */
export function Furniture(props: Props) {
  return (
    <ModelBoundary>
      <FurnitureInner {...props} />
    </ModelBoundary>
  );
}

function FurnitureInner({ name, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }: Props) {
  const obj = useModelClone(furnitureUrl(name));
  return <primitive object={obj} position={position} rotation={rotation} scale={FURNITURE_SCALE * scale} />;
}
