import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float, Html, useGLTF } from "@react-three/drei";
import { createPortal } from "react-dom";
import { adjustCash } from "./api";
import { updateClassStudent } from "./classStore";

const BLENDER_CHARACTER_URL = "/models/character.glb?v=hairstyles1";

const DEFAULT_OUTFIT = {
  skin: "#e0b090",
  hair: "#3b2a1e",
  shirt: "#3f8f68",
  pants: "#1f3d30",
  shoes: "#2a241f",
  eyes: "#1a2e24",
  hairStyleId: "hair-block",
  ownedLuxuries: [],
  hat: null,
  glasses: null,
  neck: null,
  jersey: null,
  backpack: null,
  bag: null,
  prop: null,
};

// Roblox-style figure is ~4.5 units tall; scale to fit existing camera/shadows.
// Raised so feet/shoes stay in frame on thumb + closet canvases.
const AVATAR_BASE_Y = -0.88;
const AVATAR_SCALE = 0.4;
const AVATAR_SHADOW_Y = -0.92;

/** Character-local attach points (Y-up, matches exported GLB accessories). */
const ATTACH = {
  headTop: [0, 4.5, 0],
  eyes: [0, 4.08, 0.5],
  neck: [0, 3.5, 0],
  torso: [0, 2.5, 0],
  torsoBack: [0, 2.55, -0.55],
  shoulderL: [-0.95, 3.15, 0.05],
  handR: [1.35, 1.85, 0.2],
};

useGLTF.preload(BLENDER_CHARACTER_URL);

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Free starter closet + paid extras baked under each category. */
export const CLOSET_CATALOG = {
  skin: [
    { id: "skin-fair", label: "Fair", color: "#f0c9a8", price: 0 },
    { id: "skin-light", label: "Light", color: "#e0b090", price: 0 },
    { id: "skin-medium", label: "Medium", color: "#c68a5c", price: 0 },
    { id: "skin-brown", label: "Brown", color: "#8d5524", price: 0 },
    { id: "skin-deep", label: "Deep", color: "#5c3a21", price: 0 },
    { id: "skin-frankenstein", label: "Frankenstein", color: "#5b8f5e", price: 1800 },
    { id: "skin-jack", label: "Jack-o'-lantern", color: "#e67a1f", price: 1800 },
    { id: "skin-zombie", label: "Zombie", color: "#8fa87a", price: 1500 },
    { id: "skin-alien", label: "Alien", color: "#6ec4b8", price: 2200 },
    { id: "skin-shadow", label: "Shadow", color: "#3a3140", price: 2000 },
  ],
  hairStyle: [
    { id: "hair-block", label: "Block", mesh: "Hair_Block", swatch: "#3b2a1e", price: 0 },
    { id: "hair-tall", label: "Tall", mesh: "Hair_Tall", swatch: "#4a3428", price: 0 },
    { id: "hair-poof", label: "Poof", mesh: "Hair_Poof", swatch: "#5c4030", price: 0 },
    { id: "hair-side", label: "Side sweep", mesh: "Hair_Side", swatch: "#2c1810", price: 0 },
    { id: "hair-buzz", label: "Buzz", mesh: "Hair_Buzz", swatch: "#6b4423", price: 0 },
    { id: "hair-bald", label: "Bald", mesh: null, swatch: "#e0b090", price: 0 },
    {
      id: "acc-tophat",
      kind: "hat",
      label: "Top hat",
      url: "/accessories/TopHat.glb",
      attach: "headTop",
      color: "#080808",
      accent: "#8c0d14",
      price: 3500,
    },
    {
      id: "acc-helmet",
      kind: "hat",
      label: "Football helmet",
      url: "/accessories/FootballHelmet.glb?v=face2",
      attach: "headTop",
      color: "#a0171c",
      accent: "#b8babe",
      price: 4000,
    },
    {
      id: "acc-headphones",
      kind: "hat",
      label: "Headphones",
      url: "/accessories/Headphones.glb",
      attach: "headTop",
      color: "#0a0a0d",
      accent: "#d9401a",
      price: 2200,
    },
    {
      id: "acc-sunglasses",
      kind: "glasses",
      label: "Sunglasses",
      url: "/accessories/Sunglasses.glb",
      attach: "eyes",
      color: "#0a0a0a",
      accent: "#1a2228",
      price: 2500,
    },
  ],
  hair: [
    { id: "hair-black", label: "Black", color: "#1f1a16", price: 0 },
    { id: "hair-espresso", label: "Brown", color: "#3b2a1e", price: 0 },
    { id: "hair-copper", label: "Copper", color: "#8a4f28", price: 0 },
    { id: "hair-sand", label: "Blonde", color: "#c9a66b", price: 0 },
    { id: "hair-silver", label: "Silver", color: "#9a9590", price: 0 },
  ],
  shirt: [
    { id: "tee-forest", label: "Forest", color: "#3f8f68", price: 0 },
    { id: "tee-sky", label: "Sky", color: "#4a90a4", price: 0 },
    { id: "tee-sun", label: "Gold", color: "#c4a035", price: 0 },
    { id: "tee-berry", label: "Berry", color: "#a0455c", price: 0 },
    { id: "tee-ink", label: "Ink", color: "#24312b", price: 0 },
    {
      id: "acc-jersey",
      kind: "jersey",
      label: "Sports jersey",
      url: "/accessories/SportsJersey.glb",
      attach: "torso",
      color: "#d96b14",
      accent: "#edede6",
      price: 1500,
    },
    {
      id: "acc-backpack",
      kind: "backpack",
      label: "Backpack",
      url: "/accessories/Backpack.glb",
      attach: "torsoBack",
      color: "#245933",
      accent: "#141414",
      price: 1800,
    },
    {
      id: "acc-chain",
      kind: "neck",
      label: "Gold chain",
      url: "/accessories/GoldChain.glb",
      attach: "neck",
      color: "#d4ad35",
      accent: "#f0d078",
      price: 5000,
    },
    {
      id: "acc-scarf",
      kind: "neck",
      label: "Scarf",
      url: "/accessories/Scarf.glb",
      attach: "neck",
      color: "#9e1a1f",
      accent: "#c42a30",
      price: 900,
    },
  ],
  pants: [
    { id: "pants-pine", label: "Pine", color: "#1f3d30", price: 0 },
    { id: "pants-denim", label: "Denim", color: "#3d5a80", price: 0 },
    { id: "pants-khaki", label: "Khaki", color: "#8a7a4f", price: 0 },
    { id: "pants-slate", label: "Slate", color: "#4a5560", price: 0 },
    { id: "pants-black", label: "Black", color: "#1a1f1c", price: 0 },
  ],
  shoes: [
    { id: "shoes-brown", label: "Brown", color: "#2a241f", price: 0 },
    { id: "shoes-white", label: "White", color: "#f2f5f3", price: 0 },
    { id: "shoes-red", label: "Red", color: "#b04040", price: 0 },
    { id: "shoes-navy", label: "Navy", color: "#1e3a5f", price: 0 },
    { id: "shoes-green", label: "Green", color: "#2f6b4f", price: 0 },
    {
      id: "acc-purse",
      kind: "bag",
      label: "Purse",
      url: "/accessories/Purse.glb",
      attach: "shoulderL",
      color: "#9e6b3d",
      accent: "#d4ad35",
      price: 8500,
    },
    {
      id: "acc-bat",
      kind: "prop",
      label: "Baseball bat",
      url: "/accessories/BaseballBat.glb",
      attach: "handR",
      rotation: [0, 0, -0.55],
      color: "#b88547",
      accent: "#1a1a1a",
      price: 1200,
    },
  ],
};

