import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float } from "@react-three/drei";
import { createPortal } from "react-dom";
import { adjustCash } from "./api";

const DEFAULT_OUTFIT = {
  skin: "#e0b090",
  hair: "#3b2a1e",
  shirt: "#3f8f68",
  pants: "#1f3d30",
  shoes: "#2a241f",
  eyes: "#1a2e24",
  ownedLuxuries: [],
  sunglasses: null,
  purse: null,
  basketball: null,
  car: null,
};

const AVATAR_BASE_Y = -1.15;
const AVATAR_SCALE = 0.78;

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Free starter closet + paid luxuries. */
export const CLOSET_CATALOG = {
  shirt: [
    { id: "tee-forest", label: "Forest tee", color: "#3f8f68", price: 0 },
    { id: "tee-sky", label: "Sky blue", color: "#4a90a4", price: 0 },
    { id: "tee-sun", label: "Sun gold", color: "#c4a035", price: 0 },
    { id: "tee-berry", label: "Berry", color: "#a0455c", price: 0 },
    { id: "tee-ink", label: "Ink black", color: "#24312b", price: 0 },
    { id: "tee-cream", label: "Cloud white", color: "#eef6f0", price: 0 },
  ],
  pants: [
    { id: "pants-pine", label: "Pine jeans", color: "#1f3d30", price: 0 },
    { id: "pants-denim", label: "Denim", color: "#3d5a80", price: 0 },
    { id: "pants-khaki", label: "Khaki", color: "#8a7a4f", price: 0 },
    { id: "pants-slate", label: "Slate", color: "#4a5560", price: 0 },
  ],
  shoes: [
    { id: "shoes-brown", label: "Brown kicks", color: "#2a241f", price: 0 },
    { id: "shoes-white", label: "White sneakers", color: "#f2f5f3", price: 0 },
    { id: "shoes-red", label: "Red runners", color: "#b04040", price: 0 },
    { id: "shoes-navy", label: "Navy kicks", color: "#1e3a5f", price: 0 },
  ],
  hair: [
    { id: "hair-espresso", label: "Espresso", color: "#3b2a1e", price: 0 },
    { id: "hair-black", label: "Black", color: "#1f1a16", price: 0 },
    { id: "hair-copper", label: "Copper", color: "#6b4423", price: 0 },
    { id: "hair-sand", label: "Sandy", color: "#a67c52", price: 0 },
    { id: "hair-night", label: "Night blue", color: "#2c1810", price: 0 },
  ],
  luxury: [
    {
      id: "lux-shades",
      kind: "sunglasses",
      label: "Gold shades",
      color: "#1a1a1a",
      accent: "#d4af37",
      price: 2500,
    },
    {
      id: "lux-purse",
      kind: "purse",
      label: "Designer purse",
      color: "#8b2942",
      accent: "#d4af37",
      price: 8500,
    },
    {
      id: "lux-ball",
      kind: "basketball",
      label: "Pro basketball",
      color: "#c45c26",
      accent: "#1a1a1a",
      price: 1200,
    },
    {
      id: "lux-car",
      kind: "car",
      label: "Sports coupe",
      color: "#1e293b",
      accent: "#ef4444",
      price: 42000,
    },
  ],
};

const CLOSET_TABS = [
  { id: "shirt", label: "Tops" },
  { id: "pants", label: "Bottoms" },
  { id: "shoes", label: "Shoes" },
  { id: "hair", label: "Hair" },
  { id: "luxury", label: "Luxe" },
];

const SETUP_TABS = CLOSET_TABS.filter((t) => t.id !== "luxury");

function outfitStorageKey(studentId) {
  return `ledger-lab-outfit-${studentId ?? "guest"}`;
}

export function outfitForStudent(studentId, name) {
  const seed = String(studentId ?? name ?? "guest")
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const shirts = CLOSET_CATALOG.shirt;
  const hairs = CLOSET_CATALOG.hair;
  const skins = ["#e0b090", "#c68a5c", "#f0c9a8", "#8d5524", "#d4a574"];
  return {
    ...DEFAULT_OUTFIT,
    shirt: shirts[seed % shirts.length].color,
    hair: hairs[seed % hairs.length].color,
    skin: skins[seed % skins.length],
    shirtId: shirts[seed % shirts.length].id,
    pantsId: "pants-pine",
    shoesId: "shoes-brown",
    hairId: hairs[seed % hairs.length].id,
    ownedLuxuries: [],
    sunglasses: null,
    purse: null,
    basketball: null,
    car: null,
  };
}

