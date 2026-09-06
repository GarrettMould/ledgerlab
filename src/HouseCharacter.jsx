import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Float } from "@react-three/drei";

const DEFAULT_HOUSE = {
  walls: "#f3efe6",
  trim: "#e7e0d4",
  roof: "#2f6b4f",
  door: "#1f4a36",
  window: "#cfe8ef",
  frame: "#5c5348",
};

/**
 * Fixed look per city — same house “character,” different roof + door combos.
 * Not user-customizable.
 */
export const CITY_HOUSE_STYLES = {
  "FL-MIA": {
    walls: "#f7f1e8",
    trim: "#efe6d8",
    roof: "#c45c3a",
    door: "#0e7490",
    window: "#d7f0f5",
    frame: "#6b5b4b",
  },
  "FL-FLL": {
    walls: "#f4efe8",
    trim: "#ebe3d7",
    roof: "#d4785a",
    door: "#1e3a5f",
    window: "#dceaf3",
    frame: "#5a5046",
  },
  "FL-TPA": {
    walls: "#f6f3ea",
    trim: "#ece6da",
    roof: "#4a6b8a",
    door: "#3f8f68",
    window: "#e0eef5",
    frame: "#5c5348",
  },
  "FL-ORL": {
    walls: "#f8f4ec",
    trim: "#efe8dc",
    roof: "#c4a035",
    door: "#6b3d6e",
    window: "#e8f2f6",
    frame: "#6a5d4f",
  },
  "FL-JAX": {
    walls: "#f2eee6",
    trim: "#e6dfd3",
    roof: "#24553e",
    door: "#6b4423",
    window: "#d9ebe8",
    frame: "#4f463c",
  },
  "FL-NAP": {
    walls: "#faf8f3",
    trim: "#f0ebe2",
    roof: "#b85c38",
    door: "#b0892e",
    window: "#eaf4f7",
    frame: "#7a6c5a",
  },
  "FL-TLH": {
    walls: "#f1ebe3",
    trim: "#e5ddd2",
    roof: "#8b3a2f",
    door: "#1f3d30",
    window: "#dde8e4",
    frame: "#5a4f45",
  },
  "FL-PNS": {
    walls: "#f5f7f8",
    trim: "#e8eef0",
    roof: "#3d7a8c",
    door: "#f2f5f3",
    window: "#d5eaf0",
    frame: "#5a6570",
  },
};

export function houseStyleForCity(ticker) {
  return CITY_HOUSE_STYLES[ticker] || DEFAULT_HOUSE;
}

function Block({ args, position, rotation, color, roughness = 0.62 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={0.04} />
    </mesh>
  );
}

function HouseModel({ style }) {
  const group = useRef();
  const look = { ...DEFAULT_HOUSE, ...style };

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (!group.current) return;
    group.current.rotation.y = 0.35 + Math.sin(t * 0.55) * 0.16;
    group.current.position.y = -0.55 + Math.sin(t * 1.35) * 0.025;
  });

  return (
    <group ref={group} position={[0, -0.55, 0]} scale={0.95}>
      {/* foundation */}
      <Block args={[1.35, 0.12, 1.15]} position={[0, 0.06, 0]} color={look.trim} />

      {/* walls */}
      <Block args={[1.25, 1.05, 1.05]} position={[0, 0.64, 0]} color={look.walls} />

      {/* roof (pyramid-ish via square cone) */}
      <mesh position={[0, 1.42, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.98, 0.62, 4]} />
        <meshStandardMaterial color={look.roof} roughness={0.78} metalness={0.05} />
      </mesh>

      {/* chimney */}
      <Block args={[0.18, 0.38, 0.18]} position={[0.38, 1.55, -0.18]} color={look.frame} />

      {/* door */}
      <Block args={[0.32, 0.58, 0.08]} position={[0, 0.41, 0.54]} color={look.door} />
      <mesh position={[0.1, 0.4, 0.59]}>
        <sphereGeometry args={[0.03, 10, 10]} />
        <meshStandardMaterial color="#c4a035" roughness={0.35} metalness={0.4} />
      </mesh>

      {/* windows */}
      <Block args={[0.28, 0.28, 0.06]} position={[-0.34, 0.78, 0.54]} color={look.window} roughness={0.35} />
      <Block args={[0.28, 0.28, 0.06]} position={[0.34, 0.78, 0.54]} color={look.window} roughness={0.35} />
      <Block args={[0.3, 0.04, 0.07]} position={[-0.34, 0.78, 0.55]} color={look.frame} />
      <Block args={[0.04, 0.3, 0.07]} position={[-0.34, 0.78, 0.55]} color={look.frame} />
      <Block args={[0.3, 0.04, 0.07]} position={[0.34, 0.78, 0.55]} color={look.frame} />
      <Block args={[0.04, 0.3, 0.07]} position={[0.34, 0.78, 0.55]} color={look.frame} />

      {/* side window */}
      <Block args={[0.06, 0.26, 0.26]} position={[0.63, 0.72, 0.1]} color={look.window} roughness={0.35} />
    </group>
  );
}

function HouseScene({ style }) {
  return (
    <>
      <ambientLight intensity={0.78} />
      <directionalLight
        position={[2.4, 4.2, 2.2]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2.2, 1.8, -1]} intensity={0.35} color="#9fd4a8" />
      <Float speed={1.15} rotationIntensity={0.08} floatIntensity={0.16}>
        <HouseModel style={style} />
      </Float>
      <ContactShadows
        position={[0, -1.15, 0]}
        opacity={0.3}
        scale={3.4}
        blur={2.3}
        far={2.6}
      />
    </>
  );
}

export default function HouseCharacter({
  ticker,
  style,
  className = "house-character-stage",
}) {
  const look = style || houseStyleForCity(ticker);

  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [1.15, 0.55, 3.35], fov: 34, near: 0.1, far: 40 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <HouseScene style={look} />
        </Suspense>
      </Canvas>
    </div>
  );
}