function isAccessoryItem(item) {
  return Boolean(item?.kind && item?.url);
}

function isPaidItem(item) {
  return Number(item?.price) > 0;
}

function freeCatalogItems(category) {
  return (CLOSET_CATALOG[category] || []).filter((item) => !isPaidItem(item));
}

function paidCatalogItems(category) {
  return (CLOSET_CATALOG[category] || []).filter((item) => isPaidItem(item));
}

/** Flat list of purchasable accessory GLBs. */
export const ACCESSORY_ITEMS = Object.values(CLOSET_CATALOG)
  .flat()
  .filter(isAccessoryItem);

ACCESSORY_ITEMS.forEach((item) => {
  if (item.url) useGLTF.preload(item.url);
});

const COLOR_STYLE_CATEGORIES = new Set(["skin", "hair", "shirt", "pants", "shoes", "hairStyle"]);

/** Top-level closet sections with nested categories. */
export const CLOSET_SECTIONS = [
  {
    id: "base",
    label: "Base",
    categories: [
      { id: "skin", label: "Skin" },
      { id: "hairStyle", label: "Hair style" },
      { id: "hair", label: "Hair color" },
    ],
  },
  {
    id: "clothing",
    label: "Clothing",
    categories: [
      { id: "shirt", label: "Tops" },
      { id: "pants", label: "Bottoms" },
      { id: "shoes", label: "Shoes" },
    ],
  },
];

const SETUP_SECTIONS = CLOSET_SECTIONS;

function hairMeshForOutfit(outfit) {
  const id = outfit?.hairStyleId || "hair-block";
  const found = CLOSET_CATALOG.hairStyle.find((h) => h.id === id && !isAccessoryItem(h));
  if (!found) return "Hair_Block";
  // Bald uses mesh: null — do not coalesce that back to a default style.
  return found.mesh;
}

function outfitStorageKey(studentId) {
  return `ledger-lab-outfit-${studentId ?? "guest"}`;
}

export function outfitForStudent(studentId, name) {
  const seed = String(studentId ?? name ?? "guest")
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const shirts = CLOSET_CATALOG.shirt;
  const hairs = CLOSET_CATALOG.hair;
  const skins = freeCatalogItems("skin");
  const styles = freeCatalogItems("hairStyle");
  const skinPick = skins[seed % skins.length];
  const stylePick = styles[seed % (styles.length - 1)]; // skip bald as default seed
  return {
    ...DEFAULT_OUTFIT,
    shirt: shirts[seed % shirts.length].color,
    hair: hairs[seed % hairs.length].color,
    skin: skinPick.color,
    skinId: skinPick.id,
    hairStyleId: stylePick.id,
    shirtId: shirts[seed % shirts.length].id,
    pantsId: "pants-pine",
    shoesId: "shoes-brown",
    hairId: hairs[seed % hairs.length].id,
    ownedLuxuries: [],
    hat: null,
    glasses: null,
    neck: null,
    jersey: null,
    backpack: null,
    bag: null,
    prop: null,
  };
}

export function loadSavedOutfit(studentId, name) {
  const base = outfitForStudent(studentId, name);
  try {
    const raw = localStorage.getItem(outfitStorageKey(studentId));
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return stripUnownedBuyables(
      {
        ...base,
        ...saved,
        ownedLuxuries: Array.isArray(saved.ownedLuxuries) ? saved.ownedLuxuries : [],
      },
      base
    );
  } catch {
    return base;
  }
}

