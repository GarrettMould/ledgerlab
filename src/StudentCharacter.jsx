import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float, Html, useGLTF } from "@react-three/drei";
import { createPortal } from "react-dom";
import { adjustCash } from "./api";
import { updateClassStudent } from "./classStore";

const BLENDER_CHARACTER_URL = "/models/character.glb?v=hairstyles1";

/** TEMP testing: show the fruit fly body in every avatar panel. Flip to false before ship. */
const FORCE_FRUIT_FLY_AVATAR_FOR_TESTING = false;

const DEFAULT_OUTFIT = {
  skin: "#e0b090",
  hair: "#3b2a1e",
  shirt: "#3f8f68",
  pants: "#1f3d30",
  shoes: "#2a241f",
  eyes: "#1a2e24",
  hairStyleId: "hair-block",
  form: "human",
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
  // Collar front — ahead of the torso box so necklaces aren’t buried in the shirt.
  neck: [0, 3.48, 0.58],
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
    { id: "skin-shadow", label: "Shadow", color: "#3a3140", eyes: "#f5f5f2", price: 2000 },
    {
      id: "skin-fish",
      label: "Fish",
      color: "#f08a2a",
      form: "fish",
      price: 10000,
    },
  ],
  hairStyle: [
    { id: "hair-block", label: "Block", mesh: "Hair_Block", swatch: "#3b2a1e", price: 0 },
    { id: "hair-tall", label: "Tall", mesh: "Hair_Tall", swatch: "#4a3428", price: 0 },
    { id: "hair-poof", label: "Poof", mesh: "Hair_Poof", swatch: "#5c4030", price: 0 },
    { id: "hair-side", label: "Side sweep", mesh: "Hair_Side", swatch: "#2c1810", price: 0 },
    { id: "hair-buzz", label: "Buzz", mesh: "Hair_Buzz", swatch: "#6b4423", price: 0 },
    { id: "hair-bob", label: "Bob", mesh: "Hair_Bob", swatch: "#4a3428", price: 0 },
    { id: "hair-long", label: "Long", mesh: "Hair_Long", swatch: "#3b2a1e", price: 0 },
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
      // Procedural chain-link mesh (not a single-hoop GLB).
      procedural: "goldChain",
      url: "/accessories/GoldChain.glb?v=front2",
      attach: "neck",
      offset: [0, -0.12, 0.12],
      scale: 1,
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
      offset: [0, -0.02, 0.08],
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
  return Boolean(item?.kind && (item?.url || item?.procedural));
}

/** Interlocking gold oval links draped as a necklace (not a single hoop). */
function GoldChainNecklace({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  linkCount = 20,
  radiusX = 0.58,
  radiusY = 0.48,
  depth = 0.38,
  color = "#d4ad35",
  accent = "#f0d078",
}) {
  const links = useMemo(() => {
    const out = [];
    for (let i = 0; i < linkCount; i += 1) {
      const t = i / (linkCount - 1);
      const angle = Math.PI * t;
      const x = Math.cos(angle) * radiusX;
      const y = -Math.sin(angle) * radiusY;
      const z = Math.sin(angle) * depth;
      // Alternate link twist so they read as chain links, not one ring.
      const twist = i % 2 === 0 ? 0 : Math.PI / 2;
      const tangent = angle - Math.PI / 2;
      out.push({ x, y, z, rotX: twist, rotY: 0, rotZ: tangent });
    }
    return out;
  }, [linkCount, radiusX, radiusY, depth]);

  return (
    <group position={position} rotation={rotation} scale={scale} renderOrder={4}>
      {links.map((link, i) => (
        <mesh
          key={i}
          position={[link.x, link.y, link.z]}
          rotation={[link.rotX, link.rotY, link.rotZ]}
          castShadow
          renderOrder={4}
        >
          <torusGeometry args={[0.085, 0.026, 8, 14]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? color : accent}
            metalness={0.92}
            roughness={0.22}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      ))}
    </group>
  );
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
    form: skinPick.form || "human",
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
    return stripPlayerFishForm(
      stripUnownedBuyables(
        {
          ...base,
          ...saved,
          ownedLuxuries: Array.isArray(saved.ownedLuxuries) ? saved.ownedLuxuries : [],
        },
        base
      ),
      base
    );
  } catch {
    return base;
  }
}

