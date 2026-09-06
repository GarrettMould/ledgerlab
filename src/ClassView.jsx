import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listStudents } from "./api";

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function colorForStudent(id, name) {
  const seed = String(id ?? name ?? "x")
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0) * 17, 0);
  const hue = (seed * 47) % 360;
  const sat = 48 + (seed % 16);
  const lightTop = 52 + (seed % 10);
  const lightBot = 32 + (seed % 8);
  return {
    background: `linear-gradient(165deg, hsl(${hue} ${sat}% ${lightTop}%), hsl(${(hue + 22) % 360} ${sat + 8}% ${lightBot}%))`,
  };
}

/**
 * Pack circles by area ∝ wealth. Largest first near center; others nest around
 * without overlap (simple greedy pack).
 */
function packBubbles(items, width, height) {
  if (!items.length || width <= 0 || height <= 0) return [];

  const maxWorth = Math.max(...items.map((i) => i.netWorth), 1);
  const minR = Math.min(width, height) * 0.045;
  const maxR = Math.min(width, height) * 0.22;

  const nodes = items
    .map((item) => {
      // Area ∝ wealth → radius ∝ sqrt(wealth)
      const t = Math.sqrt(Math.max(item.netWorth, 0) / maxWorth);
      const r = minR + t * (maxR - minR);
      return { ...item, r };
    })
    .sort((a, b) => b.r - a.r);

  const placed = [];
  const cx0 = width / 2;
  const cy0 = height / 2;

  function fits(x, y, r) {
    if (x - r < 8 || y - r < 8 || x + r > width - 8 || y + r > height - 8) {
      return false;
    }
    return placed.every((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const need = p.r + r + 6;
      return dx * dx + dy * dy >= need * need;
    });
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (i === 0) {
      placed.push({ ...node, x: cx0, y: cy0 });
      continue;
    }

    let best = null;
    let bestDist = Infinity;
    for (const p of placed) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
        const dist = p.r + node.r + 6;
        const x = p.x + Math.cos(angle) * dist;
        const y = p.y + Math.sin(angle) * dist;
        if (!fits(x, y, node.r)) continue;
        const d = (x - cx0) ** 2 + (y - cy0) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
    }

    if (!best) {
      // Spiral fallback if packing gets tight.
      for (let ring = 1; ring <= 40 && !best; ring += 1) {
        const rad = ring * (node.r * 0.55);
        const steps = Math.max(12, ring * 6);
        for (let s = 0; s < steps; s += 1) {
          const angle = (s / steps) * Math.PI * 2;
          const x = cx0 + Math.cos(angle) * rad;
          const y = cy0 + Math.sin(angle) * rad;
          if (!fits(x, y, node.r)) continue;
          best = { x, y };
          break;
        }
      }
    }

    placed.push({
      ...node,
      x: best?.x ?? cx0 + i * 4,
      y: best?.y ?? cy0 + i * 4,
    });
  }

  return placed;
}

export default function ClassView({ currentStudentId, onBack }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoverId, setHoverId] = useState(null);
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  const boardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await listStudents(true);
        if (!cancelled) setRoster(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load class standings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onBack]);

  const ranked = useMemo(() => {
    const rows = [...roster].map((s) => ({
      ...s,
      netWorth: Number(s.total_value) || 0,
    }));
    rows.sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name));
    return rows;
  }, [roster]);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    function measure() {
      const rect = el.getBoundingClientRect();
      setBoardSize({ w: rect.width, h: rect.height });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, ranked.length]);

  const bubbles = useMemo(
    () =>
      packBubbles(
        ranked.map((s, i) => ({
          id: s.id,
          name: s.name,
          netWorth: s.netWorth,
          rank: i + 1,
        })),
        boardSize.w,
        boardSize.h,
      ),
    [ranked, boardSize],
  );

  const classTotal = useMemo(
    () => ranked.reduce((s, r) => s + Math.max(0, r.netWorth), 0),
    [ranked],
  );

  const youRank = useMemo(() => {
    const idx = ranked.findIndex((s) => s.id === currentStudentId);
    return idx >= 0 ? idx + 1 : null;
  }, [ranked, currentStudentId]);

  const hover = bubbles.find((b) => b.id === hoverId) || null;

  const overlay = (
    <div className="standings-overlay" role="dialog" aria-modal="true" aria-label="Class standings">
      <div className="standings-topbar">
        <button
          type="button"
          className="standings-back"
          data-click="select"
          onClick={onBack}
          aria-label="Back to markets"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15.5 4.5 7.5 12l8 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="standings-title">
          <p className="standings-kicker">Class standings</p>
          <h2>
            Bigger circle = more wealth
            {youRank != null ? ` · You’re #${youRank}` : ""}
          </h2>
        </div>
        <p className="standings-total">
          {classTotal > 0 ? money(classTotal) : "—"}
          <span> class total</span>
        </p>
      </div>

      {loading && <p className="standings-empty">Loading the class…</p>}
      {error && <p className="standings-empty standings-error">{error}</p>}
      {!loading && !error && ranked.length === 0 && (
        <p className="standings-empty">No students on the roster yet.</p>
      )}

      {!loading && bubbles.length > 0 && (
        <div
          ref={boardRef}
          className="standings-board"
          role="list"
          aria-label="Student wealth bubbles"
          onMouseLeave={() => setHoverId(null)}
        >
          {bubbles.map((b, i) => {
            const isYou = b.id === currentStudentId;
            const colors = colorForStudent(b.id, b.name);
            const showLabel = b.r >= 42;
            const showWorth = b.r >= 56;
            return (
              <button
                key={b.id}
                type="button"
                role="listitem"
                className={[
                  "standings-bubble",
                  isYou ? "is-you" : "",
                  hoverId === b.id ? "is-hover" : "",
                  b.netWorth <= 0 ? "is-broke" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  width: b.r * 2,
                  height: b.r * 2,
                  left: b.x - b.r,
                  top: b.y - b.r,
                  background: colors.background,
                  animationDelay: `${i * 35}ms`,
                  zIndex: hoverId === b.id ? 5 : isYou ? 3 : 1,
                }}
                data-click="select"
                aria-label={`${b.name}, ${money(b.netWorth)}, rank ${b.rank}`}
                onMouseEnter={() => setHoverId(b.id)}
                onFocus={() => setHoverId(b.id)}
              >
                <span className="standings-bubble-rank">#{b.rank}</span>
                {showLabel ? (
                  <>
                    <strong>{isYou ? "You" : b.name.split(" ")[0]}</strong>
                    {showWorth && <span>{money(b.netWorth)}</span>}
                  </>
                ) : (
                  <strong className="standings-bubble-initials">{initials(b.name)}</strong>
                )}
              </button>
            );
          })}

          {hover && (
            <div
              className="standings-tip"
              style={{
                left: Math.min(boardSize.w - 200, Math.max(12, hover.x + hover.r + 10)),
                top: Math.min(boardSize.h - 120, Math.max(72, hover.y - 24)),
              }}
              role="tooltip"
            >
              <p className="standings-tip-kicker">
                #{hover.rank}
                {hover.id === currentStudentId ? " · you" : ""}
              </p>
              <strong>{hover.name}</strong>
              <span>{money(hover.netWorth)}</span>
              {classTotal > 0 && (
                <span className="standings-tip-share">
                  {((Math.max(0, hover.netWorth) / classTotal) * 100).toFixed(1)}% of class
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
