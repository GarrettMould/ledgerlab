import { useEffect, useId, useRef, useState } from "react";

const BOND_TERMS = [
  {
    term: "Face value",
    meaning: "The amount printed on the bond — in class, usually $100 per unit.",
  },
  {
    term: "Yield",
    meaning: "The return you’d earn if you buy at today’s price and hold (shown as a %).",
  },
  {
    term: "Coupon",
    meaning: "The fixed interest rate some bonds pay over time. T-bills often have no coupon.",
  },
  {
    term: "Maturity",
    meaning: "The date the bond ends and the face value is paid back.",
  },
  {
    term: "Issuer",
    meaning: "Who borrowed the money — the U.S. Treasury or a company.",
  },
];

export default function BondGlossaryTip() {
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

  return (
    <span
      className={open ? "commodity-info bond-glossary open" : "commodity-info bond-glossary"}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="commodity-info-btn"
        data-click="select"
        aria-label="What is a bond?"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        i
      </button>

      {open && (
        <div
          id={tipId}
          className="commodity-tooltip bond-glossary-tooltip"
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          <strong className="commodity-tooltip-title">What is a bond?</strong>
          <p className="commodity-tooltip-body">
            A bond is a loan you make to a government or company. They pay you interest, then
            return the face value at maturity.
          </p>
          <strong className="commodity-tooltip-title bond-glossary-terms-title">
            Key terms
          </strong>
          <ul className="bond-glossary-list">
            {BOND_TERMS.map((item) => (
              <li key={item.term}>
                <strong>{item.term}:</strong> {item.meaning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
