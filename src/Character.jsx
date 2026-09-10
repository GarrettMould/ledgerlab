import { useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";

export const CHARACTER_MODEL_URL = "/models/character.glb";

/**
 * Roblox-style blocky student avatar (from blender/make_roblox_character.py).
 * Optional `outfit` recolors named meshes: Torso, Leg_*, Shoe_*, Hair, Head, Arm_*, Eye_*.
 */
export function Character({ outfit, ...props }) {
  const { scene } = useGLTF(CHARACTER_MODEL_URL);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    if (!outfit) return;
    cloned.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const n = String(obj.name || "");
      let hex = null;
      if (n.startsWith("Torso") || n.startsWith("Shirt")) hex = outfit.shirt;
      else if (n.startsWith("Leg") || n.startsWith("Pants")) hex = outfit.pants;
      else if (n.startsWith("Shoe")) hex = outfit.shoes;
      else if (n.startsWith("Hair")) hex = outfit.hair;
      else if (n.startsWith("Eye")) hex = outfit.eyes;
      else if (n.startsWith("Head") || n.startsWith("Arm") || n.startsWith("Skin")) {
        hex = outfit.skin;
      }
      if (!hex) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m, i) => {
        if (!m?.color) return;
        if (!m.userData?.ledgerCloned) {
          const clonedMat = m.clone();
          clonedMat.userData = { ...clonedMat.userData, ledgerCloned: true };
          if (Array.isArray(obj.material)) obj.material[i] = clonedMat;
          else obj.material = clonedMat;
        }
        const target = Array.isArray(obj.material) ? obj.material[i] : obj.material;
        target.color.set(hex);
      });
    });
  }, [cloned, outfit]);

  return <primitive object={cloned} {...props} />;
}

useGLTF.preload(CHARACTER_MODEL_URL);

export default Character;
