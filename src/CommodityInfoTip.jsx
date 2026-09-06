import { useEffect, useId, useRef, useState } from "react";

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function CommodityInfoTip({ name, kind, info }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const holdings = Array.isArray(info?.holdings) ? info.holdings : null;
  const summary = info?.summary || null;
  const interestPerUnit =
    info?.interest_per_unit != null ? Number(info.interest_per_unit) : null;
  const isBondIncome = interestPerUnit != null && Number.isFinite(interestPerUnit);

  if (!holdings?.length && !summary && !isBondIncome) return null;

  return (
    <span
      className={open ? "commodity-info open" : "commodity-info"}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="commodity-info-btn"
        data-click="select"
        aria-label={`About ${name}`}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        i
      </button>

      {open && (
        <div
          id={tipId}
          className="commodity-tooltip"
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          {holdings?.length ? (
            <>
              <strong className="commodity-tooltip-title">Main holdings</strong>
              <ul className="commodity-tooltip-list">
                {holdings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : isBondIncome ? (
            <>
              <p className="commodity-tooltip-kicker">{kind || "Fixed income"}</p>
              <strong className="commodity-tooltip-title">{name}</strong>
              <p className="commodity-tooltip-earn">
                {info.matured
                  ? "No remaining interest"
                  : money(interestPerUnit)}
                {!info.matured && (
                  <span> interest by {info.horizon || "May 15, 2027"}</span>
                )}
              </p>
              <p className="commodity-tooltip-body">
                {summary ||
                  "Estimated fixed interest on one $100 unit if you hold through the classroom date (or maturity if sooner)."}
              </p>
            </>
          ) : (
            <>
              <p className="commodity-tooltip-kicker">{kind || "Info"}</p>
              <strong className="commodity-tooltip-title">{name}</strong>
              <p className="commodity-tooltip-body">{summary}</p>
            </>
          )}
        </div>
      )}
    </span>
  );
}
