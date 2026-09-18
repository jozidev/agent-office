import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Color, Mesh, type Material, type MeshStandardMaterial, type Object3D } from "three";

/** Furniture Kit ships light pine + silver; recolour to match the dark office. */
const FURNITURE_PALETTE: Record<string, string> = {
  wood: "#5a4030",
  woodDark: "#3e2c20",
  metal: "#3b4150",
  metalMedium: "#2e333f",
  metalDark: "#1f232c",
  carpet: "#3f4658",
  carpetDarker: "#333a4a",
  carpetWhite: "#6b7386",
  lamp: "#d8cfb8",
};
const recoloured = new WeakSet<Material>();

/** Darker / muted skins from the Blocky Characters pack. */
export const CHARACTER_IDS = "abefjknqrgh".split("");

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
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (url.includes("/furniture/")) {
          const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const hex = FURNITURE_PALETTE[m.name];
            const std = m as MeshStandardMaterial;
            if (hex && !recoloured.has(m) && std.color) {
              std.color = new Color(hex);
              recoloured.add(m);
            }
          }
        }
      }
    });
    return clone;
  }, [gltf.scene, url]);
}

export function preloadModels() {
  for (const id of CHARACTER_IDS) useGLTF.preload(characterUrl(id));
  for (const f of ["desk", "chairDesk", "computerScreen", "computerKeyboard", "kitchenCoffeeMachine", "pottedPlant", "plantSmall1", "bookcaseOpen", "lampSquareFloor", "cabinetTelevision", "plantSmall2", "books", "rugRectangle", "tableCoffee", "loungeChair"]) useGLTF.preload(furnitureUrl(f));
}
