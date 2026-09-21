import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Billboard, Float, Html, useGLTF } from "@react-three/drei";
import { DoubleSide, SRGBColorSpace, TextureLoader } from "three";
import { useLoader } from "@react-three/fiber";
import { createPortal } from "react-dom";
import {
  adjustCash,
  buyClosetItem,
  getClosetAiStatus,
  pollClosetAiJob,
  publishClosetAiJob,
  activateClosetAiJob,
  startClosetAiDraft,
  redoClosetAiDraft,
  inviteCrewPartner,
} from "./api";
import {
  getClassStudent,
  listClassStudents,
  markClosetAiScenarioAnswered,
  resetClosetAiAnsweredScenarios,
  subscribeClassClosetItems,
  updateClassStudent,
} from "./classStore";

/** Catches failed remote GLB loads (CORS / 404) so the closet modal doesn't white-screen. */
class AccessoryLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, failedUrl: null };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    /* swallow — missing accessory should not crash the closet */
  }

  componentDidUpdate(prevProps) {
    const url = this.props.url;
    if (url && url !== prevProps.url && this.state.failed) {
      this.setState({ failed: false, failedUrl: null });
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

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
  // Palm of right hand — AI props still need an outward offset (see below).
  handR: [1.35, 1.85, 0.2],
};

/**
 * Extra weld offsets so AI / catalog-like props aren’t buried in the limb.
 * handR: push out of the arm (+X) and slightly forward (+Z).
 */
const ATTACH_AI_OFFSET = {
  handR: [0.62, 0.12, 0.42],
  torsoBack: [0, 0.05, -0.2],
  shoulderL: [-0.2, -0.15, 0.25],
  neck: [0, -0.06, 0.1],
  eyes: [0, 0, 0.12],
  headTop: [0, 0.08, 0],
  torso: [0, 0, 0.15],
};

useGLTF.preload(BLENDER_CHARACTER_URL);

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Free starter closet + paid extras. Clothing shelves are colors only; buyables live in accessories. */
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
  ],
  /** All buyable gear + student AI class creations. */
  accessories: [
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
      keepHair: true,
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
  return Boolean(
    item?.kind &&
      (item?.url ||
        item?.procedural ||
        (Array.isArray(item?.parts) && item.parts.length > 0))
  );
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

/** Flat list of purchasable accessory GLBs (built-in only). */
export const ACCESSORY_ITEMS = Object.values(CLOSET_CATALOG)
  .flat()
  .filter(isAccessoryItem);

/** Class-published AI accessories — updated by subscribeClassClosetItems. */
let _classAccessoryItems = [];
const _classAccessoryListeners = new Set();

export function setClassClosetAccessories(items) {
  _classAccessoryItems = (items || []).filter(isAccessoryItem);
  _classAccessoryItems.forEach((item) => {
    // Same-origin built-ins only — remote Storage URLs can fail CORS and
    // poison useGLTF's cache before the student even clicks the item.
    if (item.url && item.url.startsWith("/")) {
      try {
        useGLTF.preload(item.url);
      } catch {
        /* ignore bad urls */
      }
    }
  });
  _classAccessoryListeners.forEach((fn) => fn(_classAccessoryItems));
}

export function getClassClosetAccessories() {
  return _classAccessoryItems;
}

function useClassClosetAccessories() {
  const [extra, setExtra] = useState(_classAccessoryItems);
  useEffect(() => {
    _classAccessoryListeners.add(setExtra);
    setExtra(_classAccessoryItems);
    return () => _classAccessoryListeners.delete(setExtra);
  }, []);
  return extra;
}

export function allAccessoryItems() {
  return [...ACCESSORY_ITEMS, ..._classAccessoryItems];
}

const KIND_TO_CATEGORY = {
  hat: "accessories",
  glasses: "accessories",
  jersey: "accessories",
  backpack: "accessories",
  neck: "accessories",
  bag: "accessories",
  prop: "accessories",
};

/** Merge built-in catalog with class AI items for closet shelves. */
export function catalogWithClassItems(classItems = []) {
  const merged = Object.fromEntries(
    Object.entries(CLOSET_CATALOG).map(([key, rows]) => [key, [...rows]])
  );
  if (!merged.accessories) merged.accessories = [];
  // Class creations first so Extras opens on student products, not catalog filler.
  const classRows = [];
  for (const item of classItems) {
    if (!isAccessoryItem(item)) continue;
    if (merged.accessories.some((row) => row.id === item.id)) continue;
    if (classRows.some((row) => row.id === item.id)) continue;
    classRows.push(item);
  }
  merged.accessories = [...classRows, ...merged.accessories];
  return merged;
}

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
  {
    id: "extras",
    label: "Extras",
    categories: [{ id: "accessories", label: "Accessories" }],
  },
];

const SETUP_SECTIONS = CLOSET_SECTIONS.filter((s) => s.id !== "extras");

function hairMeshForOutfit(outfit) {
  const id = outfit?.hairStyleId || "hair-block";
  const found = CLOSET_CATALOG.hairStyle.find((h) => h.id === id && !isAccessoryItem(h));
  if (!found) return "Hair_Block";
  // Bald uses mesh: null — do not coalesce that back to a default style.
  return found.mesh;
}

/** Hats like tophat/helmet hide hair; headphones / keepHair items do not. */
function hatHidesHair(outfit) {
  const hatId = outfit?.hat;
  if (!hatId) return false;
  const item = allAccessoryItems().find((entry) => entry.id === hatId);
  if (item?.keepHair) return false;
  const label = String(item?.label || "").toLowerCase();
  if (label.includes("headphone") || label.includes("earbud") || label.includes("earphone")) {
    return false;
  }
  return true;
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
  const hideHair = Boolean(hatItem) && !hatItem?.keepHair && !String(hatItem?.label || "").toLowerCase().includes("headphone");

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
  const attach = item.attach || "torso";
  const base = ATTACH[attach] || ATTACH.torso;
  const explicit = item.offset;
  const aiNudge =
    item.aiCreated && !item.aiSprite
      ? ATTACH_AI_OFFSET[attach] || [0, 0, 0]
      : [0, 0, 0];
  const offset = Array.isArray(explicit) ? explicit : aiNudge;
  // Blocky AI props are authored ~1 unit tall; catalog default 0.55 left them tiny.
  const scale =
    item.aiCreated && !item.aiSprite
      ? Math.max(Number(item.scale) || 1, 1)
      : item.scale ?? 1;
  // Handheld props: slight tip outward like the catalog baseball bat.
  const rotation =
    item.rotation ||
    (item.aiCreated && attach === "handR" ? [0, 0, -0.45] : [0, 0, 0]);
  return {
    position: [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]],
    rotation,
    scale,
  };
}

function degToRad(d) {
  return ((Number(d) || 0) * Math.PI) / 180;
}

/** Parts recipes store degrees; older jobs may have radians — accept both. */
function partRotationRad(rot) {
  if (!Array.isArray(rot) || rot.length < 3) return [0, 0, 0];
  const vals = [0, 1, 2].map((i) => Number(rot[i]) || 0);
  const maxAbs = Math.max(...vals.map((v) => Math.abs(v)));
  if (maxAbs > Math.PI + 0.05) {
    return vals.map(degToRad);
  }
  return vals;
}

/** Runtime Roblox-style mesh from AI parts recipe (same language as Blender accessories). */
function BlockyPartsModel({ parts, pose }) {
  const safe = Array.isArray(parts) ? parts.slice(0, 24) : [];
  if (!safe.length) return null;
  return (
    <group
      position={pose.position}
      rotation={pose.rotation}
      scale={pose.scale}
    >
      {safe.map((part, i) => {
        const color = part.color || "#888888";
        const pos = Array.isArray(part.pos) ? part.pos : [0, 0, 0];
        const rot = partRotationRad(part.rot);
        const key = `${part.shape || "box"}-${i}`;
        if (part.shape === "cylinder") {
          const r = Math.max(0.03, Number(part.radius) || 0.2);
          const h = Math.max(0.05, Number(part.height) || 0.4);
          const r2 = part.radius2 != null ? Math.max(0.03, Number(part.radius2)) : r;
          return (
            <mesh key={key} position={pos} rotation={rot} castShadow>
              <cylinderGeometry args={[r2, r, h, 12]} />
              <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
            </mesh>
          );
        }
        if (part.shape === "sphere") {
          const r = Math.max(0.05, Number(part.radius) || 0.25);
          const sc = Array.isArray(part.scale) ? part.scale : [1, 1, 1];
          return (
            <mesh
              key={key}
              position={pos}
              rotation={rot}
              scale={sc}
              castShadow
            >
              <sphereGeometry args={[r, 12, 10]} />
              <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
            </mesh>
          );
        }
        const size = Array.isArray(part.size) ? part.size : [0.4, 0.4, 0.4];
        return (
          <mesh key={key} position={pos} rotation={rot} castShadow>
            <boxGeometry args={[size[0] || 0.4, size[1] || 0.4, size[2] || 0.4]} />
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
          </mesh>
        );
      })}
    </group>
  );
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

  // Preferred path for AI blocky items — no remote GLB dependency.
  if (Array.isArray(item.parts) && item.parts.length > 0) {
    return <BlockyPartsModel parts={item.parts} pose={pose} />;
  }

  // Legacy flat image sprites only.
  if (item.aiSprite === true) {
    return (
      <AccessoryLoadBoundary
        url={item.thumbnailUrl || item.url}
        fallback={
          <Billboard position={pose.position} follow>
            <mesh scale={1.6} renderOrder={20}>
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color="#f59e0b" toneMapped={false} />
            </mesh>
          </Billboard>
        }
      >
        <AiSpriteAccessory item={item} pose={pose} />
      </AccessoryLoadBoundary>
    );
  }

  return (
    <AccessoryLoadBoundary
      url={item.url}
      fallback={
        <mesh position={pose.position} scale={0.7}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={item.color || "#f59e0b"} />
        </mesh>
      }
    >
      <GlbAccessoryModel item={{ ...item, url: withCacheBust(item.url, "glb3") }} pose={pose} />
    </AccessoryLoadBoundary>
  );
}

