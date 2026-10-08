import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { askAdvisorChat } from "./api";
import { formatContestLabel } from "./contestDates";

const SKIN = "#e0b090";
const SUIT = "#1f3a68";
const SUIT_DARK = "#172c50";
const PANTS = "#2b3442";
const HAIR = "#9a9590";

function Box({ args, position, rotation, color, metalness = 0, roughness = 0.6 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}

/** Blocky (Roblox-style) financial advisor: suit, tie, glasses, briefcase. */
function AdvisorFigure({ animate = true }) {
  const root = useRef();
  const head = useRef();
  const waveArm = useRef();

  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.getElapsedTime();
    if (root.current) {
      root.current.position.y = Math.sin(t * 1.6) * 0.025;
      root.current.rotation.y = Math.sin(t * 0.55) * 0.22;
    }
    if (head.current) {
      head.current.rotation.x = Math.sin(t * 1.1) * 0.05;
      head.current.rotation.z = Math.sin(t * 0.8) * 0.04;
    }
    if (waveArm.current) {
      // Short friendly wave every ~4s.
      const phase = t % 4;
      const waving = phase < 1.2;
      const target = waving ? 2.55 + Math.sin(phase * 11) * 0.28 : 0.08;
      waveArm.current.rotation.z += (target - waveArm.current.rotation.z) * 0.12;
    }
  });

  return (
    <group ref={root}>
      {/* Legs + shoes */}
      <Box args={[0.48, 1.05, 0.5]} position={[-0.27, -1.62, 0]} color={PANTS} />
      <Box args={[0.48, 1.05, 0.5]} position={[0.27, -1.62, 0]} color={PANTS} />
      <Box args={[0.5, 0.2, 0.62]} position={[-0.27, -2.2, 0.06]} color="#14110f" roughness={0.35} />
      <Box args={[0.5, 0.2, 0.62]} position={[0.27, -2.2, 0.06]} color="#14110f" roughness={0.35} />

      {/* Torso: suit jacket */}
      <Box args={[1.1, 1.15, 0.56]} position={[0, -0.52, 0]} color={SUIT} roughness={0.5} />
      {/* Shirt V + tie */}
      <Box args={[0.34, 0.62, 0.02]} position={[0, -0.24, 0.29]} color="#f5f7fb" roughness={0.7} />
      <Box args={[0.13, 0.12, 0.03]} position={[0, -0.02, 0.305]} color="#b8322a" roughness={0.4} />
      <Box args={[0.16, 0.5, 0.03]} position={[0, -0.33, 0.305]} rotation={[0, 0, 0]} color="#c0453a" roughness={0.4} />
      {/* Lapels */}
      <Box args={[0.14, 0.62, 0.03]} position={[-0.2, -0.24, 0.3]} rotation={[0, 0, -0.32]} color={SUIT_DARK} />
      <Box args={[0.14, 0.62, 0.03]} position={[0.2, -0.24, 0.3]} rotation={[0, 0, 0.32]} color={SUIT_DARK} />
      {/* Pocket square + gold pin */}
      <Box args={[0.16, 0.07, 0.03]} position={[0.36, -0.36, 0.295]} color="#f0d078" metalness={0.3} roughness={0.4} />
      <mesh position={[-0.33, -0.2, 0.31]}>
        <cylinderGeometry args={[0.045, 0.045, 0.03, 16]} />
        <meshStandardMaterial color="#d4ad35" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Buttons */}
      <Box args={[0.06, 0.06, 0.02]} position={[0, -0.72, 0.29]} color="#0c1a33" />
      <Box args={[0.06, 0.06, 0.02]} position={[0, -0.9, 0.29]} color="#0c1a33" />

      {/* Right arm (holds briefcase) */}
      <group position={[0.72, -0.05, 0]}>
        <Box args={[0.34, 1.0, 0.42]} position={[0, -0.45, 0]} color={SUIT} roughness={0.5} />
        <Box args={[0.3, 0.22, 0.36]} position={[0, -1.03, 0]} color={SKIN} />
        {/* Briefcase */}
        <group position={[0.02, -1.38, 0.05]}>
          <Box args={[0.62, 0.46, 0.18]} position={[0, -0.12, 0]} color="#6b4423" roughness={0.45} />
          <Box args={[0.64, 0.05, 0.2]} position={[0, 0.0, 0]} color="#4f3119" />
          <Box args={[0.22, 0.08, 0.06]} position={[0, 0.15, 0]} color="#3b2414" />
          <Box args={[0.08, 0.07, 0.03]} position={[0, -0.04, 0.1]} color="#d4ad35" metalness={0.9} roughness={0.2} />
        </group>
      </group>

      {/* Left arm (waves) — pivot at the shoulder */}
      <group ref={waveArm} position={[-0.72, -0.05, 0]} rotation={[0, 0, 0.08]}>
        <Box args={[0.34, 1.0, 0.42]} position={[0, -0.45, 0]} color={SUIT} roughness={0.5} />
        <Box args={[0.3, 0.22, 0.36]} position={[0, -1.03, 0]} color={SKIN} />
      </group>

      {/* Neck + head */}
      <Box args={[0.3, 0.12, 0.3]} position={[0, 0.1, 0]} color={SKIN} />
      <group ref={head} position={[0, 0.6, 0]}>
        <Box args={[0.86, 0.86, 0.86]} position={[0, 0, 0]} color={SKIN} roughness={0.7} />
        {/* Hair: neat silver side part */}
        <Box args={[0.92, 0.18, 0.92]} position={[0, 0.44, -0.01]} color={HAIR} roughness={0.8} />
        <Box args={[0.92, 0.42, 0.14]} position={[0, 0.22, -0.4]} color={HAIR} roughness={0.8} />
        <Box args={[0.1, 0.32, 0.8]} position={[-0.44, 0.24, -0.02]} color={HAIR} roughness={0.8} />
        <Box args={[0.1, 0.32, 0.8]} position={[0.44, 0.24, -0.02]} color={HAIR} roughness={0.8} />
        <Box args={[0.36, 0.08, 0.06]} position={[-0.2, 0.36, 0.43]} color={HAIR} />
        {/* Eyebrows */}
        <Box args={[0.17, 0.04, 0.02]} position={[-0.19, 0.17, 0.44]} color="#4a4540" />
        <Box args={[0.17, 0.04, 0.02]} position={[0.19, 0.17, 0.44]} color="#4a4540" />
        {/* Glasses: frames, lenses, bridge */}
        <Box args={[0.26, 0.2, 0.02]} position={[-0.19, 0.04, 0.44]} color="#141c24" metalness={0.5} roughness={0.3} />
        <Box args={[0.26, 0.2, 0.02]} position={[0.19, 0.04, 0.44]} color="#141c24" metalness={0.5} roughness={0.3} />
        <Box args={[0.2, 0.14, 0.02]} position={[-0.19, 0.04, 0.452]} color="#d7e9f7" roughness={0.1} />
        <Box args={[0.2, 0.14, 0.02]} position={[0.19, 0.04, 0.452]} color="#d7e9f7" roughness={0.1} />
        <Box args={[0.1, 0.03, 0.02]} position={[0, 0.06, 0.45]} color="#141c24" />
        {/* Eyes behind lenses */}
        <Box args={[0.07, 0.08, 0.02]} position={[-0.19, 0.03, 0.462]} color="#1a2e24" />
        <Box args={[0.07, 0.08, 0.02]} position={[0.19, 0.03, 0.462]} color="#1a2e24" />
        {/* Smile */}
        <Box args={[0.24, 0.04, 0.02]} position={[0, -0.2, 0.44]} color="#8a4a3a" />
        <Box args={[0.05, 0.04, 0.02]} position={[-0.13, -0.17, 0.44]} color="#8a4a3a" />
        <Box args={[0.05, 0.04, 0.02]} position={[0.13, -0.17, 0.44]} color="#8a4a3a" />
      </group>
    </group>
  );
}