export function loadSavedOutfit(studentId, name) {
  const base = outfitForStudent(studentId, name);
  try {
    const raw = localStorage.getItem(outfitStorageKey(studentId));
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      ...base,
      ...saved,
      ownedLuxuries: Array.isArray(saved.ownedLuxuries) ? saved.ownedLuxuries : [],
    };
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

function LuxuryProps({ outfit }) {
  const shades = CLOSET_CATALOG.luxury.find((i) => i.id === outfit.sunglasses);
  const purse = CLOSET_CATALOG.luxury.find((i) => i.id === outfit.purse);
  const ball = CLOSET_CATALOG.luxury.find((i) => i.id === outfit.basketball);
  const car = CLOSET_CATALOG.luxury.find((i) => i.id === outfit.car);

  return (
    <>
      {shades && (
        <group position={[0, 1.6, 0.28]}>
          <mesh position={[-0.09, 0, 0.02]}>
            <boxGeometry args={[0.12, 0.055, 0.04]} />
            <meshStandardMaterial color={shades.color} metalness={0.4} roughness={0.25} />
          </mesh>
          <mesh position={[0.09, 0, 0.02]}>
            <boxGeometry args={[0.12, 0.055, 0.04]} />
            <meshStandardMaterial color={shades.color} metalness={0.4} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.02, 0.01]}>
            <boxGeometry args={[0.08, 0.02, 0.02]} />
            <meshStandardMaterial color={shades.accent} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      )}

      {purse && (
        <group position={[-0.55, 0.72, 0.12]} rotation={[0.1, 0.2, 0.15]}>
          <mesh>
            <boxGeometry args={[0.22, 0.28, 0.1]} />
            <meshStandardMaterial color={purse.color} roughness={0.45} metalness={0.15} />
          </mesh>
          <mesh position={[0, 0.16, 0]}>
            <torusGeometry args={[0.08, 0.015, 8, 16, Math.PI]} />
            <meshStandardMaterial color={purse.accent} metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      )}

      {ball && (
        <mesh position={[0.58, 0.55, 0.12]} castShadow>
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshStandardMaterial color={ball.color} roughness={0.7} />
        </mesh>
      )}

      {car && (
        <group position={[1.15, 0.22, 0.05]} scale={0.85}>
          <mesh position={[0, 0.12, 0]} castShadow>
            <boxGeometry args={[0.85, 0.22, 0.42]} />
            <meshStandardMaterial color={car.color} metalness={0.55} roughness={0.3} />
          </mesh>
          <mesh position={[0.05, 0.28, 0]} castShadow>
            <boxGeometry args={[0.45, 0.18, 0.38]} />
            <meshStandardMaterial color={car.color} metalness={0.5} roughness={0.32} />
          </mesh>
          <mesh position={[0.22, 0.3, 0.2]}>
            <boxGeometry args={[0.18, 0.1, 0.02]} />
            <meshStandardMaterial color="#7ec8e3" metalness={0.2} roughness={0.15} />
          </mesh>
          <mesh position={[-0.28, 0.02, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.08, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0.28, 0.02, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.08, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[-0.28, 0.02, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.08, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0.28, 0.02, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.08, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[-0.4, 0.12, 0]}>
            <boxGeometry args={[0.06, 0.06, 0.28]} />
            <meshStandardMaterial color={car.accent} emissive={car.accent} emissiveIntensity={0.35} />
          </mesh>
        </group>
      )}
    </>
  );
}

function AvatarModel({ outfit, waving, spin = false }) {
  const group = useRef();
  const armR = useRef();

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (group.current) {
      group.current.rotation.y = spin
        ? t * 0.35
        : Math.sin(t * 0.55) * 0.18;
      group.current.position.y = AVATAR_BASE_Y + Math.sin(t * 1.4) * 0.025;
    }
    if (armR.current && waving) {
      armR.current.rotation.z = -0.35 + Math.sin(t * 4.2) * 0.45;
    }
  });

  return (
    <group ref={group} position={[0, AVATAR_BASE_Y, 0]} scale={AVATAR_SCALE}>
      <Limb args={[0.28, 0.55, 0.28]} position={[-0.18, 0.35, 0]} color={outfit.pants} />
      <Limb args={[0.28, 0.55, 0.28]} position={[0.18, 0.35, 0]} color={outfit.pants} />
      <Limb args={[0.32, 0.14, 0.4]} position={[-0.18, 0.05, 0.04]} color={outfit.shoes} />
      <Limb args={[0.32, 0.14, 0.4]} position={[0.18, 0.05, 0.04]} color={outfit.shoes} />
      <Limb args={[0.7, 0.75, 0.42]} position={[0, 0.95, 0]} color={outfit.shirt} />
      <Limb
        args={[0.22, 0.62, 0.22]}
        position={[-0.48, 0.92, 0]}
        rotation={[0, 0, 0.18]}
        color={outfit.skin}
      />
      <group ref={armR} position={[0.48, 1.18, 0]}>
        <Limb
          args={[0.22, 0.62, 0.22]}
          position={[0, -0.26, 0]}
          rotation={[0, 0, -0.18]}
          color={outfit.skin}
        />
      </group>
      <mesh position={[0, 1.58, 0]} castShadow>
        <sphereGeometry args={[0.34, 24, 24]} />
        <meshStandardMaterial color={outfit.skin} roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.78, -0.02]} castShadow>
        <sphereGeometry args={[0.3, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color={outfit.hair} roughness={0.9} />
      </mesh>
      <mesh position={[-0.1, 1.6, 0.3]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color={outfit.eyes} />
      </mesh>
      <mesh position={[0.1, 1.6, 0.3]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color={outfit.eyes} />
      </mesh>
      <mesh position={[0, 1.48, 0.3]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.08, 0.015, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#b86b5a" />
      </mesh>
      <LuxuryProps outfit={outfit} />
    </group>
  );
}

function CameraRig({ mode, hasCar }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    if (mode === "closet") {
      camera.position.set(hasCar ? 0.35 : 0, 0.2, hasCar ? 3.6 : 3.2);
      camera.lookAt(hasCar ? 0.25 : 0, -0.05, 0);
    } else {
      camera.position.set(hasCar ? 0.2 : 0, 0.15, hasCar ? 3.9 : 3.6);
      camera.lookAt(hasCar ? 0.15 : 0, -0.15, 0);
    }
    camera.updateProjectionMatrix();
  }, [camera, mode, hasCar]);
  return null;
}

function Scene({ outfit, mode = "thumb" }) {
  const hasCar = Boolean(outfit.car);
  return (
    <>
      <CameraRig mode={mode} hasCar={hasCar} />
      <ambientLight intensity={0.75} />
      <directionalLight
        position={[2.5, 4, 2]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2, 2, -1]} intensity={0.35} color="#9fd4a8" />
      <Float
        speed={mode === "closet" ? 0.9 : 1.2}
        rotationIntensity={mode === "closet" ? 0.05 : 0.12}
        floatIntensity={mode === "closet" ? 0.12 : 0.18}
      >
        <AvatarModel outfit={outfit} waving={mode !== "closet"} spin={mode === "closet"} />
      </Float>
      <ContactShadows
        position={[0, -1.35, 0]}
        opacity={0.32}
        scale={hasCar ? 4.2 : 3.2}
        blur={2.4}
        far={2.5}
      />
    </>
  );
}