export function saveOutfit(studentId, outfit) {
  try {
    localStorage.setItem(outfitStorageKey(studentId), JSON.stringify(outfit));
  } catch {
    /* ignore quota */
  }
}

function Limb({ args, position, rotation, color, metalness = 0.05, roughness = 0.55 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** Tiny head + hair (and optional hat) for hairstyle picker tiles. */
function HeadHairPreviewModel({ outfit, hairStyleId, hatItem = null }) {
  const headS = 1.0;
  const hairTop = headS / 2;
  const style =
    (CLOSET_CATALOG.hairStyle || []).find((h) => h.id === hairStyleId && !isAccessoryItem(h)) ||
    null;
  const hairMesh = style?.mesh ?? null;
  const hideHair = Boolean(hatItem);

  return (
    <group position={[0, -0.42, 0]} scale={0.88}>
      <Limb args={[headS, headS, headS]} position={[0, 0, 0]} color={outfit.skin} />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[-0.18, 0.08, 0.52]}
        color={outfit.eyes}
        roughness={0.35}
      />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[0.18, 0.08, 0.52]}
        color={outfit.eyes}
        roughness={0.35}
      />
      {!hideHair && hairMesh === "Hair_Block" && (
        <Limb args={[1.05, 0.35, 1.05]} position={[0, hairTop + 0.12, 0]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Tall" && (
        <Limb args={[0.95, 0.72, 0.95]} position={[0, hairTop + 0.32, 0.02]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Poof" && (
        <Limb args={[1.25, 0.42, 1.2]} position={[0, hairTop + 0.15, 0]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Side" && (
        <>
          <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={outfit.hair} />
          <Limb args={[0.7, 0.5, 1.05]} position={[0.28, hairTop + 0.2, 0.02]} color={outfit.hair} />
        </>
      )}
      {!hideHair && hairMesh === "Hair_Buzz" && (
        <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={outfit.hair} />
      )}
      {hatItem && (
        <group position={[0, hairTop + 0.02, 0]}>
          <AccessoryAtOrigin item={hatItem} scale={0.42} />
        </group>
      )}
    </group>
  );
}

function HairStylePreview({ outfit, hairStyleId, hatItem = null, className }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0.05, 2.55], fov: 30, near: 0.1, far: 20 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[2, 3, 2]} intensity={1.05} />
        <Suspense fallback={null}>
          <HeadHairPreviewModel
            outfit={outfit}
            hairStyleId={hairStyleId}
            hatItem={hatItem}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function AccessoryModel({ item }) {
  const { scene } = useGLTF(item.url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [cloned]);

  const position = ATTACH[item.attach] || ATTACH.torso;
  const rotation = item.rotation || [0, 0, 0];
  return <primitive object={cloned} position={position} rotation={rotation} />;
}

function AccessoryAtOrigin({ item, scale = 1 }) {
  const { scene } = useGLTF(item.url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [cloned]);

  return (
    <primitive
      object={cloned}
      scale={scale}
      rotation={item.rotation || [0, 0, 0]}
    />
  );
}

function AccessoryProps({ outfit }) {
  const equipped = ACCESSORY_ITEMS.filter((item) => outfit[item.kind] === item.id);
  if (!equipped.length) return null;
  return (
    <>
      {equipped.map((item) => (
        <AccessoryModel key={item.id} item={item} />
      ))}
    </>
  );
}

function colorForMeshName(name, outfit) {
  const n = String(name || "");
  if (n.startsWith("Torso") || n.startsWith("Shirt")) return outfit.shirt;
  if (n.startsWith("Leg") || n.startsWith("Pants")) return outfit.pants;
  if (n.startsWith("Shoe") || n.startsWith("Shoes")) return outfit.shoes;
  if (n.startsWith("Hair")) return outfit.hair;
  if (n.startsWith("Eye")) return outfit.eyes;
  if (
    n.startsWith("Head") ||
    n.startsWith("Arm") ||
    n.startsWith("Skin")
  ) {
    return outfit.skin;
  }
  return null;
}

function applyOutfitColors(root, outfit) {
  const activeHair = hairMeshForOutfit(outfit);
  const hideHair = Boolean(outfit.hat);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const n = String(obj.name || "");
    if (n.startsWith("Hair_") || n === "Hair") {
      // Side sweep keeps a buzz layer across the scalp.
      const showBuzzUnderSide =
        activeHair === "Hair_Side" && n === "Hair_Buzz";
      obj.visible =
        !hideHair &&
        Boolean(activeHair) &&
        (n === activeHair || showBuzzUnderSide);
    }
    if (!obj.material) return;
    const hex = colorForMeshName(obj.name, outfit);
    if (!hex) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m, i) => {
      if (!m?.color) return;
      if (!m.userData?.ledgerCloned) {
        const cloned = m.clone();
        cloned.userData = { ...cloned.userData, ledgerCloned: true };
        if (Array.isArray(obj.material)) obj.material[i] = cloned;
        else obj.material = cloned;
      }
      const target = Array.isArray(obj.material) ? obj.material[i] : obj.material;
      target.color.set(hex);
    });
  });
}

function findObjectByName(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.name === name) found = obj;
  });
  return found;
}