export function saveOutfit(studentId, outfit) {
  try {
    localStorage.setItem(
      outfitStorageKey(studentId),
      JSON.stringify(stripPlayerFishForm(outfit))
    );
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

/** Hair meshes that ship inside character.glb (others are procedural-only). */
const GLB_HAIR_MESHES = new Set([
  "Hair_Block",
  "Hair_Tall",
  "Hair_Poof",
  "Hair_Side",
  "Hair_Buzz",
]);

/** Shared blocky hair pieces for closet preview + avatars. */
function HairPieces({ hairMesh, color, hairTop, hideHair = false }) {
  if (hideHair || !hairMesh) return null;
  return (
    <>
      {hairMesh === "Hair_Block" && (
        <Limb args={[1.05, 0.35, 1.05]} position={[0, hairTop + 0.12, 0]} color={color} />
      )}
      {hairMesh === "Hair_Tall" && (
        <Limb args={[0.95, 0.72, 0.95]} position={[0, hairTop + 0.32, 0.02]} color={color} />
      )}
      {hairMesh === "Hair_Poof" && (
        <Limb args={[1.25, 0.42, 1.2]} position={[0, hairTop + 0.15, 0]} color={color} />
      )}
      {hairMesh === "Hair_Side" && (
        <>
          <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={color} />
          <Limb args={[0.7, 0.5, 1.05]} position={[0.28, hairTop + 0.2, 0.02]} color={color} />
        </>
      )}
      {hairMesh === "Hair_Buzz" && (
        <Limb args={[1.02, 0.12, 1.02]} position={[0, hairTop + 0.04, 0]} color={color} />
      )}
      {/* Chin-length bob */}
      {hairMesh === "Hair_Bob" && (
        <>
          <Limb args={[1.12, 0.28, 1.12]} position={[0, hairTop + 0.1, 0]} color={color} />
          <Limb args={[0.38, 0.85, 0.55]} position={[-0.48, hairTop - 0.28, 0.08]} color={color} />
          <Limb args={[0.38, 0.85, 0.55]} position={[0.48, hairTop - 0.28, 0.08]} color={color} />
          <Limb args={[1.05, 0.7, 0.42]} position={[0, hairTop - 0.22, -0.42]} color={color} />
        </>
      )}
      {/* Long straight */}
      {hairMesh === "Hair_Long" && (
        <>
          <Limb args={[1.08, 0.28, 1.08]} position={[0, hairTop + 0.1, 0]} color={color} />
          <Limb args={[0.36, 1.55, 0.48]} position={[-0.52, hairTop - 0.58, 0.02]} color={color} />
          <Limb args={[0.36, 1.55, 0.48]} position={[0.52, hairTop - 0.58, 0.02]} color={color} />
          <Limb args={[0.95, 1.65, 0.4]} position={[0, hairTop - 0.62, -0.48]} color={color} />
          <Limb args={[0.9, 0.22, 0.35]} position={[0, hairTop + 0.02, 0.42]} color={color} />
        </>
      )}
    </>
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
        color={eyesForOutfit(outfit)}
        roughness={0.35}
      />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[0.18, 0.08, 0.52]}
        color={eyesForOutfit(outfit)}
        roughness={0.35}
      />
      <HairPieces
        hairMesh={hairMesh}
        color={outfit.hair}
        hairTop={hairTop}
        hideHair={hideHair}
      />
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

function accessoryPose(item) {
  const base = ATTACH[item.attach] || ATTACH.torso;
  const offset = item.offset || [0, 0, 0];
  return {
    position: [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]],
    rotation: item.rotation || [0, 0, 0],
    scale: item.scale ?? 1,
  };
}

function AccessoryModel({ item }) {
  const pose = accessoryPose(item);

  if (item.procedural === "goldChain") {
    return (
      <GoldChainNecklace
        position={pose.position}
        rotation={pose.rotation}
        scale={pose.scale}
        color={item.color}
        accent={item.accent}
      />
    );
  }

  return <GlbAccessoryModel item={item} pose={pose} />;
}

function GlbAccessoryModel({ item, pose }) {
  const { scene } = useGLTF(item.url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Keep necklaces / scarves drawing in front of the shirt (no z-fight bury).
      if (item.kind === "neck" || item.attach === "neck") {
        obj.renderOrder = 4;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m) return;
          m.polygonOffset = true;
          m.polygonOffsetFactor = -2;
          m.polygonOffsetUnits = -2;
          m.needsUpdate = true;
        });
      }
    });
  }, [cloned, item]);

  return (
    <primitive
      object={cloned}
      position={pose.position}
      rotation={pose.rotation}
      scale={pose.scale}
    />
  );
}

