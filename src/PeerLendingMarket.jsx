import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AvatarCanvas,
  loadSavedOutfit,
  outfitForStudent,
  stripPlayerFishForm,
} from "./StudentCharacter";
import { listClassStudents } from "./classStore";
import {
  borrowPeerLoan,
  cancelPeerLendOffer,
  createPeerLendOffer,
  listPeerLendOffers,
} from "./api";
import TradeSuccessModal from "./TradeSuccessModal";
import { POLL, pollWhileVisible } from "./pollWhileVisible";
import { formatShortDate, peerLoanDueDate } from "./contestDates";

const DEFAULT_PAYBACK_LABEL = formatShortDate(peerLoanDueDate());

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function moneyExact(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function rateLabel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

const EXAMPLE_LENDER_ID = "peer-lend-lab";

function normalizeOffer(row) {
  if (!row) return null;
  const studentId = row.lenderStudentId || row.studentId;
  const name = row.lenderName || row.name || "Student";
  const isExample =
    Boolean(row.testOffer) ||
    String(studentId) === EXAMPLE_LENDER_ID ||
    String(name).trim().toLowerCase() === "lending lab";
  return {
    id: row.id,
    studentId,
    name,
    amountAvailable: Number(row.amountRemaining ?? row.amountAvailable) || 0,
    ratePct: Number(row.ratePct) || 0,
    createdAt: row.createdAt,
    isExample,
  };
}

function seatId(seat) {
  return String(seat?.id || seat?.apiStudentId || "");
}

function outfitForSeat(seat, fallbackName = "Student") {
  const id = seatId(seat);
  const name = seat?.name || fallbackName;
  const base = outfitForStudent(id, name);
  if (seat?.outfit && typeof seat.outfit === "object") {
    return stripPlayerFishForm({ ...base, ...seat.outfit, npcFish: false }, base);
  }
  return loadSavedOutfit(id, name);
}

function PeerLendHowItWorks({ dueLabel = DEFAULT_PAYBACK_LABEL }) {
  return (
    <section className="peer-lend-how" aria-labelledby="peer-lend-how-title">
      <div className="peer-lend-how-main">
        <p className="peer-lend-how-kicker">Classroom peer lending</p>
        <h4 id="peer-lend-how-title">How this market works</h4>
        <p className="peer-lend-how-lead">
          Classmates with extra cash list how much they’ll lend and at what rate.
          Anyone who needs cash can borrow from an offer — then repay principal
          plus that interest by the due date.
        </p>
        <dl className="peer-lend-how-steps">
          <div className="peer-lend-how-step">
            <dt>Borrowers</dt>
            <dd>Pick a lender below, choose an amount, and get cash now.</dd>
          </div>
          <div className="peer-lend-how-step">
            <dt>Lenders</dt>
            <dd>
              List cash with “List cash to lend,” set your rate, and earn when
              you’re repaid.
            </dd>
          </div>
          <div className="peer-lend-how-step">
            <dt>Payback</dt>
            <dd>
              Everything is due on <em>{dueLabel}</em>. One repayment of
              what you borrowed plus the listed interest.
            </dd>
          </div>
        </dl>
      </div>
      <aside className="peer-lend-how-aside" aria-label="Rate and due date">
        <p className="peer-lend-how-due">
          <span>Payback date</span>
          <strong>{dueLabel}</strong>
        </p>
        <p className="peer-lend-how-rate-note">
          <strong>Here’s how the rate works</strong>
          Lend <em>$100</em> at <em>7%</em> and on {dueLabel} you get{" "}
          <em>$107</em> back.
        </p>
        <p className="peer-lend-how-example">
          Borrowing? Same math: take <strong>$100</strong> at{" "}
          <strong>7%</strong> → repay <strong>$107</strong> on {dueLabel}.
        </p>
      </aside>
    </section>
  );
}

function LenderAvatar({ outfit, name }) {
  return (
    <span className="peer-lend-avatar" aria-hidden="true">
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
          className="peer-lend-avatar-stage"
        />
      </Suspense>
      {!outfit ? (
        <span className="peer-lend-avatar-fallback">
          {(name || "?").slice(0, 1).toUpperCase()}
        </span>
      ) : null}
    </span>
  );
}

function OfferForm({ cash, busy, onCancel, onSubmit, dueLabel = DEFAULT_PAYBACK_LABEL }) {
  const [amount, setAmount] = useState("500");
  const [rate, setRate] = useState("5");
  const cashNum = Number(cash);
  const amountNum = Number(amount);
  const rateNum = Number(rate);
  const validAmount =
    Number.isFinite(amountNum) &&
    amountNum >= 50 &&
    (!Number.isFinite(cashNum) || amountNum <= cashNum + 1e-9);
  const validRate = Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 50;

  return (
    <form
      className="peer-lend-offer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validAmount || !validRate || busy) return;
        onSubmit({ amount: Math.round(amountNum * 100) / 100, ratePct: rateNum });
      }}
    >
      <div className="peer-lend-offer-head">
        <div>
          <p className="peer-lend-kicker">Become a lender</p>
          <h4>List cash on the lending market</h4>
        </div>
        <button type="button" className="ghost-btn" data-click="select" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="peer-lend-offer-note">
        Classmates can borrow up to the amount you list. Example: $100 at 7% comes
        back as $107 on {dueLabel}. Cash available:{" "}
        <strong>{moneyExact(cash)}</strong>
      </p>
      <div className="peer-lend-offer-fields">
        <label>
          <span>Amount willing to lend</span>
          <div className="peer-lend-input-row">
            <span aria-hidden="true">$</span>
            <input
              type="number"
              min="50"
              step="50"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </label>
        <label>
          <span>Interest rate</span>
          <div className="peer-lend-input-row">
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <span aria-hidden="true">%</span>
          </div>
        </label>
      </div>
      {!validAmount && Number.isFinite(amountNum) ? (
        <p className="peer-lend-form-error">
          {amountNum < 50
            ? "List at least $50."
            : "That amount is more cash than you have."}
        </p>
      ) : null}
      {!validRate && rate !== "" ? (
        <p className="peer-lend-form-error">Pick a rate between 0% and 50%.</p>
      ) : null}
      <button
        type="submit"
        className="primary-btn"
        data-click="confirm"
        disabled={!validAmount || !validRate || busy}
      >
        {busy ? "Listing…" : `List ${money(amountNum)} at ${rateLabel(rateNum)}`}
      </button>
    </form>
  );
}