function BlenderAvatarModel({ outfit, waving, spin = false, still = false }) {
  const group = useRef();
  const armR = useRef();
  const { scene } = useGLTF(BLENDER_CHARACTER_URL);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    applyOutfitColors(cloned, outfit);
    armR.current = findObjectByName(cloned, "Arm_R");
  }, [cloned, outfit]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (group.current) {
      if (still) {
        group.current.rotation.y = 0;
      } else {
        group.current.rotation.y = spin ? t * 0.35 : Math.sin(t * 0.55) * 0.18;
      }
      group.current.position.y = AVATAR_BASE_Y + (still ? 0 : Math.sin(t * 1.4) * 0.02);
    }
    if (armR.current && waving) {
      // Blocky arm pivots around its mesh center
      armR.current.rotation.x = -0.15 + Math.sin(t * 4.2) * 0.55;
    }
  });

  return (
    <group ref={group} position={[0, AVATAR_BASE_Y, 0]} scale={AVATAR_SCALE}>
      <primitive object={cloned} />
      <AccessoryProps outfit={outfit} />
    </group>
  );
}

function ProceduralAvatarModel({ outfit, waving, spin = false, still = false }) {
  const group = useRef();
  const armR = useRef();

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (group.current) {
      if (still) {
        group.current.rotation.y = 0;
      } else {
        group.current.rotation.y = spin
          ? t * 0.35
          : Math.sin(t * 0.55) * 0.18;
      }
      group.current.position.y = AVATAR_BASE_Y + (still ? 0 : Math.sin(t * 1.4) * 0.02);
    }
    if (armR.current && waving) {
      armR.current.rotation.x = -0.15 + Math.sin(t * 4.2) * 0.55;
    }
  });

  // Same R6-ish proportions as blender/make_roblox_character.py (Y-up)
  const legH = 1.5;
  const torsoH = 2.0;
  const headS = 1.0;
  const armH = 1.5;
  const legZ = legH / 2;
  const torsoZ = legH + torsoH / 2;
  const headZ = legH + torsoH + headS / 2;
  const armZ = legH + torsoH / 2;
  const armX = 1.0 + 0.3;
  const hairMesh = hairMeshForOutfit(outfit);
  const hairTop = headZ + headS / 2;
  const hideHair = Boolean(outfit.hat);

  return (
    <group ref={group} position={[0, AVATAR_BASE_Y, 0]} scale={AVATAR_SCALE}>
      <Limb args={[0.6, legH, 0.6]} position={[-0.3, legZ, 0]} color={outfit.pants} />
      <Limb args={[0.6, legH, 0.6]} position={[0.3, legZ, 0]} color={outfit.pants} />
      <Limb args={[0.65, 0.3, 0.75]} position={[-0.3, 0.15, 0.05]} color={outfit.shoes} />
      <Limb args={[0.65, 0.3, 0.75]} position={[0.3, 0.15, 0.05]} color={outfit.shoes} />
      <Limb args={[2.0, torsoH, 1.0]} position={[0, torsoZ, 0]} color={outfit.shirt} />
      <Limb args={[0.6, armH, 0.6]} position={[-armX, armZ, 0]} color={outfit.skin} />
      <group ref={armR} position={[armX, armZ, 0]}>
        <Limb args={[0.6, armH, 0.6]} position={[0, 0, 0]} color={outfit.skin} />
      </group>
      <Limb args={[headS, headS, headS]} position={[0, headZ, 0]} color={outfit.skin} />
      {!hideHair && hairMesh === "Hair_Block" && (
        <Limb args={[1.05, 0.35, 1.05]} position={[0, hairTop + 0.12, 0]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Tall" && (
        <Limb args={[0.95, 0.72, 0.95]} position={[0, hairTop + 0.32, 0.02]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Poof" && (
        <Limb args={[1.25, 0.42, 1.2]} position={[0, hairTop + 0.15, 0]} color={outfit.hair} />
      )}
      {!hideHair && hairMesh === "Hair_Side" && (
        <>
          <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={outfit.hair} />
          <Limb args={[0.7, 0.5, 1.05]} position={[0.28, hairTop + 0.2, 0.02]} color={outfit.hair} />
        </>
      )}
      {!hideHair && hairMesh === "Hair_Buzz" && (
        <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={outfit.hair} />
      )}
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[-0.18, headZ + 0.08, 0.52]}
        color={outfit.eyes}
        roughness={0.35}
      />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[0.18, headZ + 0.08, 0.52]}
        color={outfit.eyes}
        roughness={0.35}
      />
      <AccessoryProps outfit={outfit} />
    </group>
  );
}

function useBlenderCharacterAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(BLENDER_CHARACTER_URL, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setAvailable(res.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

function AvatarModel({ outfit, waving, spin = false, still = false, useBlender }) {
  if (useBlender) {
    return <BlenderAvatarModel outfit={outfit} waving={waving} spin={spin} still={still} />;
  }
  return <ProceduralAvatarModel outfit={outfit} waving={waving} spin={spin} still={still} />;
}

function CameraRig({ mode }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    if (mode === "closet") {
      camera.position.set(0, 0.22, 3.75);
      camera.lookAt(0, 0.05, 0);
    } else if (mode === "dash") {
      camera.position.set(0, 0.55, 5.2);
      camera.lookAt(0, 0.05, 0);
    } else if (mode === "class") {
      camera.position.set(0, 1.05, 6.4);
      camera.lookAt(0, 0.55, 0);
    } else {
      camera.position.set(0, 0.12, 4.05);
      camera.lookAt(0, -0.02, 0);
    }
    camera.updateProjectionMatrix();
  }, [camera, mode]);
  return null;
}