function AccessoryAtOrigin({ item, scale = 1 }) {
  if (item.procedural === "goldChain") {
    return (
      <GoldChainNecklace
        scale={scale * 0.85}
        color={item.color}
        accent={item.accent}
        radiusX={0.5}
        radiusY={0.42}
        depth={0.32}
      />
    );
  }

  return <GlbAccessoryAtOrigin item={item} scale={scale} />;
}

function GlbAccessoryAtOrigin({ item, scale = 1 }) {
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

function eyesForOutfit(outfit) {
  if (outfit?.skinId === "skin-shadow") return "#f5f5f2";
  return outfit?.eyes || DEFAULT_OUTFIT.eyes;
}

function colorForMeshName(name, outfit) {
  const n = String(name || "");
  if (n.startsWith("Torso") || n.startsWith("Shirt")) return outfit.shirt;
  if (n.startsWith("Leg") || n.startsWith("Pants")) return outfit.pants;
  if (n.startsWith("Shoe") || n.startsWith("Shoes")) return outfit.shoes;
  if (n.startsWith("Hair")) return outfit.hair;
  if (n.startsWith("Eye")) return eyesForOutfit(outfit);
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
      <HairPieces
        hairMesh={
          GLB_HAIR_MESHES.has(hairMeshForOutfit(outfit))
            ? null
            : hairMeshForOutfit(outfit)
        }
        color={outfit.hair}
        hairTop={4.5}
        hideHair={Boolean(outfit.hat)}
      />
      <AccessoryProps outfit={outfit} />
    </group>
  );
}

function isNpcFruitFly(outfit) {
  // Only the class standings NPC may render as a fruit fly — never a student.
  return Boolean(outfit?.npcFish);
}

function isFishForm(outfit) {
  return outfit?.form === "fish" || outfit?.skinId === "skin-fish";
}

/** NPC-only forms that students must never keep from old saves. */
const NPC_ONLY_FORM_IDS = new Set(["fruitfly", "skin-fruitfly"]);

/** Strip any player NPC form leftover from old saves / Firestore. */
export function stripPlayerFishForm(outfit, fallback = DEFAULT_OUTFIT) {
  if (!outfit || outfit.npcFish) return outfit;
  if (!NPC_ONLY_FORM_IDS.has(outfit.form) && !NPC_ONLY_FORM_IDS.has(outfit.skinId)) {
    return outfit;
  }
  const free =
    freeCatalogItems("skin").find((entry) => entry.id === fallback?.skinId) ||
    freeCatalogItems("skin")[0];
  return {
    ...outfit,
    npcFish: false,
    form: "human",
    skinId: free?.id || "skin-light",
    skin: free?.color || fallback?.skin || "#e0b090",
  };
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
      <HairPieces
        hairMesh={hairMesh}
        color={outfit.hair}
        hairTop={hairTop}
        hideHair={hideHair}
      />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[-0.18, headZ + 0.08, 0.52]}
        color={eyesForOutfit(outfit)}
        roughness={0.35}
      />
      <Limb
        args={[0.12, 0.12, 0.05]}
        position={[0.18, headZ + 0.08, 0.52]}
        color={eyesForOutfit(outfit)}
        roughness={0.35}
      />
      <AccessoryProps outfit={outfit} />
    </group>
  );
}