/** Bust useGLTF / browser cache after earlier CORS failures. */
function withCacheBust(url, tag = "ll2") {
  if (!url) return url;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://local");
    u.searchParams.set(tag, "1");
    return u.toString();
  } catch {
    return url.includes("?") ? `${url}&${tag}=1` : `${url}?${tag}=1`;
  }
}

/**
 * AI props are painted sprites. Prefer the PNG thumbnail; otherwise pull the
 * texture out of the generated GLB. MeshBasicMaterial + Billboard = always visible.
 */
function AiSpriteAccessory({ item, pose }) {
  const thumb = item.thumbnailUrl ? withCacheBust(item.thumbnailUrl, "t") : null;
  if (thumb) {
    return <AiSpriteFromImage url={thumb} pose={pose} item={item} />;
  }
  return <AiSpriteFromGlb url={withCacheBust(item.url, "g")} pose={pose} item={item} />;
}

function AiSpriteFromImage({ url, pose, item }) {
  const texture = useLoader(TextureLoader, url);
  useLayoutEffect(() => {
    if (!texture) return;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);
  const scale = Math.max(Number(item.scale) || 1, 1) * 1.9;
  return (
    <Billboard position={pose.position} follow>
      <mesh scale={scale} renderOrder={20}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function AiSpriteFromGlb({ url, pose, item }) {
  const { scene } = useGLTF(url);
  const texture = useMemo(() => {
    let map = null;
    scene.traverse((obj) => {
      if (map || !obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m?.map) {
          map = m.map;
          break;
        }
      }
    });
    return map;
  }, [scene]);

  useLayoutEffect(() => {
    if (!texture) return;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);

  const scale = Math.max(Number(item.scale) || 1, 1) * 1.9;

  if (!texture) {
    return (
      <Billboard position={pose.position} follow>
        <mesh scale={scale} renderOrder={20}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={item.color || "#f59e0b"} toneMapped={false} />
        </mesh>
      </Billboard>
    );
  }

  return (
    <Billboard position={pose.position} follow>
      <mesh scale={scale} renderOrder={20}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function GlbAccessoryModel({ item, pose }) {
  const { scene } = useGLTF(item.url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
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

  return (
    <AccessoryLoadBoundary url={item.url} fallback={null}>
      <GlbAccessoryAtOrigin item={item} scale={scale} />
    </AccessoryLoadBoundary>
  );
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
  const classItems = useClassClosetAccessories();
  const equipped = useMemo(() => {
    const catalog = [...ACCESSORY_ITEMS, ...classItems];
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const kinds = ["hat", "glasses", "neck", "jersey", "backpack", "bag", "prop"];
    const preview = outfit?.aiPreviewAccessory;
    const out = [];
    for (const kind of kinds) {
      if (
        preview &&
        preview.kind === kind &&
        ((Array.isArray(preview.parts) && preview.parts.length > 0) ||
          preview.url ||
          preview.glbUrl)
      ) {
        out.push({
          id: preview.id || `ai-preview-${kind}`,
          kind,
          label: preview.label || "Preview",
          attach: preview.attach || "handR",
          color: preview.color || "#888888",
          parts: preview.parts || null,
          url: preview.glbUrl || preview.url || null,
          aiCreated: true,
          scale: preview.scale,
          offset: preview.offset,
          rotation: preview.rotation,
        });
        continue;
      }
      const id = outfit?.[kind];
      if (!id) continue;
      const item = byId.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [outfit, classItems]);
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
  const hideHair = hatHidesHair(outfit);
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
        // Closet modal: tiny yaw sway (not a full 360 spin).
        group.current.rotation.y = Math.sin(t * (spin ? 0.65 : 0.55)) * (spin ? 0.22 : 0.18);
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
        hideHair={hatHidesHair(outfit)}
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
        group.current.rotation.y = Math.sin(t * (spin ? 0.65 : 0.55)) * (spin ? 0.22 : 0.18);
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
  const hideHair = hatHidesHair(outfit);

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
        group.current.rotation.y = Math.sin(t * (spin ? 0.65 : 0.55)) * (spin ? 0.22 : 0.18);
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
        group.current.position.y = AVATAR_BASE_Y;
      } else {
        group.current.rotation.y = Math.sin(t * (spin ? 0.65 : 0.55)) * (spin ? 0.22 : 0.18);
        group.current.position.y = AVATAR_BASE_Y + Math.sin(t * 1.4) * 0.02;
      }
    }
    if (legL.current && legR.current) {
      if (still) {
        legL.current.rotation.x = 0.12;
        legR.current.rotation.x = -0.08;
      } else {
        legL.current.rotation.x = 0.12;
        legR.current.rotation.x = -0.08;
      }
    }
    if (armR.current && waving) {
      armR.current.rotation.x = -0.15 + Math.sin(t * 4.2) * 0.55;
      armR.current.rotation.z = Math.sin(t * 4.2) * 0.25;
    }
    if (wingL.current && wingR.current) {
      if (still) {
        wingL.current.rotation.x = 0.2;
        wingL.current.rotation.z = 0.28;
        wingR.current.rotation.x = 0.2;
        wingR.current.rotation.z = -0.28;
      } else {
        const flap = Math.sin(t * 18) * 0.2;
        wingL.current.rotation.x = 0.2 + flap;
        wingL.current.rotation.z = 0.28;
        wingR.current.rotation.x = 0.2 + flap;
        wingR.current.rotation.z = -0.28;
      }
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
    } else if (mode === "bust") {
      // Top ~2/3 of the figure (head through mid-body) — works for fruit fly + humans.
      camera.position.set(0, 0.52, 2.35);
      camera.lookAt(0, 0.42, 0);
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
  const isBust = mode === "bust";
  const stillCrop = isHeadshot || isBust;
  const avatar = (
    <AvatarModel
      outfit={outfit}
      waving={!isCloset && !isDash && !stillCrop}
      spin={isCloset}
      still={isDash || stillCrop}
      useBlender={useBlender}
    />
  );

  return (
    <>
      <CameraRig mode={mode} />
      <ambientLight intensity={stillCrop ? 0.85 : 0.75} />
      <directionalLight
        position={[2.5, 4, 2]}
        intensity={1.15}
        castShadow={!stillCrop}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2, 2, -1]} intensity={0.35} color="#9fd4a8" />
      {stillCrop ? (
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
      {!stillCrop && (
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
  const isBust = mode === "bust";
  return (
    <div className={className}>
      <Canvas
        camera={{
          position:
            mode === "closet"
              ? [0, 0.18, 3.5]
              : mode === "dash"
                ? [0, 0.55, 5.2]
                : isBust
                  ? [0, 0.52, 2.35]
                  : isHeadshot
                    ? [0, 0.82, 1.55]
                    : [0, 0.1, 3.85],
          fov: mode === "closet" ? 34 : mode === "dash" ? 38 : isBust ? 30 : isHeadshot ? 28 : 32,
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
  const classCreations = paidItems.filter((item) => item.aiCreated);
  const catalogPaid = paidItems.filter((item) => !item.aiCreated);

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
    const thumb = item.thumbnailUrl || null;

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
          {thumb ? (
            <img
              className="closet-swatch closet-swatch-thumb"
              src={thumb}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <span
              className="closet-swatch closet-swatch-luxury"
              style={{ background: swatch }}
              aria-hidden="true"
            />
          )}
          <span className="closet-item-copy">
            <strong>
              {item.label}
              {item.aiCreated ? (
                <span className="closet-item-ai-tag">Class Creation</span>
              ) : null}
            </strong>
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
  const isAccessoriesShelf = category === "accessories";

  return (
    <div className="closet-shelf" role="tabpanel">
      {isAccessoriesShelf ? (
        <>
          {classCreations.length > 0 ? (
            <>
              <p className="closet-shelf-label">
                Class creations
                <span className="closet-shelf-count"> · {classCreations.length}</span>
              </p>
              {classCreations.map(renderPaidItem)}
            </>
          ) : null}
          <p className="closet-shelf-label">Shop</p>
          {catalogPaid.length === 0 && classCreations.length === 0 ? (
            <p className="closet-ai-empty">No accessories yet.</p>
          ) : catalogPaid.length === 0 ? (
            <p className="closet-ai-empty">Catalog gear loads with the app.</p>
          ) : (
            catalogPaid.map(renderPaidItem)
          )}
        </>
      ) : category === "hairStyle" ? (
        renderHairStyleTiles(freeItems)
      ) : paletteLabels[category] ? (
        <>
          <p className="closet-shelf-label">{paletteLabels[category]}</p>
          {renderColorPalette(
            paletteLabels[category],
            toneItems.length ? toneItems : freeItems
          )}
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
      {!isAccessoriesShelf && paidItems.length > 0 && (
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

function ClosetAiBuildSpinner({ label = "Building your 3D item…" }) {
  return (
    <div className="closet-ai-build" role="status" aria-live="polite">
      <div className="closet-ai-build-stage" aria-hidden="true">
        <div className="closet-ai-build-cube">
          <span className="face front" />
          <span className="face back" />
          <span className="face right" />
          <span className="face left" />
          <span className="face top" />
          <span className="face bottom" />
        </div>
      </div>
      <p className="closet-ai-build-label">{label}</p>
    </div>
  );
}

/** Roblox-style mystery crate teasing the item waiting after the strategy response. */
function ClosetAiMysteryBox({
  primary = "#3f8f68",
  secondary = "#24312b",
  tertiary = null,
  quaternary = null,
}) {
  const accent = tertiary || secondary;
  const lid = quaternary || primary;
  return (
    <div className="closet-ai-mystery" aria-hidden="true">
      <div
        className="closet-ai-mystery-stage"
        style={{
          "--mystery-primary": primary,
          "--mystery-secondary": secondary,
          "--mystery-accent": accent,
          "--mystery-lid": lid,
        }}
      >
        <div className="closet-ai-mystery-glow" />
        <div className="closet-ai-mystery-crate">
          <span className="mystery-face mystery-back" />
          <span className="mystery-face mystery-left" />
          <span className="mystery-face mystery-right" />
          <span className="mystery-face mystery-bottom" />
          <span className="mystery-face mystery-front">
            <span className="mystery-band" />
            <span className="mystery-mark">?</span>
          </span>
          <span className="mystery-face mystery-top" />
          <span className="mystery-silhouette" />
        </div>
        <div className="closet-ai-mystery-shadow" />
      </div>
      <p className="closet-ai-mystery-caption">Your creation is sealed inside</p>
    </div>
  );
}

function ClosetAiGlbPreview({ url, parts, color = "#888888", className = "closet-ai-preview-3d" }) {
  const hasParts = Array.isArray(parts) && parts.length > 0;
  if (!url && !hasParts) return null;
  return (
    <div className={className} aria-label="3D item preview">
      <Canvas
        camera={{ position: [1.6, 1.15, 2.1], fov: 36, near: 0.1, far: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[2.5, 3.5, 2]} intensity={1.2} />
        <directionalLight position={[-2, 1.5, -1]} intensity={0.4} color="#9fd4a8" />
        <Suspense fallback={null}>
          {hasParts ? (
            <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.3}>
              <BlockyPartsModel
                parts={parts}
                pose={{ position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.85 }}
              />
            </Float>
          ) : (
            <AccessoryLoadBoundary url={url} fallback={null}>
              <ClosetAiGlbPreviewModel url={url} />
            </AccessoryLoadBoundary>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}

function ClosetAiGlbPreviewModel({ url }) {
  const { scene } = useGLTF(withCacheBust(url, "prev"));
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const group = useRef();

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
  }, [cloned]);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = state.clock.getElapsedTime() * 0.7;
  });

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.25}>
      <group ref={group} scale={0.95}>
        <primitive object={cloned} />
      </group>
    </Float>
  );
}

const CLOSET_AI_PUBLISH_FEE = 2000; // legacy fallback; payroll replaces flat fee

const CREW_TIERS = [
  {
    slots: 1,
    wageEach: 0,
    maxSellPrice: 1500,
    payroll: 0,
    payMode: "profit_share",
    profitSharePct: 50,
    label: "Partnership (1)",
    blurb: "One partner — split profits 50/50. Smallest sell-price cap.",
  },
  {
    slots: 3,
    wageEach: 700,
    maxSellPrice: 4500,
    payroll: 2100,
    payMode: "wages",
    profitSharePct: 0,
    label: "Team of 3",
    blurb: "Three employees paid wages when approved. Bigger sell-price cap.",
  },
  {
    slots: 5,
    wageEach: 900,
    maxSellPrice: 12000,
    payroll: 4500,
    payMode: "wages",
    profitSharePct: 0,
    label: "Crew of 3+",
    blurb: "Five employees for scale. Highest wages and biggest sell-price cap.",
  },
];

function crewTierFor(slots) {
  const n = Number(slots);
  return CREW_TIERS.find((t) => t.slots === n) || CREW_TIERS[0];
}

const CLOSET_AI_SCENARIOS = [
  {
    id: "opportunity-cost-chain",
    title: "Gold chain vs investing",
    prompt:
      "A classmate spends $5,000 of classroom cash on the gold chain for their character in the closet. If they invested that $5,000 instead, it could grow to about $87,000 in 30 years at roughly 10% average annual return. What is the real opportunity cost of buying that necklace? Explain what they give up, why the long-term number matters, and when spending on something fun could still make sense.",
    modelAnswer:
      "The opportunity cost isn’t just “$5,000.” It’s also the future growth that money might have earned: around $87,000 in 30 years at ~10% if left invested (before fees/taxes, and with returns that aren’t guaranteed). Buying the chain trades long-term wealth for short-term enjoyment and style on their avatar. That can still be a good choice if they value the fun now, already have other savings invested, and understand they’re choosing consumption over compound growth. A thoughtful answer names both the cash spent and the forgone future value, plus time horizon and risk.",
    placeholder:
      "What’s the real opportunity cost of the $5,000 gold chain vs investing it…",
  },
  {
    id: "panic-sell",
    title: "Market drop & Fear",
    prompt:
      "Markets just swung hard: popular tech stocks dropped about 8% in a week, and the Fear & Greed meter flipped toward Fear. Several classmates are panic-selling into cash so they can “feel safe,” even if it locks in losses. How would you change your investment strategy (if at all)? Be specific about buy, sell, or hold, and how risk and time horizon factor in.",
    modelAnswer:
      "A short-term drop doesn’t automatically mean sell. If your time horizon is years (not days), panic-selling often turns a temporary loss into a permanent one and can miss the rebound. A calmer plan reviews goals and diversification: maybe rebalance, buy quality assets on sale if you still believe in them, or hold rather than dump everything into cash from fear. Selling can make sense if you truly need cash soon or your risk level was too high, but “everyone is scared” alone isn’t a strategy.",
    placeholder:
      "Would you buy, sell, or hold, and why? Tie it to risk and time horizon…",
  },
  {
    id: "crew-payroll",
    title: "Paying a crew",
    prompt:
      "Hiring a Team of 3 or bigger means you’ll owe crew wages if the teacher approves your product: money that could have stayed invested instead. Why might paying classmates still be worth it, and what opportunity cost should you weigh before you hire?",
    modelAnswer:
      "Crew wages are a real cost: cash that won’t stay invested and won’t compound for you. The upside is help finishing the product, shared work, and possibly a higher sell price with a bigger team. Worth it if the extra help/price potential outweighs the payroll and you can still afford it after approval. Not worth it if you’re hiring just to “look big” while draining cash you’d rather keep growing in the market. Weigh payroll vs expected profit and your remaining portfolio.",
    placeholder:
      "When is hiring a crew worth the opportunity cost of those wages…",
  },
  {
    id: "diversify-project",
    title: "All-in on one product",
    prompt:
      "A classmate says you should put almost all your classroom cash into this one product because “it’ll print money.” What’s risky about that plan, and how would you balance funding the project with keeping some money diversified in stocks, ETFs, or cash?",
    modelAnswer:
      "Putting almost all cash into one product concentrates risk: if the item doesn’t sell, the crew costs money, or the teacher rejects it, you can lose a large share of your portfolio at once. Diversification means keeping some money in broader assets (stocks/ETFs) and cash reserves so one project can’t wipe you out. A smart plan funds the product with an amount you can afford to risk, keeps a buffer, and doesn’t treat one classroom business like a sure thing.",
    placeholder:
      "Explain the risk of going all-in and how you’d still fund the project wisely…",
  },
];

function shuffleClosetAiScenarios(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Pick a shuffled scenario the student hasn't answered yet.
 * After every live scenario is used, clear history and start a new unique cycle.
 */
function pickClosetAiScenario(answeredIds = []) {
  const answered = new Set(
    (Array.isArray(answeredIds) ? answeredIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const liveIds = new Set(CLOSET_AI_SCENARIOS.map((s) => s.id));
  for (const id of [...answered]) {
    if (!liveIds.has(id)) answered.delete(id);
  }
  const pool = CLOSET_AI_SCENARIOS.filter((s) => !answered.has(s.id));
  const cycleReset = pool.length === 0;
  const list = shuffleClosetAiScenarios(
    cycleReset ? CLOSET_AI_SCENARIOS : pool
  );
  return { scenario: list[0], cycleReset };
}

const CLOSET_AI_STRATEGY_MIN_CHARS = 80;

/** Classroom palette for Create-an-Item — major hues + neutrals for products. */
const CLOSET_AI_COLORS = [
  // Warm
  { id: "shoes-red", label: "Red", color: "#b04040" },
  { id: "ai-orange", label: "Orange", color: "#e07a2f" },
  { id: "tee-sun", label: "Gold", color: "#c4a035" },
  { id: "ai-yellow", label: "Yellow", color: "#e8c84a" },
  // Cool / green–blue
  { id: "ai-lime", label: "Lime", color: "#7cb342" },
  { id: "tee-forest", label: "Forest", color: "#3f8f68" },
  { id: "tee-sky", label: "Teal", color: "#4a90a4" },
  { id: "pants-denim", label: "Blue", color: "#3d5a80" },
  { id: "shoes-navy", label: "Navy", color: "#1e3a5f" },
  // Purple / pink
  { id: "ai-purple", label: "Purple", color: "#6b4ea2" },
  { id: "tee-berry", label: "Berry", color: "#a0455c" },
  { id: "ai-pink", label: "Pink", color: "#d47a9c" },
  // Earth + neutrals
  { id: "hair-copper", label: "Brown", color: "#8a4f28" },
  { id: "pants-khaki", label: "Khaki", color: "#8a7a4f" },
  { id: "shoes-white", label: "White", color: "#f2f5f3" },
  { id: "hair-silver", label: "Silver", color: "#9a9590" },
  { id: "pants-slate", label: "Slate", color: "#4a5560" },
  { id: "tee-ink", label: "Ink", color: "#24312b" },
  { id: "hair-black", label: "Black", color: "#1f1a16" },
];

const CLOSET_AI_KINDS = [
  { id: "hat", label: "Hat" },
  { id: "glasses", label: "Glasses" },
  { id: "backpack", label: "Backpack" },
  { id: "jersey", label: "Jersey" },
  { id: "prop", label: "Hand prop" },
];

const CLOSET_AI_STYLES = [
  { id: "chunky", label: "Chunky", blurb: "Big bold blocks" },
  { id: "simple", label: "Simple", blurb: "Clean & minimal" },
  { id: "fancy", label: "Fancy", blurb: "Extra accents" },
  { id: "silly", label: "Silly", blurb: "Playful & goofy" },
];

function closetAiColorById(id) {
  return CLOSET_AI_COLORS.find((c) => c.id === id) || CLOSET_AI_COLORS[0];
}

function ClosetAiColorField({
  label,
  valueId,
  open,
  onToggle,
  onPick,
  disabled = false,
  onRemove = null,
}) {
  const current = closetAiColorById(valueId);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onToggle?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  return (
    <div className="closet-ai-brief-field">
      <div className="closet-ai-brief-field-head">
        <div className="closet-ai-brief-label-row">
          <span className="closet-ai-brief-label">{label}</span>
          {onRemove ? (
            <button
              type="button"
              className="closet-ai-color-remove"
              data-click="select"
              disabled={disabled}
              onClick={onRemove}
            >
              Remove
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="closet-ai-color-pick"
          data-click="select"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${current.label}. Change color`}
          onClick={onToggle}
        >
          <span
            className="closet-swatch"
            style={{ background: current.color }}
            aria-hidden="true"
          />
          <span className="closet-ai-color-pick-meta">
            <strong>{current.label}</strong>
            <span>Change</span>
          </span>
        </button>
      </div>
      {open
        ? createPortal(
            <div
              className="closet-ai-color-modal-overlay"
              role="presentation"
              onClick={onToggle}
            >
              <div
                className="closet-ai-color-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`Pick ${label.toLowerCase()}`}
                onClick={(e) => e.stopPropagation()}
              >
                <header className="closet-ai-color-modal-head">
                  <div>
                    <p className="closet-ai-color-modal-kicker">Color</p>
                    <strong>{label}</strong>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn closet-ai-color-modal-close"
                    data-click="select"
                    aria-label="Close color picker"
                    onClick={onToggle}
                  >
                    Close
                  </button>
                </header>
                <div
                  className="closet-color-palette closet-ai-color-modal-palette"
                  role="listbox"
                  aria-label={`${label} palette`}
                >
                  {CLOSET_AI_COLORS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={item.id === valueId}
                      aria-label={item.label}
                      title={item.label}
                      className={
                        item.id === valueId
                          ? "closet-color-swatch selected"
                          : "closet-color-swatch"
                      }
                      style={{ background: item.color }}
                      data-click="select"
                      disabled={disabled}
                      onClick={() => onPick(item.id)}
                    />
                  ))}
                </div>
                <p className="closet-ai-color-modal-current">
                  Selected: <strong>{current.label}</strong>
                </p>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function ClosetAiCreator({
  open,
  studentId,
  classId,
  cash = 0,
  onCashChange,
  onPublished,
  onExit,
  onGateStepChange,
  onPreviewChange,
  quizHostReady = false,
}) {
  const [status, setStatus] = useState(null);
  const [gateStep, setGateStep] = useState("crew"); // crew | notice | create | partner | quiz | review
  const [prompt, setPrompt] = useState("");
  const [productName, setProductName] = useState("");
  const [primaryColorId, setPrimaryColorId] = useState("tee-forest");
  const [secondaryColorId, setSecondaryColorId] = useState("tee-ink");
  const [tertiaryColorId, setTertiaryColorId] = useState(null);
  const [quaternaryColorId, setQuaternaryColorId] = useState(null);
  const [itemKind, setItemKind] = useState("prop");
  const [itemStyle, setItemStyle] = useState("chunky");
  const [paletteOpen, setPaletteOpen] = useState(null); // primary | secondary | tertiary | quaternary | null
  const [messages, setMessages] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [briefTeasing, setBriefTeasing] = useState(false);
  const [error, setError] = useState("");
  const [sellPrice, setSellPrice] = useState("1200");
  const [crewSlots, setCrewSlots] = useState(null);
  const [strategyAnswer, setStrategyAnswer] = useState("");
  const [answeredScenarioIds, setAnsweredScenarioIds] = useState([]);
  const [activeScenario, setActiveScenario] = useState(
    () => pickClosetAiScenario([]).scenario
  );
  const [quizShowModel, setQuizShowModel] = useState(false);
  const [pendingBrief, setPendingBrief] = useState(null);
  const [quizDone, setQuizDone] = useState(false);
  const [redoPrompt, setRedoPrompt] = useState("");
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(true);
  const [quizHostEl, setQuizHostEl] = useState(null);
  const [partnerRoster, setPartnerRoster] = useState([]);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [invitedPartnerName, setInvitedPartnerName] = useState("");
  const pollRef = useRef(null);
  const messagesEndRef = useRef(null);
  const briefTeaseTokenRef = useRef(null);
  const tiers = Array.isArray(status?.tiers) && status.tiers.length
    ? status.tiers.map((t) => ({
        slots: Number(t.slots) || 1,
        wageEach: Number(t.wageEach) || 0,
        maxSellPrice: Number(t.maxSellPrice) || 1500,
        payroll: Number(t.payroll) || 0,
        payMode: t.payMode || "wages",
        profitSharePct: Number(t.profitSharePct) || 0,
        label: t.label || "Crew",
        blurb: t.blurb || "",
      }))
    : CREW_TIERS;
  const activeTier = tiers.length ? tiers : CREW_TIERS;
  const selectedTier =
    crewSlots == null
      ? null
      : activeTier.find((t) => t.slots === crewSlots) || crewTierFor(crewSlots);
  const publishFee = selectedTier?.payroll || 0;

  useEffect(() => {
    if (!open) return;
    setGateStep("crew");
    setPrompt("");
    setProductName("");
    setPrimaryColorId("tee-forest");
    setSecondaryColorId("tee-ink");
    setTertiaryColorId(null);
    setQuaternaryColorId(null);
    setItemKind("prop");
    setItemStyle("chunky");
    setPaletteOpen(null);
    setMessages([]);
    setJob(null);
    setBusy(false);
    setBriefTeasing(false);
    setError("");
    setSellPrice("1500");
    setCrewSlots(null);
    setStrategyAnswer("");
    setAnsweredScenarioIds([]);
    setActiveScenario(pickClosetAiScenario([]).scenario);
    setQuizShowModel(false);
    setPendingBrief(null);
    setQuizDone(false);
    setRedoPrompt("");
    setRedoOpen(false);
    setRedoAvailable(true);
    setPartnerRoster([]);
    setSelectedPartnerId("");
    setInvitedPartnerName("");
    onPreviewChange?.(null);
    briefTeaseTokenRef.current = null;
    stopPoll();
  }, [open]);

  useEffect(() => {
    return () => {
      onPreviewChange?.(null);
    };
  }, []);

  useEffect(() => {
    if (!job) {
      onPreviewChange?.(null);
      return;
    }
    const parts = Array.isArray(job.parts) ? job.parts : [];
    const glbUrl = job.glbUrl || null;
    if (!parts.length && !glbUrl) {
      onPreviewChange?.(null);
      return;
    }
    onPreviewChange?.({
      id: `ai-preview-${job.id || "draft"}`,
      kind: job.kind || itemKind || "prop",
      attach: job.attach || "handR",
      label: job.label || "Preview",
      color: job.color || "#888888",
      parts,
      glbUrl,
      offset: Array.isArray(job.offset) ? job.offset : undefined,
      rotation: Array.isArray(job.rotation) ? job.rotation : undefined,
      aiCreated: true,
    });
  }, [job, itemKind, onPreviewChange]);

  useEffect(() => {
    onGateStepChange?.(gateStep);
  }, [gateStep, onGateStepChange]);

  useEffect(() => {
    return () => {
      onGateStepChange?.(null);
    };
  }, [onGateStepChange]);

  useEffect(() => {
    if (!open || gateStep !== "partner" || !classId) return undefined;
    let cancelled = false;
    setPartnerLoading(true);
    listClassStudents(classId)
      .then((rows) => {
        if (cancelled) return;
        const list = (Array.isArray(rows) ? rows : []).filter((s) => {
          const tid = String(s?.id || s?.apiStudentId || "");
          return tid && tid !== String(studentId || "");
        });
        setPartnerRoster(list);
      })
      .catch(() => {
        if (!cancelled) setPartnerRoster([]);
      })
      .finally(() => {
        if (!cancelled) setPartnerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, gateStep, classId, studentId]);

  useLayoutEffect(() => {
    if (gateStep !== "quiz") {
      setQuizHostEl(null);
      return undefined;
    }
    const find = () => document.getElementById("closet-ai-quiz-host");
    const el = find();
    if (el) {
      setQuizHostEl(el);
      return undefined;
    }
    const raf = window.requestAnimationFrame(() => setQuizHostEl(find()));
    return () => window.cancelAnimationFrame(raf);
  }, [gateStep, quizHostReady]);

  useEffect(() => {
    if (!open || !studentId || !classId) return undefined;
    let cancelled = false;
    getClosetAiStatus(studentId, classId)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        if (typeof data?.redoAvailable === "boolean") {
          setRedoAvailable(data.redoAvailable);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ allowed: false });
      });
    getClassStudent(classId, studentId)
      .then((seat) => {
        if (cancelled) return;
        const answered = Array.isArray(seat?.closetAiAnsweredScenarios)
          ? seat.closetAiAnsweredScenarios
              .map((id) => String(id || "").trim())
              .filter(Boolean)
          : [];
        setAnsweredScenarioIds(answered);
        setActiveScenario(pickClosetAiScenario(answered).scenario);
      })
      .catch(() => {
        if (!cancelled) setAnsweredScenarioIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, studentId, classId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [messages, job?.status, gateStep]);

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function pushReadyPreview(next) {
    if (!next?.id || next.status !== "ready") return;
    setMessages((prev) => {
      if (prev.some((m) => m.previewJobId === next.id)) return prev;
      return [
        ...prev,
        {
          role: "assistant",
          text: `Preview of “${next.label || "your item"}” — look it over, then publish to class.`,
          imageUrl: next.thumbnailUrl || null,
          glbUrl: next.glbUrl || null,
          parts: Array.isArray(next.parts) ? next.parts : null,
          color: next.color || "#888888",
          previewJobId: next.id,
        },
      ];
    });
  }

  function startPoll(jobId) {
    stopPoll();
    const tick = async () => {
      try {
        const data = await pollClosetAiJob(studentId, jobId, classId);
        const next = data.job;
        setJob(next);
        if (!next) return;
        if (
          next.status === "ready" ||
          next.status === "failed" ||
          next.status === "published" ||
          next.status === "pending_quiz"
        ) {
          stopPoll();
          setBusy(false);
          if (next.status === "failed") {
            setError(next.error || "Generation failed");
          }
          if (next.status === "ready") {
            const maxP = selectedTier?.maxSellPrice || 1500;
            const suggested = Math.max(100, Math.min(maxP, Number(next.price) || maxP));
            setSellPrice(String(suggested));
            pushReadyPreview(next);
          }
        }
      } catch (err) {
        stopPoll();
        setBusy(false);
        setError(err.message || "Could not check generation status");
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  }

  async function startGenerationFromBrief(brief) {
    if (!brief?.text) return;
    setBusy(true);
    setBriefTeasing(false);
    setJob(null);
    setSellPrice("2000");
    setError("");
    setMessages((prev) => {
      const withoutTease = prev.filter((m) => !m.tease);
      if (withoutTease.some((m) => m.buildingHint)) return withoutTease;
      return [
        ...withoutTease,
        {
          role: "assistant",
          text: "Building your item now — hang tight.",
          buildingHint: true,
        },
      ];
    });
    try {
      const data = await startClosetAiDraft(studentId, brief.text, classId, {
        productName: brief.productName || null,
        primaryColor: brief.primaryColor,
        secondaryColor: brief.secondaryColor,
        tertiaryColor: brief.tertiaryColor || null,
        quaternaryColor: brief.quaternaryColor || null,
        kind: brief.kind,
        style: brief.style,
      });
      const next = data.job;
      setJob(next);
      if (next?.chatReply) {
        setMessages((prev) => [
          ...prev.filter((m) => !m.buildingHint),
          { role: "assistant", text: next.chatReply },
        ]);
      }
      if (next?.id) startPoll(next.id);
    } catch (err) {
      setBusy(false);
      setError(err.message || "Could not start generation");
    }
  }

  async function handleSend(e) {
    e?.preventDefault?.();
    if (busy || briefTeasing || gateStep !== "create") return;

    // Retry path: brief + quiz already done, generation failed — rebuild without re-quiz.
    if (quizDone && pendingBrief) {
      await startGenerationFromBrief(pendingBrief);
      return;
    }

    const text = prompt.trim();
    const name = productName.trim();
    if (!text) return;
    if (name.length < 2) {
      setError("Give your product a name (at least 2 characters).");
      return;
    }

    const primary = closetAiColorById(primaryColorId);
    const secondary = closetAiColorById(secondaryColorId);
    const tertiary = tertiaryColorId ? closetAiColorById(tertiaryColorId) : null;
    const quaternary = quaternaryColorId
      ? closetAiColorById(quaternaryColorId)
      : null;
    const kindMeta = CLOSET_AI_KINDS.find((k) => k.id === itemKind) || CLOSET_AI_KINDS[4];
    const styleMeta =
      CLOSET_AI_STYLES.find((s) => s.id === itemStyle) || CLOSET_AI_STYLES[0];
    const colorLabels = [
      primary.label,
      secondary.label,
      tertiary?.label,
      quaternary?.label,
    ].filter(Boolean);
    const briefLine = `${name} · ${kindMeta.label} · ${styleMeta.label} · ${colorLabels.join(" / ")}`;
    const brief = {
      text,
      productName: name.slice(0, 40),
      primaryColor: primary.color,
      secondaryColor: secondary.color,
      tertiaryColor: tertiary?.color || null,
      quaternaryColor: quaternary?.color || null,
      kind: kindMeta.id,
      style: styleMeta.id,
      briefLine,
    };
    setError("");
    setPrompt("");
    setProductName("");
    setPaletteOpen(null);
    setPendingBrief(brief);
    setJob(null);
    setMessages([
      { role: "user", text: `${briefLine}\n${text}` },
      {
        role: "assistant",
        text: "Got it — lining up your build…",
        tease: true,
      },
    ]);
    setBusy(true);
    setBriefTeasing(true);
    const teaseToken = Symbol("brief-tease");
    briefTeaseTokenRef.current = teaseToken;
    // Let React paint the loading chat before the wait.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    await new Promise((resolve) => setTimeout(resolve, 1600));
    if (briefTeaseTokenRef.current !== teaseToken) return;
    briefTeaseTokenRef.current = null;
    setBriefTeasing(false);
    setBusy(false);
    setStrategyAnswer("");
    setQuizShowModel(false);
    {
      const picked = pickClosetAiScenario(answeredScenarioIds);
      if (picked.cycleReset) {
        setAnsweredScenarioIds([]);
        if (classId && studentId) {
          resetClosetAiAnsweredScenarios(classId, studentId).catch(() => {});
        }
      }
      setActiveScenario(picked.scenario);
    }
    setGateStep("quiz");
  }

  function strategyAnswersPayload() {
    const scenario = activeScenario || CLOSET_AI_SCENARIOS[0];
    return [
      {
        id: scenario.id,
        prompt: scenario.prompt,
        answer: String(strategyAnswer || "").trim(),
      },
    ];
  }

  async function handleRedo() {
    if (!job?.id || job.status !== "ready" || busy || !redoAvailable) return;
    const nextPrompt = String(redoPrompt || "").trim();
    const prevJobId = job.id;
    setBusy(true);
    setError("");
    setRedoOpen(false);
    onPreviewChange?.(null);
    setJob((prev) =>
      prev
        ? { ...prev, status: "generating", phase: "blocky", progress: 5 }
        : prev
    );
    setMessages((prev) => [
      ...prev.filter((m) => !m.previewJobId),
      {
        role: "user",
        text: nextPrompt
          ? `Redo with new prompt:\n${nextPrompt}`
          : "Redo — build it again",
      },
      {
        role: "assistant",
        text: "Rebuilding with your one redo…",
        buildingHint: true,
      },
    ]);
    try {
      const data = await redoClosetAiDraft(
        studentId,
        prevJobId,
        classId,
        nextPrompt || null
      );
      setRedoAvailable(false);
      setStatus((prev) =>
        prev ? { ...prev, redoAvailable: false } : prev
      );
      const next = data.job;
      setJob(next);
      if (nextPrompt && pendingBrief) {
        setPendingBrief({ ...pendingBrief, text: nextPrompt });
      }
      if (next?.chatReply) {
        setMessages((prev) => [
          ...prev.filter((m) => !m.buildingHint),
          { role: "assistant", text: next.chatReply },
        ]);
      }
      if (next?.id) startPoll(next.id);
    } catch (err) {
      setBusy(false);
      setJob((prev) =>
        prev && prev.id === prevJobId
          ? { ...prev, status: "ready", phase: "ready", progress: 100 }
          : prev
      );
      setError(err.message || "Could not redo build");
    }
  }

  async function handlePublish() {
    if (!job?.id || job.status !== "ready" || busy) return;
    if (crewSlots == null || !selectedTier) {
      setError("Pick a crew size on the Hire a crew step first.");
      return;
    }
    const answer = String(strategyAnswer || "").trim();
    if (answer.length < CLOSET_AI_STRATEGY_MIN_CHARS) {
      setError(
        `Strategy response is missing — go back and write at least ${CLOSET_AI_STRATEGY_MIN_CHARS} characters.`
      );
      return;
    }
    const maxP = selectedTier.maxSellPrice || 1500;
    const payroll = selectedTier.payroll || 0;
    const parsed = Math.round(Number(String(sellPrice).replace(/[^0-9.]/g, "")));
    if (!Number.isFinite(parsed) || parsed < 100 || parsed > maxP) {
      setError(`Set a price between $100 and ${money(maxP)} for this crew size.`);
      return;
    }
    if (payroll > 0 && Number(cash) < payroll) {
      setError(
        `You need at least ${money(payroll)} cash for crew payroll (charged only if approved).`
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await publishClosetAiJob(
        studentId,
        job.id,
        classId,
        parsed,
        crewSlots
      );
      const title = data?.crew?.jobTitle || "";
      const partnerName =
        data?.crew?.invitedStudentName || invitedPartnerName || "";
      const result = await activateClosetAiJob(
        studentId,
        job.id,
        classId,
        strategyAnswersPayload()
      );
      setJob((prev) => ({
        ...prev,
        status: result?.pendingReview
          ? "pending_review"
          : result?.awaitingCrew
            ? "awaiting_crew"
            : "awaiting_crew",
        price: parsed,
        itemId: data.item?.id,
        crew: data.crew,
        crewSlots,
        crewPayroll: payroll,
        label: data.item?.label || prev?.label,
      }));
      if (partnerName) setInvitedPartnerName(partnerName);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            crewSlots === 1
              ? partnerName
                ? `Published “${title || "your item"}”. Waiting for ${partnerName} to accept the partnership (if they haven’t yet).`
                : `Published “${title || "your item"}”. Waiting for your partner to accept.`
              : title
                ? `Posted to the Job board as “${title}”. Hire ${crewSlots} classmates to fill the crew.`
                : `Posted to the Job board. Hire ${crewSlots} classmates to fill the crew.`,
        },
      ]);
      setGateStep("review");
      getClosetAiStatus(studentId, classId).then(setStatus).catch(() => {});
    } catch (err) {
      setError(err.message || "Could not publish");
    } finally {
      setBusy(false);
    }
  }

  async function handleInvitePartner() {
    if (!selectedPartnerId || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await inviteCrewPartner(
        classId,
        studentId,
        selectedPartnerId
      );
      const name = data?.partnerName || "classmate";
      setInvitedPartnerName(name);
      setGateStep("notice");
    } catch (err) {
      setError(err.message || "Could not send invite");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuizSubmit(e) {
    e?.preventDefault?.();
    if (busy || briefTeasing || quizShowModel) return;
    const answer = String(strategyAnswer || "").trim();
    if (answer.length < CLOSET_AI_STRATEGY_MIN_CHARS) {
      setError(
        `Write a thoughtful response (at least ${CLOSET_AI_STRATEGY_MIN_CHARS} characters).`
      );
      return;
    }
    setError("");
    if (!pendingBrief?.text) {
      setError("Describe your item first, then come back to this scenario.");
      setGateStep("create");
      return;
    }
    // Reveal the sample answer first; Continue starts the real AI build.
    setQuizShowModel(true);
    const scenarioId = String(
      (activeScenario || CLOSET_AI_SCENARIOS[0])?.id || ""
    ).trim();
    if (scenarioId) {
      setAnsweredScenarioIds((prev) =>
        prev.includes(scenarioId) ? prev : [...prev, scenarioId]
      );
      if (classId && studentId) {
        markClosetAiScenarioAnswered(classId, studentId, scenarioId).catch(
          () => {}
        );
      }
    }
  }

  async function handleQuizContinue() {
    if (busy || briefTeasing || !quizShowModel) return;
    if (!pendingBrief?.text) {
      setError("Describe your item first, then come back to this scenario.");
      setGateStep("create");
      return;
    }
    setError("");
    try {
      setQuizDone(true);
      setQuizShowModel(false);
      setGateStep("create");
      await startGenerationFromBrief(pendingBrief);
    } catch (err) {
      setError(err.message || "Could not start building");
      setBusy(false);
    }
  }

  if (status && !status.allowed) return null;
  if (!status && gateStep === "create") return null;

  const isBuilding =
    job &&
    (job.status === "previewing" ||
      job.status === "refining" ||
      job.status === "generating" ||
      job.status === "queued");
  const formLocked = Boolean(busy || isBuilding || briefTeasing);
  const showBuildSpinner =
    briefTeasing ||
    isBuilding ||
    (busy && quizDone && job?.status !== "ready");
  const buildSpinnerLabel = briefTeasing
    ? "Getting your idea ready…"
    : "Building your 3D item…";
  const showBriefForm =
    !formLocked && !job && !briefTeasing && !quizDone;

  if (gateStep === "crew") {
    return (
      <div className="closet-ai-panel closet-ai-gate">
        <p className="closet-kicker">Hire a crew</p>
        <strong className="closet-ai-gate-title">Choose your team</strong>
        <p className="closet-ai-gate-copy">
          Choose a business model. Enter a partnership and split profits with a
          co-founder, or hire a few classmates to help build and sell your
          product. If you hire a team, the job will be added to the Job board.
        </p>
        <div className="closet-ai-crew-choices" role="radiogroup" aria-label="Crew size">
          {activeTier.map((t) => {
            const selected = crewSlots === t.slots;
            return (
              <button
                key={t.slots}
                type="button"
                role="radio"
                aria-checked={selected}
                className={
                  selected
                    ? "closet-ai-crew-choice is-selected"
                    : "closet-ai-crew-choice"
                }
                data-click="select"
                onClick={() => {
                  setCrewSlots(t.slots);
                  setSellPrice(String(t.maxSellPrice));
                }}
              >
                <strong>{t.label}</strong>
                <span>{t.blurb}</span>
                <em>
                  {t.payMode === "profit_share"
                    ? `Split profits ${t.profitSharePct || 50}/${100 - (t.profitSharePct || 50)} · max ${money(t.maxSellPrice)}`
                    : `Payroll ${money(t.payroll)} · max ${money(t.maxSellPrice)}`}
                </em>
              </button>
            );
          })}
        </div>
        <div className="closet-ai-gate-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            disabled={crewSlots == null}
            onClick={() =>
              setGateStep(crewSlots === 1 ? "partner" : "notice")
            }
          >
            {crewSlots === 1 ? "Choose partner" : "Continue"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            onClick={() => onExit?.()}
          >
            Exit
          </button>
        </div>
      </div>
    );
  }

  if (gateStep === "notice") {
    return (
      <div className="closet-ai-panel closet-ai-gate">
        <p className="closet-kicker">Before you create</p>
        <strong className="closet-ai-gate-title">Strategy response required</strong>
        <p className="closet-ai-gate-copy">
          You’ll describe your item, then answer one market scenario before we
          build it. Your teacher will not approve the item unless your answer is
          thoughtful and original.
          {selectedTier?.payMode === "profit_share"
            ? invitedPartnerName
              ? ` You’ve invited ${invitedPartnerName} as your partner — they’ll get a notification when they open LedgerLab.`
              : " You’ll invite one classmate as your partner next."
            : " Your crew opening will post to the Job board for classmates to join."}
        </p>
        <div className="closet-ai-gate-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            onClick={() => setGateStep("create")}
          >
            Agree
          </button>
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            onClick={() => onExit?.()}
          >
            Exit
          </button>
        </div>
      </div>
    );
  }

  if (gateStep === "partner") {
    const selectedSeat = partnerRoster.find(
      (s) => String(s?.id || s?.apiStudentId || "") === selectedPartnerId
    );
    return (
      <div className="closet-ai-panel closet-ai-gate closet-ai-partner-gate">
        <p className="closet-kicker">Partnership</p>
        <strong className="closet-ai-gate-title">Invite a partner</strong>
        <p className="closet-ai-gate-copy">
          Pick one classmate from your class list. Any profit from this venture
          is split evenly between you and your partner — they must accept before
          your item can go to teacher review.
        </p>
        <section className="h2h-roster" aria-label="Classmates">
          <h4 className="h2h-roster-title">Send invite to</h4>
          {partnerLoading ? (
            <p className="standings-profile-note">Loading classmates…</p>
          ) : partnerRoster.length === 0 ? (
            <p className="standings-profile-note">
              No other students in this class yet.
            </p>
          ) : (
            <ul className="h2h-opponent-list">
              {partnerRoster.map((s) => {
                const tid = String(s?.id || s?.apiStudentId || "");
                const outfitId = String(s?.apiStudentId || s?.id || "");
                const base = outfitForStudent(outfitId, s.name);
                const outfit =
                  s?.outfit && typeof s.outfit === "object"
                    ? stripPlayerFishForm(
                        { ...base, ...s.outfit, npcFish: false },
                        base
                      )
                    : loadSavedOutfit(outfitId, s.name);
                const active = tid === selectedPartnerId;
                return (
                  <li key={tid || s.id}>
                    <button
                      type="button"
                      className={`h2h-opponent-btn${active ? " is-active" : ""}`}
                      data-click="select"
                      disabled={busy}
                      onClick={() => setSelectedPartnerId(tid)}
                    >
                      <span className="h2h-opponent-avatar" aria-hidden="true">
                        <Suspense
                          fallback={
                            <div className="standings-profile-avatar-fallback">
                              <span className="busy-spinner" />
                            </div>
                          }
                        >
                          <AvatarCanvas
                            outfit={outfit}
                            mode="headshot"
                            className="h2h-opponent-stage"
                          />
                        </Suspense>
                      </span>
                      <span className="h2h-opponent-name">
                        {s.name || "Student"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {error ? <p className="closet-note closet-note-error">{error}</p> : null}
        <div className="closet-ai-gate-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            disabled={!selectedPartnerId || busy}
            onClick={handleInvitePartner}
          >
            {busy
              ? "Sending…"
              : selectedSeat
                ? `Invite ${selectedSeat.name || "partner"}`
                : "Pick a partner"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            disabled={busy}
            onClick={() => setGateStep("crew")}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (gateStep === "review") {
    const waitingOnCrew = job?.status === "awaiting_crew";
    return (
      <div className="closet-ai-panel closet-ai-gate closet-ai-review-done">
        <p className="closet-kicker">Submitted</p>
        <strong className="closet-ai-gate-title">
          {waitingOnCrew ? "Response saved" : "Under teacher review"}
        </strong>
        <p className="closet-ai-gate-copy">
          {waitingOnCrew ? (
            <>
              Your strategy response for
              {job?.label ? ` “${job.label}”` : " your item"} is saved. Your
              teacher won’t see it until the crew is full
              {crewSlots === 1
                ? invitedPartnerName
                  ? ` (${invitedPartnerName} still needs to accept).`
                  : " (your partner still needs to accept)."
                : "."}
            </>
          ) : (
            <>
              Your item{job?.label ? ` “${job.label}”` : ""} is waiting for your
              teacher to review it.
            </>
          )}
        </p>
        <ul className="closet-ai-review-points">
          <li>
            <strong>If accepted:</strong> added to the class closet
            {publishFee > 0
              ? ` and you pay ${money(publishFee)} in crew wages`
              : selectedTier?.payMode === "profit_share"
                ? " and you split profits with your partner on sales"
                : ""}
            .
          </li>
          <li>
            <strong>If denied:</strong> the item is deleted and you are charged{" "}
            {money(0)}.
          </li>
        </ul>
        <div className="closet-ai-gate-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            onClick={() =>
              onPublished?.({
                id: job?.itemId || job?.id || "pending",
                label: job?.label || "Item",
                pendingReview: !waitingOnCrew,
                awaitingCrew: waitingOnCrew,
              })
            }
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  if (gateStep === "quiz") {
    const scenario = activeScenario || CLOSET_AI_SCENARIOS[0];
    const trimmed = String(strategyAnswer || "").trim();
    const ready = trimmed.length >= CLOSET_AI_STRATEGY_MIN_CHARS;
    const quizForm = quizShowModel ? (
      <div className="closet-ai-quiz closet-ai-quiz-stage-form closet-ai-quiz-model">
        <p className="closet-ai-quiz-stage-kicker">Sample answer</p>
        <p className="closet-ai-quiz-prompt">{scenario.title}</p>
        <div className="closet-ai-quiz-model-box" role="region" aria-label="Sample answer">
          <p>{scenario.modelAnswer}</p>
        </div>
        <p className="closet-ai-quiz-model-note">
          Compare this with what you wrote, then continue to build your item.
        </p>
        {error ? <p className="closet-note closet-note-error">{error}</p> : null}
        <div className="closet-ai-gate-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            disabled={busy}
            onClick={handleQuizContinue}
          >
            {busy ? "Starting…" : "Continue"}
          </button>
        </div>
      </div>
    ) : (
      <form className="closet-ai-quiz closet-ai-quiz-stage-form" onSubmit={handleQuizSubmit}>
        <p className="closet-ai-quiz-stage-kicker">Free response</p>
        <p className="closet-ai-quiz-prompt">{scenario.prompt}</p>
        <textarea
          className="closet-ai-quiz-input"
          rows={9}
          value={strategyAnswer}
          disabled={busy}
          placeholder={scenario.placeholder}
          maxLength={1200}
          aria-label="Strategy response"
          onChange={(e) => setStrategyAnswer(e.target.value)}
        />
        <p className="closet-ai-quiz-progress">
          {trimmed.length}/{CLOSET_AI_STRATEGY_MIN_CHARS}+ characters
        </p>
        {error ? <p className="closet-note closet-note-error">{error}</p> : null}
        <div className="closet-ai-gate-actions">
          <button
            type="submit"
            className="primary-btn"
            data-click="confirm"
            disabled={busy || !ready}
          >
            Submit response
          </button>
        </div>
      </form>
    );
    const host = quizHostEl;
    return (
      <>
        <div className="closet-ai-panel closet-ai-gate">
          <p className="closet-kicker">Go live</p>
          <strong className="closet-ai-gate-title">Strategy scenario</strong>
          <p className="closet-ai-gate-copy">
            {quizShowModel
              ? "Read the sample answer, then continue to build your item. Your teacher only sees your response once the crew is full."
              : "Answer the scenario to the right. After you submit, you’ll see a sample answer, then continue to build. Your teacher only sees this once the crew is full."}
          </p>
          {crewSlots === 1 && !invitedPartnerName ? (
            <div className="closet-ai-gate-actions">
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={() => setGateStep("partner")}
              >
                Invite partner
              </button>
            </div>
          ) : null}
          <p className="closet-ai-gate-copy closet-ai-gate-copy-soft">
            Your teacher will not approve this item if your response is thin,
            copied, or not an original thought.
          </p>
          <ClosetAiMysteryBox
            primary={pendingBrief?.primaryColor || "#3f8f68"}
            secondary={pendingBrief?.secondaryColor || "#24312b"}
            tertiary={pendingBrief?.tertiaryColor || null}
            quaternary={pendingBrief?.quaternaryColor || null}
          />
        </div>
        {host ? createPortal(quizForm, host) : null}
      </>
    );
  }

  return (
    <div
      className={
        job?.status === "ready"
          ? "closet-ai-panel closet-ai-panel--ready"
          : "closet-ai-panel"
      }
    >
      <div className="closet-ai-head">
        <p className="closet-kicker">Creator</p>
        <strong>
          {job?.status === "ready"
            ? job.label || "Your item"
            : showBuildSpinner
              ? briefTeasing
                ? "Setting up…"
                : "Building…"
              : "Make a class buyable"}
        </strong>
        {job?.status === "ready" ? (
          <span className="closet-ai-quota">
            Preview on your character · set a price to post
          </span>
        ) : showBuildSpinner ? (
          <span className="closet-ai-quota">
            {briefTeasing
              ? "Hang tight — strategy next"
              : "Creating your 3D item"}
          </span>
        ) : (
          <span className="closet-ai-quota">
            {status.publishesToday ?? 0}/{status.maxPerDay ?? 8} today · payroll{" "}
            {money(publishFee)}
          </span>
        )}
      </div>
      <div className="closet-ai-messages" aria-live="polite">
        {messages.length === 0 && !showBuildSpinner ? (
          <p className="closet-ai-empty">
            Pick colors, type, and style — describe what to build, then continue.
            We’ll show a quick setup, then the strategy scenario, then build your
            item.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={
                m.role === "user" ? "closet-ai-msg user" : "closet-ai-msg bot"
              }
            >
              {m.text ? (
                <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>
              ) : null}
              {m.imageUrl ? (
                <img
                  className="closet-ai-preview-img"
                  src={m.imageUrl}
                  alt={m.text ? `Preview: ${m.text}` : "Item preview"}
                />
              ) : null}
              {!m.imageUrl && (m.parts?.length || m.glbUrl) ? (
                <ClosetAiGlbPreview
                  url={m.glbUrl}
                  parts={m.parts}
                  color={m.color}
                />
              ) : null}
            </div>
          ))
        )}
        {showBuildSpinner ? (
          <ClosetAiBuildSpinner label={buildSpinnerLabel} />
        ) : null}
        <div ref={messagesEndRef} />
      </div>
      {job?.status === "ready" ? (
        <div className="closet-ai-ready closet-ai-ready--focus">
          <div className="closet-ai-ready-meta">
            <span className="closet-ai-ready-kind">{job.kind}</span>
            <label className="closet-ai-price-field">
              <span>Crew</span>
              <strong className="closet-ai-crew-locked">
                {selectedTier?.label || "Not chosen"}
                {selectedTier?.payMode === "profit_share"
                  ? ` · ${selectedTier.profitSharePct || 50}% profit share`
                  : ` · payroll ${money(selectedTier?.payroll || 0)}`}
              </strong>
            </label>
            <label className="closet-ai-price-field">
              <span>
                Sell price (max {money(selectedTier?.maxSellPrice || 1500)})
              </span>
              <span className="closet-ai-price-input-wrap">
                <span aria-hidden="true">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={selectedTier?.maxSellPrice || 1500}
                  step={100}
                  value={sellPrice}
                  disabled={busy || crewSlots == null}
                  onChange={(e) => setSellPrice(e.target.value)}
                  aria-label="Classroom sell price"
                />
              </span>
            </label>
          </div>
          {error ? <p className="closet-note closet-note-error">{error}</p> : null}
          <button
            type="button"
            className="primary-btn closet-ai-post-btn"
            data-click="confirm"
            disabled={busy || crewSlots == null}
            onClick={handlePublish}
          >
            {busy
              ? "Publishing…"
              : crewSlots === 1
                ? "Publish"
                : "Post to Job board"}
          </button>
          {redoAvailable && !job?.isRedo && !job?.redoUsed ? (
            <div className="closet-ai-redo">
              {!redoOpen ? (
                <button
                  type="button"
                  className="ghost-btn closet-ai-redo-toggle"
                  data-click="select"
                  disabled={busy}
                  onClick={() => {
                    setRedoOpen(true);
                    setRedoPrompt(pendingBrief?.text || job?.sourcePrompt || "");
                  }}
                >
                  Redo build (1 left)
                </button>
              ) : (
                <div className="closet-ai-redo-panel">
                  <label className="closet-ai-brief-field closet-ai-brief-describe">
                    <span className="closet-ai-brief-label">
                      Optional new prompt
                    </span>
                    <textarea
                      value={redoPrompt}
                      onChange={(e) => setRedoPrompt(e.target.value)}
                      placeholder="Leave as-is to rebuild the same idea, or tweak the description"
                      maxLength={400}
                      rows={2}
                      disabled={busy}
                      aria-label="Optional new prompt for redo"
                    />
                  </label>
                  <p className="closet-ai-redo-note">
                    You only get one redo — colors and style stay the same.
                  </p>
                  <div className="closet-ai-redo-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      data-click="confirm"
                      disabled={busy}
                      onClick={handleRedo}
                    >
                      {busy ? "Rebuilding…" : "Rebuild item"}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      data-click="select"
                      disabled={busy}
                      onClick={() => setRedoOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {error ? <p className="closet-note closet-note-error">{error}</p> : null}
          {!formLocked && job?.status === "failed" && quizDone && pendingBrief ? (
            <button
              type="button"
              className="primary-btn closet-ai-brief-submit"
              data-click="confirm"
              disabled={busy}
              onClick={() => startGenerationFromBrief(pendingBrief)}
            >
              Try again
            </button>
          ) : null}
          {showBriefForm ? (
            <>
              <form className="closet-ai-brief" onSubmit={handleSend}>
                <div className="closet-ai-color-rows">
                  <div className="closet-ai-color-row">
                    <ClosetAiColorField
                      label="Primary color"
                      valueId={primaryColorId}
                      open={paletteOpen === "primary"}
                      disabled={formLocked}
                      onToggle={() =>
                        setPaletteOpen((v) =>
                          v === "primary" ? null : "primary"
                        )
                      }
                      onPick={(id) => {
                        setPrimaryColorId(id);
                        setPaletteOpen(null);
                      }}
                    />
                    <ClosetAiColorField
                      label="Secondary color"
                      valueId={secondaryColorId}
                      open={paletteOpen === "secondary"}
                      disabled={formLocked}
                      onToggle={() =>
                        setPaletteOpen((v) =>
                          v === "secondary" ? null : "secondary"
                        )
                      }
                      onPick={(id) => {
                        setSecondaryColorId(id);
                        setPaletteOpen(null);
                      }}
                    />
                  </div>
                  {tertiaryColorId || quaternaryColorId ? (
                    <div className="closet-ai-color-row">
                      {tertiaryColorId ? (
                        <ClosetAiColorField
                          label="Third color"
                          valueId={tertiaryColorId}
                          open={paletteOpen === "tertiary"}
                          disabled={formLocked}
                          onToggle={() =>
                            setPaletteOpen((v) =>
                              v === "tertiary" ? null : "tertiary"
                            )
                          }
                          onPick={(id) => {
                            setTertiaryColorId(id);
                            setPaletteOpen(null);
                          }}
                          onRemove={() => {
                            setTertiaryColorId(quaternaryColorId);
                            setQuaternaryColorId(null);
                            setPaletteOpen(null);
                          }}
                        />
                      ) : null}
                      {quaternaryColorId ? (
                        <ClosetAiColorField
                          label="Fourth color"
                          valueId={quaternaryColorId}
                          open={paletteOpen === "quaternary"}
                          disabled={formLocked}
                          onToggle={() =>
                            setPaletteOpen((v) =>
                              v === "quaternary" ? null : "quaternary"
                            )
                          }
                          onPick={(id) => {
                            setQuaternaryColorId(id);
                            setPaletteOpen(null);
                          }}
                          onRemove={() => {
                            setQuaternaryColorId(null);
                            setPaletteOpen(null);
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {!quaternaryColorId ? (
                    <button
                      type="button"
                      className="closet-ai-add-color"
                      data-click="select"
                      disabled={formLocked}
                      onClick={() => {
                        if (!tertiaryColorId) {
                          setTertiaryColorId("tee-sun");
                        } else {
                          setQuaternaryColorId("tee-berry");
                        }
                        setPaletteOpen(null);
                      }}
                    >
                      {tertiaryColorId
                        ? "+ Add a fourth color"
                        : "+ Add a third color"}
                    </button>
                  ) : null}
                </div>
                <div className="closet-ai-brief-field">
                  <span className="closet-ai-brief-label">What kind of item?</span>
                  <div
                    className="closet-ai-choice-row"
                    role="radiogroup"
                    aria-label="Item type"
                  >
                    {CLOSET_AI_KINDS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={itemKind === opt.id}
                        className={
                          itemKind === opt.id
                            ? "closet-ai-choice is-selected"
                            : "closet-ai-choice"
                        }
                        data-click="select"
                        disabled={formLocked}
                        onClick={() => setItemKind(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="closet-ai-brief-field">
                  <span className="closet-ai-brief-label">Style</span>
                  <div
                    className="closet-ai-choice-row"
                    role="radiogroup"
                    aria-label="Style"
                  >
                    {CLOSET_AI_STYLES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={itemStyle === opt.id}
                        title={opt.blurb}
                        className={
                          itemStyle === opt.id
                            ? "closet-ai-choice is-selected"
                            : "closet-ai-choice"
                        }
                        data-click="select"
                        disabled={formLocked}
                        onClick={() => setItemStyle(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="closet-ai-brief-field closet-ai-brief-describe">
                  <span className="closet-ai-brief-label">Product name</span>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Neon Boombox"
                    maxLength={40}
                    disabled={formLocked}
                    aria-label="Product name"
                  />
                </label>
                <label className="closet-ai-brief-field closet-ai-brief-describe">
                  <span className="closet-ai-brief-label">Describe the item</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. a boombox with chunky speakers"
                    maxLength={400}
                    rows={2}
                    disabled={formLocked}
                    aria-label="Describe the item"
                  />
                </label>
                <button
                  type="submit"
                  className="primary-btn closet-ai-brief-submit"
                  data-click="confirm"
                  disabled={
                    formLocked ||
                    !prompt.trim() ||
                    prompt.trim().length < 2 ||
                    productName.trim().length < 2
                  }
                >
                  Continue
                </button>
              </form>
            </>
          ) : null}
        </>
      )}
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
  classId = "",
  classClosetItems = [],
  canCreateAi = false,
  creatorStudentId = "",
}) {
  const [sectionId, setSectionId] = useState("base");
  const [categoryId, setCategoryId] = useState("skin");
  const [buyingId, setBuyingId] = useState(null);
  const [shopNote, setShopNote] = useState("");
  const [shopError, setShopError] = useState("");
  const [draft, setDraft] = useState(outfit);
  const [showAi, setShowAi] = useState(false);
  const [aiGateStep, setAiGateStep] = useState(null);
  const [aiPreviewAccessory, setAiPreviewAccessory] = useState(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(outfit);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChangeOutfit);
  onChangeRef.current = onChangeOutfit;

  const mergedCatalog = useMemo(
    () => catalogWithClassItems(classClosetItems),
    [classClosetItems]
  );

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
    setShowAi(false);
    setAiGateStep(null);
    setAiPreviewAccessory(null);
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

  const previewOutfit = useMemo(() => {
    if (!aiPreviewAccessory) return draft;
    return { ...draft, aiPreviewAccessory };
  }, [draft, aiPreviewAccessory]);

  if (!open) return null;

  const section = CLOSET_SECTIONS.find((s) => s.id === sectionId) || CLOSET_SECTIONS[0];
  const category =
    section.categories.find((c) => c.id === categoryId)?.id || section.categories[0].id;
  const items = mergedCatalog[category] || [];

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
      (mergedCatalog[category] || []).filter((entry) => !isPaidItem(entry)).find(
        (entry) => entry.id === committed[`${category}Id`]
      ) ||
      (mergedCatalog[category] || []).find((entry) => !isPaidItem(entry));
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
      let updated;
      if (item.aiCreated && classId) {
        const result = await buyClosetItem(
          classId,
          studentId,
          item.id,
          studentName || ""
        );
        updated = result?.cash != null ? { cash: result.cash } : null;
        if (updated) onCashChange?.(updated);
        setShopNote(
          result?.message || `Bought ${item.label} — creators were paid.`
        );
      } else {
        updated = await adjustCash(studentId, -item.price);
        onCashChange?.(updated);
      }
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

  const paidInCategory = items.some((item) => isPaidItem(item));

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
          <div className="closet-head-tools">
            {canCreateAi ? (
              <button
                type="button"
                className={
                  showAi
                    ? "closet-ai-create-btn is-active"
                    : "closet-ai-create-btn"
                }
                data-click="select"
                title={showAi ? "Back to shelf" : "Create an Item"}
                aria-label={showAi ? "Back to shelf" : "Create an Item"}
                aria-pressed={showAi}
                onClick={() => {
                  setShowAi((v) => {
                    if (v) {
                      setAiGateStep(null);
                      setAiPreviewAccessory(null);
                    }
                    return !v;
                  });
                }}
              >
                <span className="closet-ai-create-plus" aria-hidden="true">
                  +
                </span>
                <span>{showAi ? "Back to shelf" : "Create an Item"}</span>
              </button>
            ) : null}
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
          </div>
        </header>

        <div className="closet-body">
          <aside className="closet-rail" aria-label="Customization options">
            {showAi && canCreateAi ? null : (
              <ClosetNav
                sections={CLOSET_SECTIONS}
                sectionId={section.id}
                categoryId={category}
                onSection={(id) => {
                  setSectionId(id);
                  const next = CLOSET_SECTIONS.find((s) => s.id === id);
                  setCategoryId(next?.categories[0]?.id || "skin");
                  setShowAi(false);
                  setAiGateStep(null);
                  setAiPreviewAccessory(null);
                }}
                onCategory={(id) => {
                  setCategoryId(id);
                  setShowAi(false);
                  setAiGateStep(null);
                  setAiPreviewAccessory(null);
                }}
              />
            )}

            {showAi && canCreateAi ? (
              <ClosetAiCreator
                open={open}
                studentId={creatorStudentId || studentId}
                classId={classId}
                cash={cash}
                onCashChange={onCashChange}
                onGateStepChange={setAiGateStep}
                onPreviewChange={setAiPreviewAccessory}
                quizHostReady={aiGateStep === "quiz"}
                onExit={() => {
                  setShowAi(false);
                  setAiGateStep(null);
                  setAiPreviewAccessory(null);
                }}
                onPublished={() => {
                  setAiPreviewAccessory(null);
                  commitAndClose();
                }}
              />
            ) : (
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
            )}

            {shopError ? (
              <p className="closet-note closet-note-error">{shopError}</p>
            ) : shopNote ? (
              <p className="closet-note">{shopNote}</p>
            ) : !showAi ? (
              <p className="closet-note">
                {paidInCategory
                  ? "Free options up top. Buyables below — try on free, buy to keep."
                  : category === "hairStyle"
                    ? "Pick a haircut, then fine-tune color under Hair color."
                    : "Free looks save automatically."}
              </p>
            ) : null}
          </aside>

          <div
            className={
              showAi && aiGateStep === "quiz"
                ? "closet-preview closet-preview--quiz"
                : "closet-preview"
            }
          >
            {showAi && aiGateStep === "quiz" ? (
              <div
                id="closet-ai-quiz-host"
                className="closet-ai-quiz-stage"
                aria-label="Strategy quiz"
              />
            ) : (
              <>
                <AvatarCanvas
                  outfit={previewOutfit}
                  mode="closet"
                  className="closet-stage"
                />
                <p className="closet-hint">
                  {aiPreviewAccessory
                    ? "Your creation is on the character"
                    : "Try buyables free — only purchases leave with you"}
                </p>
              </>
            )}
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
  const [classClosetItems, setClassClosetItems] = useState([]);
  const [studentEmail, setStudentEmail] = useState("");

  useEffect(() => {
    setOutfit(loadSavedOutfit(studentId, name));
  }, [studentId, name]);

  useEffect(() => {
    if (!classId) {
      setClassClosetItems([]);
      setClassClosetAccessories([]);
      return undefined;
    }
    return subscribeClassClosetItems(classId, (items) => {
      setClassClosetItems(items);
      setClassClosetAccessories(items);
    });
  }, [classId]);

  useEffect(() => {
    if (!classId || !firestoreStudentId) {
      setStudentEmail("");
      return undefined;
    }
    let cancelled = false;
    getClassStudent(classId, firestoreStudentId)
      .then((seat) => {
        if (!cancelled) setStudentEmail(String(seat?.email || "").toLowerCase());
      })
      .catch(() => {
        if (!cancelled) setStudentEmail("");
      });
    return () => {
      cancelled = true;
    };
  }, [classId, firestoreStudentId]);

  const displayOutfit = useMemo(() => outfit, [outfit]);
  // Create Item is open to every enrolled student in the class.
  const canCreateAi = Boolean(firestoreStudentId || studentId);
  const creatorStudentId = firestoreStudentId || studentId;

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
        classId={classId}
        classClosetItems={classClosetItems}
        canCreateAi={canCreateAi}
        creatorStudentId={creatorStudentId}
      />
    </>
  );
}
