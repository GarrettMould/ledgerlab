import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Float } from "@react-three/drei";
import * as THREE from "three";

const OCEAN = "#2f7ea3";
const STAND = "#5c5348";
const STAND_LIGHT = "#7a6c5a";
const BASE = "#efe8dc";
const BASE_EDGE = "#ddd2c2";
const RING = "#c9b896";
const BRASS = "#b0892e";

const R = 0.72;

function Block({ args, position, rotation, color, roughness = 0.62, metalness = 0.04 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** Soft filled ellipse on an equirectangular canvas (flat land pattern). */
function fillBlob(ctx, x, y, rx, ry, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw a flat classroom-style world map onto a canvas texture. */
function buildGlobeTexture() {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Ocean base
  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#3a92b5");
  ocean.addColorStop(0.5, "#2f7ea3");
  ocean.addColorStop(1, "#276d8f");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // Soft shallow-water bands
  ctx.fillStyle = "rgba(90, 180, 205, 0.12)";
  ctx.fillRect(0, h * 0.18, w, h * 0.12);
  ctx.fillRect(0, h * 0.68, w, h * 0.12);

  // Helper: lon/lat → canvas px (equirectangular)
  const px = (lon, lat) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];

  const land = (lon, lat, rx, ry, color = "#3d8f62", alpha = 1) => {
    const [x, y] = px(lon, lat);
    fillBlob(ctx, x, y, rx * (w / 360), ry * (h / 180), color, alpha);
  };

  // ——— Continents (flat stylized blobs) ———
  // North America
  land(-100, 48, 38, 22, "#3d8f62");
  land(-110, 58, 28, 14, "#2f6b4f");
  land(-95, 38, 32, 16, "#4a9a6a");
  land(-85, 30, 18, 10, "#3d8f62");
  land(-120, 50, 16, 10, "#2f6b4f");
  // Central / South America
  land(-90, 15, 12, 10, "#5aa56e");
  land(-65, 0, 16, 18, "#2f6b4f");
  land(-58, -18, 20, 22, "#3d8f62");
  land(-65, -35, 12, 14, "#c4a35a");
  land(-70, -48, 8, 8, "#b8974e");
  // Europe
  land(10, 54, 16, 10, "#4a9a6a");
  land(20, 48, 14, 9, "#3d8f62");
  land(15, 62, 10, 7, "#5aa56e");
  // Africa
  land(15, 18, 20, 16, "#c4a35a");
  land(20, 5, 22, 18, "#3d8f62");
  land(25, -18, 16, 14, "#2f6b4f");
  land(5, 28, 14, 8, "#d2b06a");
  // Middle East / India
  land(45, 28, 12, 9, "#c4a35a");
  land(78, 22, 16, 12, "#5aa56e");
  // Asia
  land(90, 55, 30, 14, "#3d8f62");
  land(110, 45, 26, 14, "#2f6b4f");
  land(105, 35, 22, 12, "#4a9a6a");
  land(120, 60, 20, 10, "#3d8f62");
  land(105, 15, 14, 12, "#3d8f62");
  land(115, 5, 12, 10, "#2f6b4f");
  land(138, 38, 8, 8, "#4a9a6a");
  // Australia
  land(135, -25, 22, 12, "#c4a35a");
  land(145, -32, 10, 8, "#b8974e");
  // Greenland
  land(-40, 72, 16, 10, "#e8f2f6");

  // Polar ice caps (flat bands + blobs)
  const iceGradTop = ctx.createLinearGradient(0, 0, 0, h * 0.14);
  iceGradTop.addColorStop(0, "rgba(242, 247, 250, 0.95)");
  iceGradTop.addColorStop(1, "rgba(242, 247, 250, 0)");
  ctx.fillStyle = iceGradTop;
  ctx.fillRect(0, 0, w, h * 0.14);

  const iceGradBot = ctx.createLinearGradient(0, h, 0, h * 0.86);
  iceGradBot.addColorStop(0, "rgba(242, 247, 250, 0.95)");
  iceGradBot.addColorStop(1, "rgba(242, 247, 250, 0)");
  ctx.fillStyle = iceGradBot;
  ctx.fillRect(0, h * 0.86, w, h * 0.14);

  // Soft cloud dabs (flat, translucent)
  const clouds = [
    [-40, 20, 28, 8],
    [60, 10, 24, 7],
    [160, -10, 30, 8],
    [-150, 40, 20, 6],
    [10, -25, 22, 7],
    [-120, 5, 18, 6],
  ];
  for (const [lon, lat, rx, ry] of clouds) {
    land(lon, lat, rx, ry, "#ffffff", 0.28);
  }

  // Latitude / meridian line pattern (flat ink)
  ctx.strokeStyle = "rgba(215, 238, 245, 0.28)";
  ctx.lineWidth = 1.5;
  for (const lat of [-60, -30, 0, 30, 60]) {
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(215, 238, 245, 0.18)";
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = ((lon + 180) / 360) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Subtle vignette for roundness read
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(15, 50, 70, 0.12)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function GlobeBody() {
  const spin = useRef();
  const map = useMemo(() => buildGlobeTexture(), []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (!spin.current) return;
    spin.current.rotation.y = t * 0.38;
    spin.current.rotation.x = 0.22 + Math.sin(t * 0.28) * 0.03;
  });

  return (
    <group ref={spin}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[R, 48, 32]} />
        <meshStandardMaterial
          map={map}
          roughness={0.48}
          metalness={0.08}
        />
      </mesh>
      {/* Soft atmosphere shell — still flat, no land relief */}
      <mesh scale={1.045}>
        <sphereGeometry args={[R, 32, 24]} />
        <meshStandardMaterial
          color="#9fd4e8"
          roughness={1}
          metalness={0}
          transparent
          opacity={0.14}
          depthWrite={false}
        />
      </mesh>
      {/* Axis pin + rod */}
      <mesh position={[0, R + 0.05, 0]}>
        <sphereGeometry args={[0.042, 10, 8]} />
        <meshStandardMaterial color={BRASS} roughness={0.32} metalness={0.55} />
      </mesh>
      <mesh position={[0, -(R + 0.05), 0]}>
        <sphereGeometry args={[0.042, 10, 8]} />
        <meshStandardMaterial color={BRASS} roughness={0.32} metalness={0.55} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.01, 0.01, R * 2 + 0.12, 8]} />
        <meshStandardMaterial color={BRASS} roughness={0.35} metalness={0.5} />
      </mesh>
    </group>
  );
}