/** Pace left↔right inside a stage. */
function WalkingPad({
  enabled,
  children,
  startX = 0,
  limit = 1.65,
  speed = 0.72,
  phase = 0,
  laneZ = 0,
  bobAmp = 0.05,
}) {
  const ref = useRef();
  const dir = useRef(1);
  const x = useRef(startX);
  const primed = useRef(false);

  useFrame((state, dt) => {
    if (!enabled || !ref.current) return;
    if (!primed.current) {
      // Stagger start so the pack doesn’t sync-walk.
      x.current = startX + Math.sin(phase) * limit * 0.35;
      dir.current = Math.sin(phase * 1.7) >= 0 ? 1 : -1;
      primed.current = true;
    }
    x.current += dir.current * speed * Math.min(dt, 0.05);
    if (x.current > limit) {
      x.current = limit;
      dir.current = -1;
    } else if (x.current < -limit) {
      x.current = -limit;
      dir.current = 1;
    }
    const t = state.clock.getElapsedTime() + phase;
    ref.current.position.x = x.current;
    ref.current.position.y = Math.abs(Math.sin(t * 7.5)) * bobAmp;
    ref.current.position.z = laneZ;
    const targetYaw = dir.current > 0 ? Math.PI * 0.42 : -Math.PI * 0.42;
    ref.current.rotation.y += (targetYaw - ref.current.rotation.y) * Math.min(1, dt * 6);
  });

  return <group ref={ref}>{children}</group>;
}

function ClassWalkScene({ walkers, useBlender }) {
  const n = walkers.length;
  const scale = n > 18 ? 0.72 : n > 12 ? 0.82 : n > 6 ? 0.92 : 1.05;
  const limit = Math.min(5.4, 2.6 + n * 0.12);
  const groundW = Math.max(10, limit * 2.5 + 2.5);
  const laneSpread = n > 10 ? 0.85 : 1.05;

  return (
    <>
      <CameraRig mode="class" />
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[3, 5, 2.5]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2.5, 2.2, -1]} intensity={0.4} color="#9fd4a8" />
      {walkers.map((w, i) => {
        const lane = (i % 3) - 1;
        const startX = ((i + 0.5) / Math.max(n, 1) - 0.5) * limit * 1.7;
        const speed = 0.48 + (i % 5) * 0.08;
        const first =
          String(w.name || "")
            .trim()
            .split(/\s+/)[0] || "Student";
        return (
          <WalkingPad
            key={w.id}
            enabled
            startX={startX}
            limit={limit}
            speed={speed}
            phase={i * 1.83}
            laneZ={lane * laneSpread}
            bobAmp={0.055}
          >
            <group scale={scale}>
              <AvatarModel
                outfit={w.outfit}
                waving={false}
                spin={false}
                still
                useBlender={useBlender}
              />
              <Html
                position={[0, 5.15, 0]}
                center
                distanceFactor={12}
                style={{ pointerEvents: "none" }}
              >
                <span className={w.isYou ? "class-walker-tag is-you" : "class-walker-tag"}>
                  {w.isYou ? "You" : first}
                </span>
              </Html>
            </group>
          </WalkingPad>
        );
      })}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, AVATAR_SHADOW_Y - 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[groundW, 5.2]} />
        <meshStandardMaterial color="#d7ebe0" roughness={0.95} metalness={0} />
      </mesh>
      <ContactShadows
        position={[0, AVATAR_SHADOW_Y, 0]}
        opacity={0.28}
        scale={groundW + 1.5}
        blur={2.8}
        far={3.5}
      />
    </>
  );
}

/** Shared class stage: every student’s avatar pacing the board. */
export function ClassWalkingStage({ walkers = [], className }) {
  const useBlender = useBlenderCharacterAvailable();
  const ready = walkers.length > 0;
  return (
    <div className={className}>
      {ready ? (
        <Canvas
          camera={{ position: [0, 1.05, 6.4], fov: 38, near: 0.1, far: 60 }}
          dpr={[1, 1.6]}
          gl={{ antialias: true, alpha: true }}
        >
          <Suspense fallback={null}>
            <ClassWalkScene walkers={walkers} useBlender={useBlender} />
          </Suspense>
        </Canvas>
      ) : (
        <div className="class-walk-empty">Waiting for classmates…</div>
      )}
    </div>
  );
}

function Scene({ outfit, mode = "thumb", useBlender }) {
  const isDash = mode === "dash";
  const isCloset = mode === "closet";
  const avatar = (
    <AvatarModel
      outfit={outfit}
      waving={!isCloset && !isDash}
      spin={isCloset}
      still={isDash}
      useBlender={useBlender}
    />
  );

  return (
    <>
      <CameraRig mode={mode} />
      <ambientLight intensity={0.75} />
      <directionalLight
        position={[2.5, 4, 2]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2, 2, -1]} intensity={0.35} color="#9fd4a8" />
      {isDash ? (
        <WalkingPad enabled>{avatar}</WalkingPad>
      ) : (
        <Float
          speed={isCloset ? 0.9 : 1.2}
          rotationIntensity={isCloset ? 0.05 : 0.12}
          floatIntensity={isCloset ? 0.12 : 0.18}
        >
          {avatar}
        </Float>
      )}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, AVATAR_SHADOW_Y - 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[isDash ? 5.2 : 2.4, isDash ? 2.2 : 1.6]} />
        <meshStandardMaterial color="#d7ebe0" roughness={0.95} metalness={0} />
      </mesh>
      <ContactShadows
        position={[0, AVATAR_SHADOW_Y, 0]}
        opacity={0.28}
        scale={isDash ? 6.5 : 3.2}
        blur={2.4}
        far={2.5}
      />
    </>
  );
}