function BorrowModal({
  lender,
  outfit,
  cash,
  busy = false,
  onClose,
  onConfirm,
  dueLabel = DEFAULT_PAYBACK_LABEL,
}) {
  const maxBorrow = Number(lender.amountAvailable) || 0;
  const [amount, setAmount] = useState(String(Math.min(100, maxBorrow) || maxBorrow));
  const [localError, setLocalError] = useState("");
  const amountNum = Number(amount);
  const valid =
    Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= maxBorrow + 1e-9;
  const ratePct = Number(lender.ratePct) || 0;
  const interest = valid
    ? Math.round(amountNum * (ratePct / 100) * 100) / 100
    : 0;
  const totalOwed = valid ? amountNum + interest : 0;
  const cashNow = Number(cash);
  const cashAfter =
    Number.isFinite(cashNow) && valid ? cashNow + amountNum : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function confirmBorrow() {
    if (!valid || busy) return;
    setLocalError("");
    try {
      await onConfirm?.(amountNum, totalOwed);
    } catch (err) {
      setLocalError(err.message || "Could not borrow");
    }
  }

  return createPortal(
    <div
      className="transfer-overlay peer-lend-borrow-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-lend-borrow-title"
      onClick={onClose}
    >
      <div
        className="transfer-modal peer-lend-borrow-modal is-credit"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="transfer-kicker">Borrow from classmate</p>
        <div className="peer-lend-borrow-identity">
          <LenderAvatar outfit={outfit} name={lender.name} />
          <div>
            <h3 id="peer-lend-borrow-title">{lender.name}</h3>
            <p className="transfer-note">
              Lending at <strong>{rateLabel(lender.ratePct)}</strong> ·{" "}
              {money(lender.amountAvailable)} available
            </p>
          </div>
        </div>

        <label className="peer-lend-borrow-amount">
          <span>How much do you want to borrow?</span>
          <div className="peer-lend-input-row">
            <span aria-hidden="true">$</span>
            <input
              type="number"
              min="1"
              max={maxBorrow}
              step="1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </label>
        <div className="peer-lend-borrow-chips" aria-label="Quick amounts">
          {[100, 250, 500]
            .filter((n) => n <= maxBorrow)
            .map((n) => (
              <button
                key={n}
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={() => setAmount(String(n))}
              >
                {money(n)}
              </button>
            ))}
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            onClick={() => setAmount(String(maxBorrow))}
          >
            Max
          </button>
        </div>

        <section className="peer-lend-receipt" aria-label="Loan summary">
          <header className="peer-lend-receipt-head">
            <span>Loan summary</span>
            <em>{rateLabel(ratePct)} interest</em>
          </header>
          <div className="peer-lend-receipt-row">
            <div>
              <span className="peer-lend-receipt-label">Cash you get now</span>
              <span className="peer-lend-receipt-hint">Added to your balance</span>
            </div>
            <strong className="peer-lend-receipt-value is-in">
              {valid ? `+${moneyExact(amountNum)}` : "—"}
            </strong>
          </div>
          <div className="peer-lend-receipt-row">
            <div>
              <span className="peer-lend-receipt-label">Interest due</span>
              <span className="peer-lend-receipt-hint">
                {rateLabel(ratePct)} · due {dueLabel}
              </span>
            </div>
            <strong className="peer-lend-receipt-value">
              {valid ? moneyExact(interest) : "—"}
            </strong>
          </div>
          <div className="peer-lend-receipt-total">
            <div>
              <span className="peer-lend-receipt-label">
                You’d repay on {dueLabel}
              </span>
              <span className="peer-lend-receipt-hint">Principal + interest</span>
            </div>
            <strong>{valid ? moneyExact(totalOwed) : "—"}</strong>
          </div>
          {cashAfter != null ? (
            <p className="peer-lend-receipt-cash">
              Your cash after borrow: <strong>{moneyExact(cashAfter)}</strong>
              <span> (now {moneyExact(cashNow)})</span>
            </p>
          ) : null}
        </section>

        {!valid && amount !== "" ? (
          <p className="transfer-error">
            Borrow between $1 and {money(maxBorrow)}.
          </p>
        ) : null}
        {localError ? <p className="transfer-error">{localError}</p> : null}

        <button
          type="button"
          className="primary-btn transfer-accept"
          data-click="confirm"
          disabled={!valid || busy}
          onClick={confirmBorrow}
        >
          {busy ? "Borrowing…" : `Borrow ${valid ? money(amountNum) : ""}`}
        </button>
        <button
          type="button"
          className="ghost-btn peer-lend-borrow-cancel"
          data-click="select"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * Peer lending market — Firestore-backed offers and cash-moving borrows.
 */
export default function PeerLendingMarket({
  classId = "",
  studentId = "",
  studentName = "You",
  cash = 0,
  intent = null,
  onIntentConsumed,
  onPortfolio,
}) {
  const [listings, setListings] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOffer, setShowOffer] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [borrowBusy, setBorrowBusy] = useState(false);
  const [error, setError] = useState("");
  const [borrowSuccess, setBorrowSuccess] = useState(null);
  const [dueLabel, setDueLabel] = useState(DEFAULT_PAYBACK_LABEL);

  const refreshOffers = useCallback(async () => {
    if (!classId) {
      setListings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await listPeerLendOffers(classId);
      const rows = (Array.isArray(data?.offers) ? data.offers : [])
        .map(normalizeOffer)
        .filter((o) => o && Number(o.amountAvailable) > 0);
      setListings(rows);
      if (data?.dueLabel) setDueLabel(data.dueLabel);
    } catch (err) {
      setError(err.message || "Could not load lenders");
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    refreshOffers();
    return pollWhileVisible(refreshOffers, POLL.peerLendOffers);
  }, [refreshOffers]);

  useEffect(() => {
    if (!intent) return undefined;
    if (intent === "lend") {
      setShowOffer(true);
      onIntentConsumed?.();
      return undefined;
    }
    if (intent === "borrow") {
      const t = window.setTimeout(() => {
        document.getElementById("peer-lend-board")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
      onIntentConsumed?.();
      return () => window.clearTimeout(t);
    }
    onIntentConsumed?.();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  useEffect(() => {
    if (!classId) {
      setRoster([]);
      return undefined;
    }
    let cancelled = false;
    listClassStudents(classId)
      .then((rows) => {
        if (!cancelled) setRoster(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const rosterById = useMemo(() => {
    const map = new Map();
    for (const s of roster) {
      const id = seatId(s);
      if (id) map.set(id, s);
    }
    return map;
  }, [roster]);

  const sorted = useMemo(
    () =>
      [...listings].sort((a, b) => Number(a.ratePct) - Number(b.ratePct)),
    [listings]
  );

  const myListing = listings.find((l) => String(l.studentId) === String(studentId));
  const selected = sorted.find((l) => l.id === selectedId) || null;
  const selectedSeat =
    selected && (rosterById.get(String(selected.studentId)) || { name: selected.name });

  async function handleOffer({ amount, ratePct }) {
    if (!studentId) {
      setError("Sign in as a student to list a loan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createPeerLendOffer(classId, studentId, amount, ratePct);
      setShowOffer(false);
      await refreshOffers();
    } catch (err) {
      setError(err.message || "Could not list cash");
    } finally {
      setBusy(false);
    }
  }

  async function removeMyListing() {
    if (!myListing?.id || !studentId) return;
    setBusy(true);
    setError("");
    try {
      await cancelPeerLendOffer(classId, myListing.id, studentId);
      await refreshOffers();
    } catch (err) {
      setError(err.message || "Could not remove listing");
    } finally {
      setBusy(false);
    }
  }

  async function handleBorrow(amountNum, totalOwed) {
    if (!selected || !studentId) return;
    setBorrowBusy(true);
    try {
      const data = await borrowPeerLoan(
        classId,
        studentId,
        selected.id,
        amountNum
      );
      if (data?.portfolio) onPortfolio?.(data.portfolio);
      setBorrowSuccess({
        action: "borrow",
        assetType: "peerLoan",
        name: selectedSeat?.name || selected.name || "classmate",
        ticker: "PEER",
        total: amountNum,
        oweTotal: totalOwed,
        dueLabel: dueLabel,
      });
      setSelectedId(null);
      await refreshOffers();
    } finally {
      setBorrowBusy(false);
    }
  }

  return (
    <div className="peer-lend">
      <PeerLendHowItWorks dueLabel={dueLabel} />

      {myListing ? (
        <div className="peer-lend-my-bar">
          <p className="peer-lend-my-chip">
            You’re lending {money(myListing.amountAvailable)} @{" "}
            {rateLabel(myListing.ratePct)}
          </p>
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            disabled={!studentId || busy}
            onClick={() => setShowOffer(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            disabled={busy}
            onClick={removeMyListing}
          >
            Remove
          </button>
        </div>
      ) : null}

      {showOffer ? (
        <OfferForm
          cash={cash}
          busy={busy}
          dueLabel={dueLabel}
          onCancel={() => setShowOffer(false)}
          onSubmit={handleOffer}
        />
      ) : null}

      {error ? <p className="transfer-error">{error}</p> : null}

      <div className="peer-lend-table-wrap" id="peer-lend-board">
        <div className="peer-lend-table-head">
          <div>
            <h4>Lenders</h4>
            <p>
              {loading
                ? "Loading offers…"
                : `${sorted.length} offering cash · lowest rate first`}
            </p>
          </div>
          {!myListing && !showOffer ? (
            <button
              type="button"
              className="primary-btn"
              data-click="confirm"
              disabled={!studentId}
              onClick={() => setShowOffer(true)}
            >
              List cash to lend
            </button>
          ) : null}
        </div>
        {!loading && sorted.length === 0 ? (
          <p className="empty">No lenders yet. Be the first to list cash.</p>
        ) : (
          <div className="peer-lend-table" role="list">
            <div className="peer-lend-row is-head" aria-hidden="true">
              <span>Lender</span>
              <span>Rate</span>
              <span>Available</span>
              <span />
            </div>
            {sorted.map((lender) => {
              const seat = rosterById.get(String(lender.studentId));
              const name = seat?.name || lender.name || "Student";
              const outfit = outfitForSeat(seat || { id: lender.studentId, name }, name);
              const isMine = String(lender.studentId) === String(studentId);
              const isExample = Boolean(lender.isExample);
              const locked = isMine || isExample;
              return (
                <span
                  key={lender.id}
                  className={`peer-lend-row-shell${isExample ? " is-example" : ""}`}
                  data-tooltip={isExample ? "This is just an example" : undefined}
                >
                  <button
                    type="button"
                    role="listitem"
                    className={`peer-lend-row${isMine ? " is-mine" : ""}${
                      isExample ? " is-example" : ""
                    }`}
                    data-click="select"
                    disabled={locked}
                    aria-disabled={locked}
                    onClick={() => !locked && setSelectedId(lender.id)}
                  >
                    <span className="peer-lend-row-who">
                      <LenderAvatar outfit={outfit} name={name} />
                      <span>
                        <strong>{name}</strong>
                        {isMine ? <em> · you</em> : null}
                        {isExample ? <em> · example</em> : null}
                      </span>
                    </span>
                    <span className="peer-lend-row-rate">{rateLabel(lender.ratePct)}</span>
                    <span className="peer-lend-row-cash">{money(lender.amountAvailable)}</span>
                    <span className="peer-lend-row-go">
                      {isMine ? "Your offer" : isExample ? "Example" : "Borrow"}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {selected &&
      String(selected.studentId) !== String(studentId) &&
      !selected.isExample ? (
        <BorrowModal
          lender={{ ...selected, name: selectedSeat?.name || selected.name }}
          outfit={outfitForSeat(selectedSeat, selected.name)}
          cash={cash}
          busy={borrowBusy}
          dueLabel={dueLabel}
          onClose={() => !borrowBusy && setSelectedId(null)}
          onConfirm={handleBorrow}
        />
      ) : null}

      <TradeSuccessModal
        trade={borrowSuccess}
        onClose={() => setBorrowSuccess(null)}
      />
    </div>
  );
}