/** Upright bipedal fish — tall pill body like a cartoon incidental fish. */
function FishAvatarModel({ outfit, waving, spin = false, still = false }) {
  const group = useRef();
  const armR = useRef();
  const legL = useRef();
  const legR = useRef();
  const body = outfit.skin || "#f08a2a";
  const fin = "#e6c57a";
  const finEdge = "#d4b05f";
  const shirt = outfit.shirt || "#7ec8e8";
  const beak = "#f0d78a";
  const eyeWhite = "#f7f7f2";
  const pupil = eyesForOutfit(outfit);

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
    // Fin-leg walk cycle when pacing (dash / class standings).
    if (still) {
      const swing = Math.sin(t * 7.5) * 0.45;
      if (legL.current) legL.current.rotation.x = swing;
      if (legR.current) legR.current.rotation.x = -swing;
    } else if (legL.current && legR.current) {
      legL.current.rotation.x = 0.12;
      legR.current.rotation.x = -0.08;
    }
    if (armR.current && waving) {
      armR.current.rotation.x = -0.15 + Math.sin(t * 4.2) * 0.55;
      armR.current.rotation.z = Math.sin(t * 4.2) * 0.25;
    }
  });

  // Match human avatar height (~4.5 units before AVATAR_SCALE).
  const bodyH = 3.15;
  const bodyR = 0.78;
  const bodyY = 1.35 + bodyH / 2;
  const shirtY = bodyY - 0.15;
  const armY = shirtY + 0.15;
  const eyeY = bodyY + bodyH / 2 - 0.15;
  const legTop = 1.35;

  return (
    <group ref={group} position={[0, AVATAR_BASE_Y, 0]} scale={AVATAR_SCALE}>
      {/* Jointed beige fin-legs */}
      <group ref={legL} position={[-0.38, legTop, 0]}>
        <mesh position={[0, -0.42, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.55, 6, 10]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -1.0, 0.02]} castShadow>
          <capsuleGeometry args={[0.11, 0.48, 6, 10]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -1.38, 0.16]} rotation={[0.55, 0, 0]} castShadow>
          <boxGeometry args={[0.28, 0.08, 0.48]} />
          <meshStandardMaterial color={finEdge} roughness={0.6} metalness={0.04} />
        </mesh>
      </group>
      <group ref={legR} position={[0.38, legTop, 0]}>
        <mesh position={[0, -0.42, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.55, 6, 10]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -1.0, 0.02]} castShadow>
          <capsuleGeometry args={[0.11, 0.48, 6, 10]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -1.38, 0.16]} rotation={[0.55, 0, 0]} castShadow>
          <boxGeometry args={[0.28, 0.08, 0.48]} />
          <meshStandardMaterial color={finEdge} roughness={0.6} metalness={0.04} />
        </mesh>
      </group>

      {/* Continuous pill body (head + torso, no neck) */}
      <mesh position={[0, bodyY, 0]} castShadow>
        <capsuleGeometry args={[bodyR, bodyH - bodyR * 2, 10, 20]} />
        <meshStandardMaterial color={body} roughness={0.48} metalness={0.06} />
      </mesh>

      {/* Light blue tee band across midsection */}
      <mesh position={[0, shirtY, 0]} castShadow>
        <cylinderGeometry args={[bodyR + 0.04, bodyR + 0.04, 1.05, 24]} />
        <meshStandardMaterial color={shirt} roughness={0.72} metalness={0.02} />
      </mesh>
      <mesh position={[-bodyR - 0.12, armY + 0.1, 0]} rotation={[0, 0, 0.55]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.45, 12]} />
        <meshStandardMaterial color={shirt} roughness={0.72} metalness={0.02} />
      </mesh>
      <mesh position={[bodyR + 0.12, armY + 0.1, 0]} rotation={[0, 0, -0.55]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.45, 12]} />
        <meshStandardMaterial color={shirt} roughness={0.72} metalness={0.02} />
      </mesh>

      {/* Dorsal fin down the back */}
      <mesh position={[0, bodyY + 0.55, -bodyR + 0.05]} rotation={[0.15, 0, 0]} castShadow>
        <coneGeometry args={[0.28, 1.55, 3]} />
        <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
      </mesh>
      <mesh position={[0, bodyY + 1.15, -bodyR + 0.12]} rotation={[0.35, 0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.55, 0.35]} />
        <meshStandardMaterial color={finEdge} roughness={0.55} metalness={0.04} />
      </mesh>

      {/* Fin arms from sleeves */}
      <group position={[-bodyR - 0.35, armY - 0.15, 0.05]} rotation={[0.2, 0, 0.35]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.1, 0.55, 6, 8]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -0.45, 0.05]} rotation={[0.4, 0, 0.2]} castShadow>
          <boxGeometry args={[0.22, 0.08, 0.38]} />
          <meshStandardMaterial color={finEdge} roughness={0.55} metalness={0.04} />
        </mesh>
      </group>
      <group ref={armR} position={[bodyR + 0.35, armY - 0.15, 0.05]} rotation={[0.2, 0, -0.35]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.1, 0.55, 6, 8]} />
          <meshStandardMaterial color={fin} roughness={0.55} metalness={0.04} />
        </mesh>
        <mesh position={[0, -0.45, 0.05]} rotation={[0.4, 0, -0.2]} castShadow>
          <boxGeometry args={[0.22, 0.08, 0.38]} />
          <meshStandardMaterial color={finEdge} roughness={0.55} metalness={0.04} />
        </mesh>
      </group>

      {/* Big top-of-head eyes */}
      <mesh position={[-0.32, eyeY, bodyR * 0.55]} castShadow>
        <sphereGeometry args={[0.32, 16, 14]} />
        <meshStandardMaterial color={eyeWhite} roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh position={[0.32, eyeY, bodyR * 0.55]} castShadow>
        <sphereGeometry args={[0.32, 16, 14]} />
        <meshStandardMaterial color={eyeWhite} roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh position={[-0.32, eyeY + 0.02, bodyR * 0.55 + 0.22]}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshStandardMaterial color={pupil} roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh position={[0.32, eyeY + 0.02, bodyR * 0.55 + 0.22]}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshStandardMaterial color={pupil} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Beak / downturned snout */}
      <mesh position={[0, bodyY + 0.55, bodyR * 0.85]} rotation={[0.35, 0, 0]} castShadow>
        <coneGeometry args={[0.28, 0.55, 10]} />
        <meshStandardMaterial color={beak} roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh position={[0, bodyY + 0.42, bodyR * 0.95]} rotation={[1.1, 0, 0]}>
        <boxGeometry args={[0.42, 0.06, 0.12]} />
        <meshStandardMaterial color="#2a2418" roughness={0.7} metalness={0.02} />
      </mesh>
    </group>
  );
}

