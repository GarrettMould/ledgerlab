import { Component, Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, useGLTF } from "@react-three/drei";

class PreviewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}

function degToRad(d) {
  return ((Number(d) || 0) * Math.PI) / 180;
}

function partRotationRad(rot) {
  if (!Array.isArray(rot) || rot.length < 3) return [0, 0, 0];
  const vals = [0, 1, 2].map((i) => Number(rot[i]) || 0);
  const maxAbs = Math.max(...vals.map((v) => Math.abs(v)));
  if (maxAbs > Math.PI + 0.05) return vals.map(degToRad);
  return vals;
}

function BlockyPartsModel({ parts, yOffset = 0 }) {
  const safe = Array.isArray(parts) ? parts.slice(0, 24) : [];
  if (!safe.length) return null;
  return (
    <group position={[0, yOffset, 0]} scale={0.85}>
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
            <mesh key={key} position={pos} rotation={rot}>
              <cylinderGeometry args={[r2, r, h, 12]} />
              <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
            </mesh>
          );
        }
        if (part.shape === "sphere") {
          const r = Math.max(0.05, Number(part.radius) || 0.25);
          const sc = Array.isArray(part.scale) ? part.scale : [1, 1, 1];
          return (
            <mesh key={key} position={pos} rotation={rot} scale={sc}>
              <sphereGeometry args={[r, 12, 10]} />
              <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
            </mesh>
          );
        }
        const size = Array.isArray(part.size) ? part.size : [0.4, 0.4, 0.4];
        return (
          <mesh key={key} position={pos} rotation={rot}>
            <boxGeometry args={[size[0] || 0.4, size[1] || 0.4, size[2] || 0.4]} />
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
          </mesh>
        );
      })}
    </group>
  );
}

function GlbPreviewModel({ url, yOffset = 0 }) {
  const bust = useMemo(() => {
    const sep = String(url).includes("?") ? "&" : "?";
    return `${url}${sep}v=review`;
  }, [url]);
  const { scene } = useGLTF(bust);
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
      <group ref={group} position={[0, yOffset, 0]} scale={0.95}>
        <primitive object={cloned} />
      </group>
    </Float>
  );
}

function PreviewCanvas({ children, cameraY = 1.15 }) {
  return (
    <Canvas
      camera={{ position: [1.6, cameraY, 2.1], fov: 36, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[2.5, 3.5, 2]} intensity={1.2} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.4} color="#9fd4a8" />
      <Suspense fallback={null}>{children}</Suspense>
    </Canvas>
  );
}

/**
 * Teacher-review media: thumbnail image if present, else blocky parts / GLB.
 */
export default function ClosetReviewPreview({
  thumbnailUrl = "",
  glbUrl = "",
  parts = [],
  label = "Item",
  className = "closet-review-preview",
  /** Shift the product lower in the preview frame (job board thumbs). */
  lowerInFrame = false,
}) {
  const hasParts = Array.isArray(parts) && parts.length > 0;
  const thumb = String(thumbnailUrl || "").trim();
  const glb = String(glbUrl || "").trim();
  const yOffset = lowerInFrame ? -0.45 : 0;
  const cameraY = lowerInFrame ? 0.85 : 1.15;
  const frameClass = lowerInFrame ? `${className} is-lower` : className;

  if (thumb) {
    return (
      <div className={frameClass}>
        <img src={thumb} alt={`Preview of ${label}`} />
      </div>
    );
  }

  if (hasParts) {
    return (
      <div className={frameClass} aria-label={`3D preview of ${label}`}>
        <PreviewBoundary fallback={<p className="closet-review-preview-empty">Preview unavailable</p>}>
          <PreviewCanvas cameraY={cameraY}>
            <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.3}>
              <BlockyPartsModel parts={parts} yOffset={yOffset} />
            </Float>
          </PreviewCanvas>
        </PreviewBoundary>
      </div>
    );
  }

  if (glb) {
    return (
      <div className={frameClass} aria-label={`3D preview of ${label}`}>
        <PreviewBoundary fallback={<p className="closet-review-preview-empty">Preview unavailable</p>}>
          <PreviewCanvas cameraY={cameraY}>
            <GlbPreviewModel url={glb} yOffset={yOffset} />
          </PreviewCanvas>
        </PreviewBoundary>
      </div>
    );
  }

  return (
    <div className={`${frameClass} is-empty`}>
      <p className="closet-review-preview-empty">No preview</p>
    </div>
  );
}