function AvatarCanvas({ outfit, mode, className }) {
  const useBlender = useBlenderCharacterAvailable();
  return (
    <div className={className}>
      <Canvas
        camera={{
          position:
            mode === "closet"
              ? [0, 0.18, 3.5]
              : mode === "dash"
                ? [0, 0.55, 5.2]
                : [0, 0.1, 3.85],
          fov: mode === "closet" ? 34 : mode === "dash" ? 38 : 32,
          near: 0.1,
          far: 50,
        }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Scene outfit={outfit} mode={mode} useBlender={useBlender} />
        </Suspense>
      </Canvas>
    </div>
  );
}

const ACCESSORY_SLOTS = ["hat", "glasses", "neck", "jersey", "backpack", "bag", "prop"];

function stripUnownedBuyables(outfit, fallback = null) {
  const owned = new Set(outfit?.ownedLuxuries || []);
  const next = { ...outfit };
  const base = fallback || DEFAULT_OUTFIT;

  for (const slot of ACCESSORY_SLOTS) {
    const id = next[slot];
    if (id && !owned.has(id)) next[slot] = null;
  }

  for (const category of COLOR_STYLE_CATEGORIES) {
    const idKey = category === "hairStyle" ? "hairStyleId" : `${category}Id`;
    const selectedId = next[idKey];
    if (!selectedId) continue;
    const item = (CLOSET_CATALOG[category] || []).find((entry) => entry.id === selectedId);
    if (!item || isAccessoryItem(item) || !isPaidItem(item) || owned.has(item.id)) continue;

    if (category === "hairStyle") {
      next.hairStyleId = base.hairStyleId || "hair-block";
    } else {
      const free = freeCatalogItems(category).find((entry) => entry.id === base[idKey])
        || freeCatalogItems(category)[0];
      if (free) {
        next[category] = free.color;
        next[idKey] = free.id;
      }
    }
  }

  return next;
}

function ClosetShelf({
  category,
  items,
  outfit,
  onSelectItem,
  onSelectLuxury,
  onBuyLuxury,
  cash = 0,
  buyingId = null,
  freeOnly = false,
}) {
  const owned = new Set(outfit.ownedLuxuries || []);
  const freeItems = items.filter((item) => !isPaidItem(item));
  const paidItems = freeOnly ? [] : items.filter((item) => isPaidItem(item));

  function renderFreeItem(item) {
    const selectedId = outfit[`${category}Id`];
    const active = selectedId === item.id || outfit[category] === item.color;
    return (
      <button
        key={item.id}
        type="button"
        className={active ? "closet-item selected" : "closet-item"}
        data-click="confirm"
        onClick={() => onSelectItem(item)}
      >
        <span className="closet-swatch" style={{ background: item.color }} aria-hidden="true" />
        <span className="closet-item-copy">
          <strong>{item.label}</strong>
          <span>Free</span>
        </span>
      </button>
    );
  }

  function renderHairStyleTiles(list) {
    return (
      <div className="closet-hair-grid" role="group" aria-label="Hair styles">
        {list.map((item) => {
          const active = (outfit.hairStyleId || "hair-block") === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={
                active ? "closet-hair-tile selected" : "closet-hair-tile"
              }
              data-click="confirm"
              aria-label={item.label}
              aria-pressed={active}
              title={item.label}
              onClick={() => onSelectItem(item)}
            >
              <HairStylePreview
                outfit={outfit}
                hairStyleId={item.id}
                className="closet-hair-preview"
              />
              <span className="closet-hair-tile-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderColorPalette(ariaLabel) {
    return (
      <div className="closet-color-palette" role="group" aria-label={ariaLabel}>
        {freeItems.map((item) => {
          const active =
            outfit[`${category}Id`] === item.id || outfit[category] === item.color;
          return (
            <button
              key={item.id}
              type="button"
              className={
                active ? "closet-color-swatch selected" : "closet-color-swatch"
              }
              style={{ background: item.color }}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              data-click="confirm"
              onClick={() => onSelectItem(item)}
            />
          );
        })}
      </div>
    );
  }

  function renderPaidItem(item) {
    const isOwned = owned.has(item.id);
    let isEquipped = false;
    if (isAccessoryItem(item)) {
      isEquipped = outfit[item.kind] === item.id;
    } else if (category === "hairStyle") {
      isEquipped = (outfit.hairStyleId || "hair-block") === item.id;
    } else {
      isEquipped = outfit[`${category}Id`] === item.id || outfit[category] === item.color;
    }
    const isTrying = isEquipped && !isOwned;
    const canAfford = Number(cash) + 0.0001 >= item.price;
    let status = `Try on · ${money(item.price)}`;
    if (isOwned && isEquipped) status = "Equipped";
    else if (isOwned) status = "Tap to equip";
    else if (isTrying) status = canAfford ? "Trying on" : "Trying on · save up to buy";

    const swatch = item.accent
      ? `linear-gradient(145deg, ${item.accent}, ${item.color})`
      : item.swatch || item.color;

    return (
      <div
        key={item.id}
        className={[
          "closet-item",
          "closet-item-luxury",
          isEquipped ? "selected" : "",
          isTrying ? "is-trying" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          className="closet-item-main"
          data-click="confirm"
          disabled={buyingId === item.id}
          onClick={() => onSelectLuxury(item)}
        >
          <span
            className="closet-swatch closet-swatch-luxury"
            style={{ background: swatch }}
            aria-hidden="true"
          />
          <span className="closet-item-copy">
            <strong>{item.label}</strong>
            <span>{buyingId === item.id ? "Buying…" : status}</span>
          </span>
        </button>
        {isTrying && (
          <button
            type="button"
            className="closet-buy-btn"
            data-click="confirm"
            disabled={buyingId === item.id || !canAfford}
            onClick={() => onBuyLuxury?.(item)}
          >
            {canAfford ? `Buy · ${money(item.price)}` : `Need ${money(item.price)}`}
          </button>
        )}
      </div>
    );
  }

  const paletteLabels = {
    skin: "Skin tone",
    hair: "Hair color",
    shirt: "Top color",
    pants: "Pants color",
    shoes: "Shoes color",
  };

  return (
    <div className="closet-shelf" role="tabpanel">
      {category === "hairStyle"
        ? renderHairStyleTiles(freeItems)
        : paletteLabels[category]
          ? renderColorPalette(paletteLabels[category])
          : freeItems.map(renderFreeItem)}
      {paidItems.length > 0 && (
        <>
          <p className="closet-shelf-label">Buyables</p>
          {paidItems.map(renderPaidItem)}
        </>
      )}
    </div>
  );
}

function applyCatalogSelection(outfit, category, item) {
  if (category === "hairStyle") {
    return { ...outfit, hairStyleId: item.id };
  }
  return {
    ...outfit,
    [category]: item.color,
    [`${category}Id`]: item.id,
  };
}

function ClosetNav({ sections, sectionId, categoryId, onSection, onCategory }) {
  const section = sections.find((s) => s.id === sectionId) || sections[0];
  return (
    <>
      <div className="closet-tabs closet-section-tabs" role="tablist" aria-label="Closet section">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={sectionId === s.id}
            className={sectionId === s.id ? "closet-tab active" : "closet-tab"}
            data-click="select"
            onClick={() => onSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section.categories.length > 1 && (
        <div className="closet-subtabs" role="tablist" aria-label="Category">
          {section.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={categoryId === c.id}
              className={categoryId === c.id ? "closet-subtab active" : "closet-subtab"}
              data-click="select"
              onClick={() => onCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Inline closet for join/onboarding (not a modal). */
export function AvatarSetupPanel({ outfit, onChangeOutfit, studentName }) {
  const [sectionId, setSectionId] = useState("base");
  const [categoryId, setCategoryId] = useState("skin");
  const section = SETUP_SECTIONS.find((s) => s.id === sectionId) || SETUP_SECTIONS[0];
  const category =
    section.categories.find((c) => c.id === categoryId)?.id || section.categories[0].id;
  const items = freeCatalogItems(category);

  return (
    <div className="avatar-setup">
      <div className="closet-body closet-body-inline">
        <aside className="closet-rail" aria-label="Customization options">
          <ClosetNav
            sections={SETUP_SECTIONS}
            sectionId={section.id}
            categoryId={category}
            onSection={(id) => {
              setSectionId(id);
              const next = SETUP_SECTIONS.find((s) => s.id === id);
              setCategoryId(next?.categories[0]?.id || "skin");
            }}
            onCategory={setCategoryId}
          />
          <ClosetShelf
            category={category}
            items={items}
            outfit={outfit}
            freeOnly
            onSelectItem={(item) =>
              onChangeOutfit(applyCatalogSelection(outfit, category, item))
            }
            onSelectLuxury={() => {}}
          />
        </aside>
        <div className="closet-preview">
          <AvatarCanvas outfit={outfit} mode="closet" className="closet-stage" />
          <p className="closet-hint">
            {studentName ? `${studentName}'s look` : "Pick your look"} — buy extras later with cash
          </p>
        </div>
      </div>
    </div>
  );
}

function ClosetModal({
  open,
  onClose,
  outfit,
  onChangeOutfit,
  studentName,
  studentId,
  cash = 0,
  onCashChange,
}) {
  const [sectionId, setSectionId] = useState("base");
  const [categoryId, setCategoryId] = useState("skin");
  const [buyingId, setBuyingId] = useState(null);
  const [shopNote, setShopNote] = useState("");
  const [shopError, setShopError] = useState("");
  const [draft, setDraft] = useState(outfit);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(outfit);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChangeOutfit);
  onChangeRef.current = onChangeOutfit;

  function persistWithoutTryOns(next) {
    const cleaned = stripUnownedBuyables(next, committedRef.current);
    setDraft(next);
    onChangeOutfit(cleaned);
    committedRef.current = cleaned;
  }

  function commitAndClose() {
    const cleaned = stripUnownedBuyables(draftRef.current, committedRef.current);
    onChangeOutfit(cleaned);
    onClose();
  }

  useEffect(() => {
    if (!open) return undefined;
    const cleaned = stripUnownedBuyables(outfit, outfit);
    committedRef.current = cleaned;
    setDraft(cleaned);
    setShopNote("");
    setShopError("");
    const onKey = (e) => {
      if (e.key === "Escape") {
        onChangeRef.current(stripUnownedBuyables(draftRef.current, committedRef.current));
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // Only re-snapshot when the modal opens — not on every outfit persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const section = CLOSET_SECTIONS.find((s) => s.id === sectionId) || CLOSET_SECTIONS[0];
  const category =
    section.categories.find((c) => c.id === categoryId)?.id || section.categories[0].id;
  const items = CLOSET_CATALOG[category] || [];

  function isItemEquipped(item) {
    if (isAccessoryItem(item)) return draft[item.kind] === item.id;
    if (category === "hairStyle") return (draft.hairStyleId || "hair-block") === item.id;
    return draft[`${category}Id`] === item.id || draft[category] === item.color;
  }

  function unequipPaidItem(item) {
    if (isAccessoryItem(item)) {
      return { ...draft, [item.kind]: null };
    }
    const committed = committedRef.current;
    if (category === "hairStyle") {
      return { ...draft, hairStyleId: committed.hairStyleId || "hair-block" };
    }
    const free =
      freeCatalogItems(category).find((entry) => entry.id === committed[`${category}Id`])
      || freeCatalogItems(category)[0];
    return free
      ? { ...draft, [category]: free.color, [`${category}Id`]: free.id }
      : draft;
  }

  function equipPaidItem(item) {
    if (isAccessoryItem(item)) {
      return { ...draft, [item.kind]: item.id };
    }
    return applyCatalogSelection(draft, category, item);
  }

  function handleTryLuxury(item) {
    const owned = new Set(draft.ownedLuxuries || []);
    setShopError("");
    setShopNote("");

    if (owned.has(item.id)) {
      persistWithoutTryOns(isItemEquipped(item) ? unequipPaidItem(item) : equipPaidItem(item));
      return;
    }

    if (isItemEquipped(item)) {
      setDraft(unequipPaidItem(item));
      return;
    }

    setDraft(equipPaidItem(item));
    const canAfford = Number(cash) + 0.0001 >= item.price;
    setShopNote(
      canAfford
        ? `Trying on ${item.label} — hit Buy to keep it.`
        : `Trying on ${item.label} — need ${money(item.price)} to keep it.`
    );
  }

  async function handleBuyLuxury(item) {
    const owned = new Set(draft.ownedLuxuries || []);
    setShopError("");
    setShopNote("");

    if (owned.has(item.id)) {
      persistWithoutTryOns(equipPaidItem(item));
      return;
    }

    if (!studentId) {
      setShopError("Sign in to a class portfolio to buy extras.");
      return;
    }
    if (Number(cash) < item.price) {
      setShopError(`You need ${money(item.price)} cash for ${item.label}.`);
      return;
    }

    setBuyingId(item.id);
    try {
      const updated = await adjustCash(studentId, -item.price);
      onCashChange?.(updated);
      const next = {
        ...equipPaidItem(item),
        ownedLuxuries: [...(draft.ownedLuxuries || []), item.id],
      };
      setDraft(next);
      onChangeOutfit(next);
      committedRef.current = next;
    } catch (err) {
      setShopError(err.message || "Could not complete purchase");
    } finally {
      setBuyingId(null);
    }
  }

  const paidInCategory = paidCatalogItems(category).length > 0;

  const modal = (
    <div className="closet-overlay" onClick={commitAndClose} role="presentation">
      <div
        className="closet-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Character closet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="closet-modal-head">
          <div>
            <p className="closet-kicker">Closet</p>
            <h3>{studentName || "Your look"}</h3>
          </div>
          <div className="closet-cash-chip" title="Available cash">
            {money(cash)}
          </div>
          <button
            type="button"
            className="closet-close"
            data-click="select"
            onClick={commitAndClose}
            aria-label="Close closet"
          >
            ×
          </button>
        </header>

        <div className="closet-body">
          <aside className="closet-rail" aria-label="Customization options">
            <ClosetNav
              sections={CLOSET_SECTIONS}
              sectionId={section.id}
              categoryId={category}
              onSection={(id) => {
                setSectionId(id);
                const next = CLOSET_SECTIONS.find((s) => s.id === id);
                setCategoryId(next?.categories[0]?.id || "skin");
              }}
              onCategory={setCategoryId}
            />

            <ClosetShelf
              category={category}
              items={items}
              outfit={draft}
              cash={cash}
              buyingId={buyingId}
              onSelectItem={(item) =>
                persistWithoutTryOns(applyCatalogSelection(draft, category, item))
              }
              onSelectLuxury={handleTryLuxury}
              onBuyLuxury={handleBuyLuxury}
            />

            {shopError ? (
              <p className="closet-note closet-note-error">{shopError}</p>
            ) : shopNote ? (
              <p className="closet-note">{shopNote}</p>
            ) : (
              <p className="closet-note">
                {paidInCategory
                  ? "Free options up top. Buyables below — try on free, buy to keep."
                  : category === "hairStyle"
                    ? "Pick a haircut, then fine-tune color under Hair color."
                    : "Free looks save automatically."}
              </p>
            )}
          </aside>

          <div className="closet-preview">
            <AvatarCanvas outfit={draft} mode="closet" className="closet-stage" />
            <p className="closet-hint">Try buyables free — only purchases leave with you</p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function StudentCharacter({
  studentId,
  name,
  cash = 0,
  onCashChange,
  classId = "",
  firestoreStudentId = "",
}) {
  const [open, setOpen] = useState(false);
  const [outfit, setOutfit] = useState(() => loadSavedOutfit(studentId, name));

  useEffect(() => {
    setOutfit(loadSavedOutfit(studentId, name));
  }, [studentId, name]);

  const displayOutfit = useMemo(() => outfit, [outfit]);

  function handleOutfitChange(next) {
    setOutfit(next);
    saveOutfit(studentId, next);
    if (classId && firestoreStudentId) {
      updateClassStudent(classId, firestoreStudentId, { outfit: next }).catch(() => {});
    }
  }

  return (
    <>
      <button
        type="button"
        className="student-character"
        data-click="select"
        aria-label={`Open closet for ${name || "student"}`}
        onClick={() => setOpen(true)}
      >
        <AvatarCanvas outfit={displayOutfit} mode="dash" className="character-stage" />
        <span className="character-hint">Tap to dress</span>
      </button>

      <ClosetModal
        open={open}
        onClose={() => setOpen(false)}
        outfit={displayOutfit}
        onChangeOutfit={handleOutfitChange}
        studentName={name}
        studentId={studentId}
        cash={cash}
        onCashChange={onCashChange}
      />
    </>
  );
}