/** Upright bipedal fruit fly — same blocky classroom style as classmates. */
function FruitFlyAvatarModel({ outfit, waving, spin = false, still = false }) {
  const group = useRef();
  const armR = useRef();
  const legL = useRef();
  const legR = useRef();
  const wingL = useRef();
  const wingR = useRef();
  const body = outfit.skin || "#5c4030";
  const bodyDark = "#3d2a1f";
  const eyeRed = "#c62828";
  const eyeDark = "#6b1010";
  const wing = "#e8f0e8";

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
    if (still) {
      const swing = Math.sin(t * 7.5) * 0.45;
      if (legL.current) legL.current.rotation.x = swing;
      if (legR.current) legR.current.rotation.x = -swing;
    } else if (legL.current && legR.current) {
      legL.current.rotation.x = 0.12;
      legR.current.rotation.x = -0.08;
    }
    if (armR.current && waving) {
      armR.current.rotation.x = -0.15 + Math.sin(t * 4.2) * 0.55;
      armR.current.rotation.z = Math.sin(t * 4.2) * 0.25;
    }
    const flap = Math.sin(t * 18) * 0.2;
    if (wingL.current) {
      wingL.current.rotation.x = 0.2 + flap;
      wingL.current.rotation.z = 0.28;
    }
    if (wingR.current) {
      wingR.current.rotation.x = 0.2 + flap;
      wingR.current.rotation.z = -0.28;
    }
  });

  const thoraxY = 2.35;
  // Head sits on the thorax (overlap + short neck) so it isn’t floating.
  const headY = 3.28;
  const abdomenY = 1.55;
  const armY = 2.55;
  const armX = 0.95;
  const legTop = 1.35;

  return (
    <group ref={group} position={[0, AVATAR_BASE_Y, 0]} scale={AVATAR_SCALE}>
      {/* Stick legs */}
      <group ref={legL} position={[-0.32, legTop, 0]}>
        <mesh position={[0, -0.4, 0]} castShadow>
          <capsuleGeometry args={[0.07, 0.55, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -0.95, 0.02]} castShadow>
          <capsuleGeometry args={[0.06, 0.45, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -1.28, 0.12]} rotation={[0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.2, 0.07, 0.32]} />
          <meshStandardMaterial color={bodyDark} roughness={0.75} metalness={0.04} />
        </mesh>
      </group>
      <group ref={legR} position={[0.32, legTop, 0]}>
        <mesh position={[0, -0.4, 0]} castShadow>
          <capsuleGeometry args={[0.07, 0.55, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -0.95, 0.02]} castShadow>
          <capsuleGeometry args={[0.06, 0.45, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -1.28, 0.12]} rotation={[0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.2, 0.07, 0.32]} />
          <meshStandardMaterial color={bodyDark} roughness={0.75} metalness={0.04} />
        </mesh>
      </group>

      {/* Abdomen */}
      <mesh position={[0, abdomenY, -0.05]} scale={[1, 1.15, 1.05]} castShadow>
        <sphereGeometry args={[0.55, 16, 14]} />
        <meshStandardMaterial color={body} roughness={0.55} metalness={0.06} />
      </mesh>
      <mesh position={[0, abdomenY + 0.05, -0.05]} scale={[1.02, 0.15, 1.02]}>
        <sphereGeometry args={[0.56, 12, 10]} />
        <meshStandardMaterial color={bodyDark} roughness={0.6} metalness={0.05} />
      </mesh>

      {/* Thorax */}
      <mesh position={[0, thoraxY, 0]} castShadow>
        <sphereGeometry args={[0.62, 16, 14]} />
        <meshStandardMaterial color={body} roughness={0.5} metalness={0.06} />
      </mesh>

      {/* Short neck joining thorax → head */}
      <mesh position={[0, thoraxY + 0.55, 0.06]} castShadow>
        <capsuleGeometry args={[0.28, 0.22, 6, 10]} />
        <meshStandardMaterial color={body} roughness={0.5} metalness={0.06} />
      </mesh>

      {/* Wings — rooted on the back of the thorax, extending out/back */}
      <group ref={wingL} position={[-0.38, thoraxY + 0.18, -0.52]}>
        <mesh
          position={[-0.55, 0.28, -0.22]}
          rotation={[0.15, 0.45, 0.55]}
          scale={[1.35, 0.08, 0.72]}
          castShadow
        >
          <sphereGeometry args={[0.5, 12, 10]} />
          <meshStandardMaterial
            color={wing}
            transparent
            opacity={0.42}
            roughness={0.18}
            metalness={0.05}
            depthWrite={false}
          />
        </mesh>
      </group>
      <group ref={wingR} position={[0.38, thoraxY + 0.18, -0.52]}>
        <mesh
          position={[0.55, 0.28, -0.22]}
          rotation={[0.15, -0.45, -0.55]}
          scale={[1.35, 0.08, 0.72]}
          castShadow
        >
          <sphereGeometry args={[0.5, 12, 10]} />
          <meshStandardMaterial
            color={wing}
            transparent
            opacity={0.42}
            roughness={0.18}
            metalness={0.05}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* Stick arms */}
      <group position={[-armX, armY, 0]} rotation={[0.15, 0, 0.4]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.07, 0.7, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -0.55, 0.05]} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.22]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
      </group>
      <group ref={armR} position={[armX, armY, 0]} rotation={[0.15, 0, -0.4]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.07, 0.7, 4, 8]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
        <mesh position={[0, -0.55, 0.05]} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.22]} />
          <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
        </mesh>
      </group>

      {/* Head + huge red compound eyes */}
      <mesh position={[0, headY, 0.08]} castShadow>
        <sphereGeometry args={[0.72, 18, 16]} />
        <meshStandardMaterial color={body} roughness={0.48} metalness={0.06} />
      </mesh>
      <mesh position={[-0.42, headY + 0.08, 0.45]} castShadow>
        <sphereGeometry args={[0.42, 16, 14]} />
        <meshStandardMaterial color={eyeRed} roughness={0.35} metalness={0.15} />
      </mesh>
      <mesh position={[0.42, headY + 0.08, 0.45]} castShadow>
        <sphereGeometry args={[0.42, 16, 14]} />
        <meshStandardMaterial color={eyeRed} roughness={0.35} metalness={0.15} />
      </mesh>
      <mesh position={[-0.42, headY + 0.1, 0.72]}>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color={eyeDark} roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh position={[0.42, headY + 0.1, 0.72]}>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color={eyeDark} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Antennae */}
      <mesh position={[-0.22, headY + 0.75, 0.15]} rotation={[0.35, 0, -0.35]} castShadow>
        <capsuleGeometry args={[0.035, 0.55, 4, 6]} />
        <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
      </mesh>
      <mesh position={[0.22, headY + 0.75, 0.15]} rotation={[0.35, 0, 0.35]} castShadow>
        <capsuleGeometry args={[0.035, 0.55, 4, 6]} />
        <meshStandardMaterial color={bodyDark} roughness={0.7} metalness={0.05} />
      </mesh>
      <mesh position={[-0.42, headY + 1.05, 0.35]} castShadow>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color={bodyDark} roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh position={[0.42, headY + 1.05, 0.35]} castShadow>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color={bodyDark} roughness={0.65} metalness={0.05} />
      </mesh>
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
  if (FORCE_FRUIT_FLY_AVATAR_FOR_TESTING || isNpcFruitFly(outfit)) {
    return (
      <FruitFlyAvatarModel
        outfit={
          FORCE_FRUIT_FLY_AVATAR_FOR_TESTING
            ? { ...CLASS_FISH_OUTFIT, ...outfit, npcFish: true }
            : outfit
        }
        waving={waving}
        spin={spin}
        still={still}
      />
    );
  }
  if (isFishForm(outfit)) {
    return (
      <FishAvatarModel
        outfit={outfit}
        waving={waving}
        spin={spin}
        still={still}
      />
    );
  }
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
    } else if (mode === "headshot") {
      // Frame face/shoulders only — head sits ~0.7–0.95 world Y after scale.
      camera.position.set(0, 0.82, 1.55);
      camera.lookAt(0, 0.78, 0);
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

/** Wooden stool + glass fishbowl prop for the home dashboard stage. */
function FishbowlOnStool({ position = [1.52, AVATAR_SHADOW_Y, -0.42] }) {
  const fishRef = useRef();
  const wood = "#9a6234";
  const woodDark = "#6b4124";
  const seatY = 0.92;
  const bowlY = seatY + 0.3;

  useFrame((state) => {
    if (!fishRef.current) return;
    const t = state.clock.getElapsedTime();
    const r = 0.1;
    fishRef.current.position.x = Math.cos(t * 1.35) * r;
    fishRef.current.position.z = Math.sin(t * 1.35) * r * 0.85;
    fishRef.current.position.y = Math.sin(t * 2.1) * 0.018;
    fishRef.current.rotation.y = -t * 1.35 + Math.PI / 2;
  });

  const leg = (x, z) => (
    <mesh key={`${x}-${z}`} position={[x, seatY / 2, z]} castShadow>
      <cylinderGeometry args={[0.032, 0.04, seatY, 8]} />
      <meshStandardMaterial color={woodDark} roughness={0.88} metalness={0.02} />
    </mesh>
  );

  return (
    <group position={position}>
      {/* Stool legs + seat */}
      {leg(-0.15, -0.15)}
      {leg(0.15, -0.15)}
      {leg(-0.15, 0.15)}
      {leg(0.15, 0.15)}
      <mesh position={[0, seatY, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.25, 0.05, 20]} />
        <meshStandardMaterial color={wood} roughness={0.82} metalness={0.04} />
      </mesh>
      <mesh position={[0, seatY - 0.12, 0]}>
        <torusGeometry args={[0.16, 0.022, 8, 20]} />
        <meshStandardMaterial color={woodDark} roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh position={[0, seatY * 0.45, 0]}>
        <torusGeometry args={[0.14, 0.02, 8, 20]} />
        <meshStandardMaterial color={woodDark} roughness={0.9} metalness={0.02} />
      </mesh>

      {/* Fishbowl */}
      <group position={[0, bowlY, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.26, 28, 20]} />
          <meshStandardMaterial
            color="#d8eef5"
            transparent
            opacity={0.28}
            roughness={0.08}
            metalness={0.15}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, -0.03, 0]} scale={[0.92, 0.72, 0.92]}>
          <sphereGeometry args={[0.235, 24, 16]} />
          <meshStandardMaterial
            color="#4db8c9"
            transparent
            opacity={0.42}
            roughness={0.35}
            metalness={0.05}
            depthWrite={false}
          />
        </mesh>
        {/* Rim */}
        <mesh position={[0, 0.21, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.15, 0.016, 8, 24]} />
          <meshStandardMaterial color="#c5d9e0" roughness={0.25} metalness={0.2} />
        </mesh>
        {/* Fish */}
        <group ref={fishRef}>
          <mesh castShadow>
            <sphereGeometry args={[0.048, 12, 10]} />
            <meshStandardMaterial color="#f08a2a" roughness={0.45} metalness={0.1} />
          </mesh>
          <mesh position={[-0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.028, 0.05, 8]} />
            <meshStandardMaterial color="#e07820" roughness={0.5} metalness={0.08} />
          </mesh>
        </group>
      </group>
    </group>
  );
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
        const label = w.isYou
          ? "You"
          : String(w.name || "")
              .trim() || "Student";
        // Html is outside AvatarModel’s AVATAR_SCALE group — use world-ish head height.
        const tagY = AVATAR_BASE_Y + 4.55 * AVATAR_SCALE + 0.22;
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
                position={[0, tagY, 0]}
                center
                distanceFactor={12}
                zIndexRange={[100, 60]}
                style={{ pointerEvents: "none" }}
              >
                <span
                  className={w.isYou ? "class-walker-tag is-you" : "class-walker-tag"}
                  title={label}
                >
                  {label}
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