function AdvisorStage({ variant = "hero" }) {
  const headshot = variant === "headshot";
  return (
    <Canvas
      camera={
        headshot
          ? { position: [0, 0.62, 2.05], fov: 30, near: 0.1, far: 40 }
          : { position: [0.6, -0.2, 6.4], fov: 34, near: 0.1, far: 40 }
      }
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[2.5, 3.5, 3]} intensity={1.35} />
      <directionalLight position={[-3, 1.5, -1]} intensity={0.4} color="#bcd7ff" />
      <Suspense fallback={null}>
        <AdvisorFigure animate={!headshot} />
      </Suspense>
    </Canvas>
  );
}

/** Tiny CSS blocky face used next to bubbles and on the launcher. */
function MiniAdvisorFace({ size = "sm" }) {
  return (
    <span className={`advisor-mini-face is-${size}`} aria-hidden="true">
      <span className="advisor-mini-hair" />
      <span className="advisor-mini-glasses">
        <i />
        <i />
      </span>
      <span className="advisor-mini-smile" />
    </span>
  );
}

const STARTERS = [
  "What do you think about my portfolio?",
  "What is the difference between stocks and ETFs?",
  "How do I pick good stocks?",
];

const WELCOME =
  "Hi! I’m **Ledger**, your classroom financial advisor. Ask me about stocks, ETFs, bonds, risk — or what your portfolio is telling you.";

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function compactLoans(list, extra = {}) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((loan) => ({
    principal: n(loan?.principal),
    ratePct: n(loan?.ratePct ?? loan?.rate_pct ?? loan?.interest_rate),
    countryName: loan?.countryName || loan?.country || extra.countryName || null,
    borrowerName: loan?.borrowerName || extra.borrowerName || null,
    lenderName: loan?.lenderName || extra.lenderName || null,
  }));
}

