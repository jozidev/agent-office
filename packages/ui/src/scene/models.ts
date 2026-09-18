import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Object3D } from "three";

export const CHARACTER_IDS = "abcdefghijklmnopqr".split("");

export const characterUrl = (id: string) => `/models/characters/character-${id}.glb`;
export const furnitureUrl = (name: string) => `/models/furniture/${name}.glb`;

/** Kenney furniture is roughly 1 unit = 2 m; scale it to our 1 unit = 1 m scene. */
export const FURNITURE_SCALE = 2.1;

/** Load a GLB and return a fresh clone, so many desks can share one download. */
export function useModelClone(url: string): Object3D {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const clone = SkeletonUtils.clone(gltf.scene);
    clone.traverse((o) => {
      // @ts-expect-error mesh flags exist on Mesh only
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [gltf.scene]);
}

export function preloadModels() {
  for (const id of CHARACTER_IDS) useGLTF.preload(characterUrl(id));
  for (const f of ["desk", "chairDesk", "computerScreen", "computerKeyboard", "kitchenCoffeeMachine", "pottedPlant", "plantSmall1", "bookcaseOpen", "lampSquareFloor", "cabinetTelevision"]) useGLTF.preload(furnitureUrl(f));
}