/** Shared class NPC: upright fruit fly on every standings walk stage. */
export const CLASS_FISH_OUTFIT = {
  ...DEFAULT_OUTFIT,
  npcFish: true,
  form: "fruitfly",
  skin: "#5c4030",
  skinId: "skin-fruitfly",
  shirt: "#7ec8e8",
  shirtId: "tee-sky",
  pants: "#3d2a1f",
  shoes: "#3d2a1f",
  eyes: "#c62828",
};

export function classFishWalker() {
  return {
    id: "__class-fruit-fly__",
    name: "Fruit fly",
    isYou: false,
    outfit: CLASS_FISH_OUTFIT,
  };
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
  const isHeadshot = mode === "headshot";
  const avatar = (
    <AvatarModel
      outfit={outfit}
      waving={!isCloset && !isDash && !isHeadshot}
      spin={isCloset}
      still={isDash || isHeadshot}
      useBlender={useBlender}
    />
  );

  return (
    <>
      <CameraRig mode={mode} />
      <ambientLight intensity={isHeadshot ? 0.85 : 0.75} />
      <directionalLight
        position={[2.5, 4, 2]}
        intensity={1.15}
        castShadow={!isHeadshot}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2, 2, -1]} intensity={0.35} color="#9fd4a8" />
      {isHeadshot ? (
        avatar
      ) : isDash ? (
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
      {isDash && <FishbowlOnStool />}
      {!isHeadshot && (
        <>
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
      )}
    </>
  );
}