function AvatarCanvas({ outfit, mode, className }) {
  return (
    <div className={className}>
      <Canvas
        camera={{
          position: mode === "closet" ? [0, 0.2, 3.2] : [0, 0.15, 3.6],
          fov: mode === "closet" ? 34 : 32,
          near: 0.1,
          far: 50,
        }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Scene outfit={outfit} mode={mode} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function ClosetShelf({
  tab,
  items,
  outfit,
  onSelectClothing,
  onSelectLuxury,
  cash = 0,
  buyingId = null,
}) {
  const owned = new Set(outfit.ownedLuxuries || []);

  if (tab === "luxury") {
    return (
      <div className="closet-shelf" role="tabpanel">
        {items.map((item) => {
          const isOwned = owned.has(item.id);
          const isEquipped = outfit[item.kind] === item.id;
          const canAfford = Number(cash) + 0.0001 >= item.price;
          let status = money(item.price);
          if (isEquipped) status = "Equipped";
          else if (isOwned) status = "Tap to equip";
          else if (!canAfford) status = `Need ${money(item.price)}`;
          else status = `Buy · ${money(item.price)}`;

          return (
            <button
              key={item.id}
              type="button"
              className={[
                "closet-item",
                "closet-item-luxury",
                isEquipped ? "selected" : "",
                !isOwned && !canAfford ? "is-locked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-click="confirm"
              disabled={buyingId === item.id || (!isOwned && !canAfford)}
              onClick={() => onSelectLuxury(item)}
            >
              <span
                className="closet-swatch closet-swatch-luxury"
                style={{
                  background: `linear-gradient(145deg, ${item.accent}, ${item.color})`,
                }}
                aria-hidden="true"
              />
              <span className="closet-item-copy">
                <strong>{item.label}</strong>
                <span>{buyingId === item.id ? "Buying…" : status}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  const selectedId = outfit[`${tab}Id`];
  return (
    <div className="closet-shelf" role="tabpanel">
      {items.map((item) => {
        const active = selectedId === item.id || outfit[tab] === item.color;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "closet-item selected" : "closet-item"}
            data-click="confirm"
            onClick={() => onSelectClothing(item)}
          >
            <span
              className="closet-swatch"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <span className="closet-item-copy">
              <strong>{item.label}</strong>
              <span>{item.price > 0 ? money(item.price) : "Owned"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Inline closet for join/onboarding (not a modal). */
export function AvatarSetupPanel({ outfit, onChangeOutfit, studentName }) {
  const [tab, setTab] = useState("shirt");
  const items = CLOSET_CATALOG[tab] || [];

  return (
    <div className="avatar-setup">
      <div className="closet-body closet-body-inline">
        <aside className="closet-rail" aria-label="Clothing options">
          <div className="closet-tabs" role="tablist">
            {SETUP_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "closet-tab active" : "closet-tab"}
                data-click="select"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ClosetShelf
            tab={tab}
            items={items}
            outfit={outfit}
            onSelectClothing={(item) =>
              onChangeOutfit({
                ...outfit,
                [tab]: item.color,
                [`${tab}Id`]: item.id,
              })
            }
            onSelectLuxury={() => {}}
          />
        </aside>

        <div className="closet-preview">
          <AvatarCanvas outfit={outfit} mode="closet" className="closet-stage" />
          <p className="closet-hint">
            {studentName ? `${studentName}'s look` : "Pick your look"} — unlock Luxe items later with cash
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
  const [tab, setTab] = useState("shirt");
  const [buyingId, setBuyingId] = useState(null);
  const [shopError, setShopError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setShopError("");
  }, [open, tab]);

  if (!open) return null;

  const items = CLOSET_CATALOG[tab] || [];

  async function handleLuxury(item) {
    const owned = new Set(outfit.ownedLuxuries || []);
    setShopError("");

    if (owned.has(item.id)) {
      const equipped = outfit[item.kind] === item.id;
      onChangeOutfit({
        ...outfit,
        [item.kind]: equipped ? null : item.id,
      });
      return;
    }

    if (!studentId) {
      setShopError("Sign in to a class portfolio to buy luxuries.");
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
      onChangeOutfit({
        ...outfit,
        ownedLuxuries: [...(outfit.ownedLuxuries || []), item.id],
        [item.kind]: item.id,
      });
    } catch (err) {
      setShopError(err.message || "Could not complete purchase");
    } finally {
      setBuyingId(null);
    }
  }

  const modal = (
    <div className="closet-overlay" onClick={onClose} role="presentation">
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
          <button type="button" className="closet-close" data-click="select" onClick={onClose} aria-label="Close closet">
            ×
          </button>
        </header>

        <div className="closet-body">
          <aside className="closet-rail" aria-label="Clothing options">
            <div className="closet-tabs" role="tablist">
              {CLOSET_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? "closet-tab active" : "closet-tab"}
                  data-click="select"
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <ClosetShelf
              tab={tab}
              items={items}
              outfit={outfit}
              cash={cash}
              buyingId={buyingId}
              onSelectClothing={(item) =>
                onChangeOutfit({
                  ...outfit,
                  [tab]: item.color,
                  [`${tab}Id`]: item.id,
                })
              }
              onSelectLuxury={handleLuxury}
            />

            {shopError ? (
              <p className="closet-note closet-note-error">{shopError}</p>
            ) : (
              <p className="closet-note">
                {tab === "luxury"
                  ? "Buy with classroom cash — tap again to unequip."
                  : "Free fits anytime. Luxe costs cash from your account."}
              </p>
            )}
          </aside>

          <div className="closet-preview">
            <AvatarCanvas outfit={outfit} mode="closet" className="closet-stage" />
            <p className="closet-hint">Try things on — your look saves automatically</p>
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
        <AvatarCanvas outfit={displayOutfit} mode="thumb" className="character-stage" />
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