function portfolioSnapshot(portfolio, lending, classMeta) {
  if (!portfolio) return null;
  const cash = n(portfolio.cash) || 0;
  const portVal = n(portfolio.portfolio_value) || 0;
  const total = n(portfolio.total_value) || cash + portVal;
  const holdings = (portfolio.holdings || []).slice(0, 16).map((h) => {
    const shares = n(h.shares ?? h.qty ?? h.quantity);
    const avg = n(h.avg_cost);
    const price = n(h.price);
    const cost = n(h.cost_basis) ?? (shares != null && avg != null ? shares * avg : null);
    const mv =
      n(h.market_value) ??
      (h.asset_type === "realestate" && h.equity != null
        ? n(h.equity)
        : shares != null && price != null
          ? shares * price
          : null);
    const gain = n(h.gain_loss) ?? (mv != null && cost != null ? mv - cost : null);
    const gainPct =
      n(h.gain_loss_pct) ?? (gain != null && cost > 0 ? (gain / cost) * 100 : null);
    const weightPct = mv != null && total > 0 ? (mv / total) * 100 : null;
    return {
      ticker: h.ticker,
      name: h.name || null,
      asset_type: h.asset_type || null,
      shares,
      avg_cost: round2(avg),
      cost_basis: round2(cost),
      price: round2(price),
      market_value: round2(mv),
      gain_loss: round2(gain),
      gain_loss_pct: round2(gainPct),
      weight_pct: round2(weightPct),
    };
  });
  let invested = 0;
  let heldValue = 0;
  for (const h of holdings) {
    if (h.cost_basis) invested += h.cost_basis;
    if (h.market_value) heldValue += h.market_value;
  }
  const gain = heldValue - invested;
  const gainPct = invested > 0 ? (gain / invested) * 100 : null;
  const cashPct = total > 0 ? (cash / total) * 100 : null;
  return {
    cash: round2(cash),
    portfolio_value: round2(portVal),
    total_value: round2(total),
    cash_pct: round2(cashPct),
    invested: round2(invested),
    holdings_value: round2(heldValue),
    unrealized_gain: round2(gain),
    unrealized_gain_pct: round2(gainPct),
    holdings,
    contestEnd: formatContestLabel(classMeta?.contestEnd),
    className: classMeta?.className || null,
    investmentGoal: classMeta?.investmentGoal || null,
    lending: lending
      ? {
          countryLoans: compactLoans(lending.countryLoans),
          peerLent: compactLoans(lending.peerLent),
          peerBorrowed: compactLoans(lending.peerBorrowed),
        }
      : undefined,
  };
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** **bold** inline formatting for model replies. */
function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    )
  );
}