export function AvatarCanvas({ outfit, mode, className }) {
  const useBlender = useBlenderCharacterAvailable();
  const isHeadshot = mode === "headshot";
  return (
    <div className={className}>
      <Canvas
        camera={{
          position:
            mode === "closet"
              ? [0, 0.18, 3.5]
              : mode === "dash"
                ? [0, 0.55, 5.2]
                : isHeadshot
                  ? [0, 0.82, 1.55]
                  : [0, 0.1, 3.85],
          fov: mode === "closet" ? 34 : mode === "dash" ? 38 : isHeadshot ? 28 : 32,
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
  const base = fallback || DEFAULT_OUTFIT;
  const next = stripPlayerFishForm({ ...outfit }, base);

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
        if (category === "skin") {
          next.form = free.form || "human";
          next.eyes = free.eyes || DEFAULT_OUTFIT.eyes;
        }
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

  function renderColorPalette(ariaLabel, paletteItems = freeItems) {
    return (
      <div className="closet-color-palette" role="group" aria-label={ariaLabel}>
        {paletteItems.map((item) => {
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

  const toneItems = freeItems.filter((item) => !item.form);
  const formItems = freeItems.filter((item) => item.form);

  return (
    <div className="closet-shelf" role="tabpanel">
      {category === "hairStyle" ? (
        renderHairStyleTiles(freeItems)
      ) : paletteLabels[category] ? (
        <>
          {renderColorPalette(paletteLabels[category], toneItems)}
          {formItems.length > 0 && (
            <>
              <p className="closet-shelf-label">Characters</p>
              {formItems.map(renderFreeItem)}
            </>
          )}
        </>
      ) : (
        freeItems.map(renderFreeItem)
      )}
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
  // Fruit fly is NPC-only — never apply as a player form from the closet.
  if (
    category === "skin" &&
    (NPC_ONLY_FORM_IDS.has(item?.form) || NPC_ONLY_FORM_IDS.has(item?.id))
  ) {
    return outfit;
  }
  const next = {
    ...outfit,
    [category]: item.color,
    [`${category}Id`]: item.id,
  };
  if (category === "skin") {
    next.form =
      item.form && !NPC_ONLY_FORM_IDS.has(item.form) ? item.form : "human";
    next.npcFish = false;
    next.eyes = item.eyes || DEFAULT_OUTFIT.eyes;
  }
  return next;
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
      ? {
          ...draft,
          [category]: free.color,
          [`${category}Id`]: free.id,
          ...(category === "skin"
            ? {
                form: free.form || "human",
                npcFish: false,
                eyes: free.eyes || DEFAULT_OUTFIT.eyes,
              }
            : {}),
        }
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
    const cleaned = stripPlayerFishForm(next);
    setOutfit(cleaned);
    saveOutfit(studentId, cleaned);
    if (classId && firestoreStudentId) {
      updateClassStudent(classId, firestoreStudentId, { outfit: cleaned }).catch(() => {});
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