function GlobeStand() {
  return (
    <group>
      <Block args={[0.88, 0.08, 0.88]} position={[0, -1.02, 0]} color={BASE} />
      <Block
        args={[0.78, 0.05, 0.78]}
        position={[0, -0.96, 0]}
        color={BASE_EDGE}
        roughness={0.7}
      />
      <mesh position={[0, -0.78, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.16, 0.32, 12]} />
        <meshStandardMaterial color={STAND} roughness={0.68} metalness={0.1} />
      </mesh>
      <mesh position={[0, -0.58, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.14, 10]} />
        <meshStandardMaterial color={STAND_LIGHT} roughness={0.55} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <torusGeometry args={[R + 0.04, 0.028, 8, 40, Math.PI]} />
        <meshStandardMaterial color={RING} roughness={0.4} metalness={0.28} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[R + 0.04, 0.022, 8, 40, Math.PI]} />
        <meshStandardMaterial color={RING} roughness={0.42} metalness={0.25} />
      </mesh>
      <mesh position={[0, -0.48, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={BRASS} roughness={0.3} metalness={0.55} />
      </mesh>
    </group>
  );
}

function GlobeModel() {
  return (
    <group position={[0, -0.08, 0]} scale={1.02}>
      <GlobeStand />
      <group position={[0, 0.08, 0]}>
        <GlobeBody />
      </group>
    </group>
  );
}

function GlobeScene() {
  return (
    <>
      <ambientLight intensity={0.78} />
      <directionalLight
        position={[2.8, 4.0, 2.2]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-2.6, 1.4, -1.4]} intensity={0.42} color="#9fd4c8" />
      <directionalLight position={[0.2, -1.2, 2]} intensity={0.22} color="#ffe6b8" />
      <Float speed={1.05} rotationIntensity={0.05} floatIntensity={0.12}>
        <GlobeModel />
      </Float>
      <ContactShadows
        position={[0, -1.18, 0]}
        opacity={0.3}
        scale={3.4}
        blur={2.15}
        far={2.5}
      />
    </>
  );
}

export default function GlobeCharacter({ className = "globe-character-stage" }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [1.45, 0.62, 3.05], fov: 33, near: 0.1, far: 40 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <GlobeScene />
        </Suspense>
      </Canvas>
    </div>
  );
}