/** Paragraphs + bullet / numbered lists — enough for GPT replies to read cleanly. */
function RichText({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let list = null;
  lines.forEach((raw) => {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = { type: /^\d/.test(line) ? "ol" : "ul", items: [] };
        blocks.push(list);
      }
      list.items.push(bullet[1]);
      return;
    }
    list = null;
    if (line) blocks.push({ type: "p", text: line });
  });
  return blocks.map((b, i) => {
    if (b.type === "p") return <p key={i}>{renderInline(b.text, `p${i}`)}</p>;
    const Tag = b.type;
    return (
      <Tag key={i}>
        {b.items.map((item, j) => (
          <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
        ))}
      </Tag>
    );
  });
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdvisorChat({
  open,
  onClose,
  classId,
  studentId,
  portfolio,
  lending,
  className = "",
  contestEnd = "",
  investmentGoal = null,
}) {
  const [messages, setMessages] = useState(() => [
    { id: "welcome", role: "assistant", content: WELCOME, ts: Date.now() },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const hasUserMessage = messages.some((m) => m.role === "user");

  useEffect(() => {
    if (!open) return undefined;
    const y = window.scrollY;
    const keepScroll = () => {
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    };
    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      keepScroll();
    }, 380);
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  async function sendText(raw) {
    const text = String(raw || "").trim();
    if (!text || busy || !classId || !studentId) return;
    setError("");
    const userMsg = { id: `u-${Date.now()}`, role: "user", content: text, ts: Date.now() };
    const prior = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setBusy(true);
    try {
      const data = await askAdvisorChat(classId, studentId, text, {
        history: prior,
        portfolio: portfolioSnapshot(portfolio, lending, {
          className,
          contestEnd,
          investmentGoal,
        }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: String(data?.reply || "").trim() || "…",
          ts: Date.now(),
        },
      ]);
    } catch (err) {
      setError(err.message || "Ledger couldn’t reply. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText(draft);
    }
  }

  function resetChat() {
    if (busy) return;
    setError("");
    setMessages([{ id: "welcome", role: "assistant", content: WELCOME, ts: Date.now() }]);
  }

  const lastUserIdx = messages.reduce((acc, m, i) => (m.role === "user" ? i : acc), -1);

  return (
    <aside
      className={open ? "advisor-drawer is-open" : "advisor-drawer"}
      aria-hidden={!open}
      aria-label="Chat with Ledger, your financial advisor"
    >
      <div className="advisor-pane">
      <header className="advisor-bar">
        <div className="advisor-bar-avatar">
          {open ? <AdvisorStage variant="headshot" /> : null}
          <span className="advisor-online-dot" aria-hidden="true" />
        </div>
        <div className="advisor-bar-copy">
          <strong>Ledger</strong>
          <span className={busy ? "is-typing" : ""}>
            {busy ? "typing…" : "Financial Advisor · Online"}
          </span>
        </div>
        <button
          type="button"
          className="advisor-icon-btn"
          data-click="select"
          aria-label="New conversation"
          title="New conversation"
          disabled={busy || !hasUserMessage}
          onClick={resetChat}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path
              d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="advisor-icon-btn"
          data-click="select"
          aria-label="Close chat"
          title="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="advisor-thread" ref={threadRef}>
        {!hasUserMessage ? (
          <section className="advisor-profile">
            <div className="advisor-profile-stage">{open ? <AdvisorStage variant="hero" /> : null}</div>
            <strong>Ledger</strong>
            <span>Classroom Financial Advisor</span>
            <p>Practice advice for Ledger Lab — not real-world financial advice.</p>
          </section>
        ) : null}

        <div className="advisor-day">
          <span>Today</span>
        </div>

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const firstOfGroup = !prev || prev.role !== m.role;
          const lastOfGroup = !next || next.role !== m.role;
          const mine = m.role === "user";
          return (
            <div
              key={m.id}
              className={[
                "advisor-row",
                mine ? "is-me" : "is-them",
                firstOfGroup ? "is-first" : "",
                lastOfGroup ? "is-last" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {!mine ? (
                <span className="advisor-row-face">
                  {lastOfGroup ? <MiniAdvisorFace /> : null}
                </span>
              ) : null}
              <div className="advisor-col">
                <div className="advisor-bubble">
                  <RichText text={m.content} />
                </div>
                {m.id === "welcome" && !hasUserMessage && !busy ? (
                  <div className="advisor-chips" aria-label="Suggested questions">
                    {STARTERS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="advisor-chip"
                        data-click="select"
                        onClick={() => sendText(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}
                {lastOfGroup ? (
                  <span className="advisor-meta">
                    {mine && i === lastUserIdx && !busy && !error
                      ? `Delivered · ${formatTime(m.ts)}`
                      : formatTime(m.ts)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {busy ? (
          <div className="advisor-row is-them is-first is-last">
            <span className="advisor-row-face">
              <MiniAdvisorFace />
            </span>
            <div className="advisor-col">
              <div className="advisor-bubble advisor-typing" aria-label="Ledger is typing">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="advisor-error" role="alert">
            <span>Not delivered — {error}</span>
          </div>
        ) : null}
      </div>

      <form
        className="advisor-composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendText(draft);
        }}
      >
        <div className="advisor-field">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={800}
            disabled={!open}
            placeholder="Message Ledger"
            aria-label="Message Ledger"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className="advisor-send"
            data-click="confirm"
            disabled={busy || !draft.trim()}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </form>
      </div>
    </aside>
  );
}

export function AdvisorChatFab({ onClick, open }) {
  return (
    <button
      type="button"
      className={open ? "advisor-launcher is-hidden" : "advisor-launcher"}
      data-click="select"
      onClick={onClick}
      aria-label="Chat with Ledger, your financial advisor"
      tabIndex={open ? -1 : 0}
    >
      <span className="advisor-launcher-face">
        <MiniAdvisorFace size="md" />
        <span className="advisor-online-dot" aria-hidden="true" />
      </span>
      <span className="advisor-launcher-copy">
        <strong>Ask Ledger</strong>
        <span>Your financial advisor</span>
      </span>
    </button>
  );
}
