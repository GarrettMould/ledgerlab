import { useEffect, useState } from "react";
import { createStudent, getHealth } from "./api";
import {
  addClassStudent,
  clearJoinFromUrl,
  DEFAULT_MARKETS,
  findClassStudent,
  getClassByInviteCode,
  linkUserToClass,
  setActiveClassId,
  setStudentSession,
  tradingStudentId,
  updateClassStudent,
} from "./classStore";
import {
  AvatarSetupPanel,
  outfitForStudent,
  saveOutfit,
} from "./StudentCharacter";
import {
  signInStudent,
  signUpStudent,
  updateStudentUserProfile,
} from "./studentAuth";
import { sendPasswordReset, signInStudentWithGoogle } from "./teacherAuth";
import MarketGlyph from "./MarketGlyph";

const MARKET_GUIDE = [
  {
    id: "stocks",
    title: "Stocks",
    blurb: "Own a slice of real companies",
    tag: "Equity",
  },
  {
    id: "etfs",
    title: "ETFs",
    blurb: "One trade that spreads your risk",
    tag: "Basket",
  },
  {
    id: "bonds",
    title: "Bonds",
    blurb: "Steadier yield from loans",
    tag: "Income",
  },
  {
    id: "commodities",
    title: "Commodities",
    blurb: "Raw prices for gold, oil, crops, metals",
    tag: "Goods",
  },
  {
    id: "currencies",
    title: "Currencies",
    blurb: "Swap dollars for other money",
    tag: "FX",
  },
  {
    id: "realestate",
    title: "Real estate",
    blurb: "Florida homes + a classroom mortgage",
    tag: "Property",
  },
];

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.1 2.3 1.9 3.5l3.1 3.1C3.2 8 1.5 9.8.9 12c1.7 3.9 6 7 11.1 7 2.1 0 4-.5 5.7-1.4l3.2 3.2 1.2-1.2L3.1 2.3zM12 17c-3.7 0-6.9-2.1-8.6-5 .7-1.3 1.8-2.5 3.1-3.4l1.7 1.7A5 5 0 0 0 12 17zm0-10c3.7 0 6.9 2.1 8.6 5-.5.9-1.1 1.7-1.9 2.4l-1.5-1.5c.5-.5.8-1.2.8-1.9a5 5 0 0 0-5-5c-.7 0-1.4.2-2 .6L9.4 5.1C10.2 4.8 11.1 4.7 12 4.7z"
      />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus = false,
}) {
  const [show, setShow] = useState(false);
  return (
    <label htmlFor={id}>
      {label}
      <div className="password-field">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          minLength={6}
        />
        <button
          type="button"
          className="password-toggle"
          data-click="select"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </label>
  );
}

export default function StudentJoin({
  inviteCode,
  onComplete,
  setError,
  setBusy,
}) {
  const [step, setStep] = useState("loading");
  // loading | auth | welcome | avatar | invalid
  const [authMode, setAuthMode] = useState("signup"); // signup | signin | reset
  const [classInfo, setClassInfo] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [rosterId, setRosterId] = useState(null);
  const [apiStudentId, setApiStudentId] = useState(null);
  const [outfit, setOutfit] = useState(() => outfitForStudent(null, "new"));
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const cls = await getClassByInviteCode(inviteCode);
        if (cancelled) return;
        if (!cls) {
          setError("That invite link is invalid or expired.");
          setStep("invalid");
          return;
        }
        setClassInfo(cls);
        setStep("auth");
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not open invite");
          setStep("invalid");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode, setBusy, setError]);

  async function ensureLedgerSeat(user, seatId, cash = 0) {
    try {
      await createStudent(user.name, Number(cash) || 0, {
        classId: classInfo.id,
        studentId: seatId,
        authUid: user.uid,
      });
    } catch (err) {
      console.warn("Ledger init:", err?.message || err);
    }
  }

  async function ensureRosterSeat(user, { createIfMissing }) {
    if (!classInfo) return null;
    const existing = await findClassStudent(classInfo.id, {
      authUid: user.uid,
      email: user.email,
    });
    if (existing) {
      let health = { ledger: "sqlite" };
      try {
        health = await getHealth();
      } catch {
        /* ignore */
      }
      const ledger = health.ledger === "firestore" ? "firestore" : "sqlite";
      const tradingId =
        tradingStudentId(existing, ledger) ||
        tradingStudentId(existing, "firestore");
      const patch = {};
      if (existing.apiStudentId !== existing.id) {
        patch.apiStudentId = existing.id;
      }
      if (!existing.authUid && user.uid) {
        patch.authUid = user.uid;
      }
      if (user.email && !existing.email) {
        patch.email = String(user.email).trim().toLowerCase();
      }
      if (Object.keys(patch).length) {
        try {
          await updateClassStudent(classInfo.id, existing.id, patch);
        } catch {
          /* non-fatal */
        }
      }
      setRosterId(existing.id);
      setApiStudentId(tradingId);
      setName(existing.name || user.name);
      if (existing.outfit) setOutfit(existing.outfit);
      await linkUserToClass(user.uid, classInfo.id, {
        name: existing.name || user.name,
        email: user.email,
      });
      // Never block onboarding on ledger ensure — API hang was freezing "Updating".
      void ensureLedgerSeat(user, existing.id, existing.cash);
      return { ...existing, apiStudentId: tradingId };
    }
    if (!createIfMissing) return null;

    const startingCash = Number(classInfo.startingCash) || 0;
    let health = { ledger: "sqlite" };
    try {
      health = await getHealth();
    } catch {
      /* ignore */
    }

    if (health.ledger === "firestore") {
      const firestoreStudentId = await addClassStudent(classInfo.id, {
        name: user.name,
        email: user.email,
        authUid: user.uid,
        cash: startingCash,
        outfit: null,
      });
      void ensureLedgerSeat(user, firestoreStudentId, startingCash);
      setRosterId(firestoreStudentId);
      setApiStudentId(firestoreStudentId);
      return {
        id: firestoreStudentId,
        apiStudentId: firestoreStudentId,
        name: user.name,
        investmentGoal: null,
        outfit: null,
      };
    }

    // Local SQLite fallback (no Firebase Admin credentials).
    const created = await createStudent(user.name, startingCash);
    const firestoreStudentId = await addClassStudent(classInfo.id, {
      name: user.name,
      email: user.email,
      authUid: user.uid,
      cash: created.cash,
      apiStudentId: created.id,
      outfit: null,
    });
    setRosterId(firestoreStudentId);
    setApiStudentId(created.id);
    return {
      id: firestoreStudentId,
      apiStudentId: created.id,
      name: user.name,
      investmentGoal: null,
      outfit: null,
    };
  }

  async function completeSession({
    displayName,
    firestoreStudentId,
    studentApiId,
    nextOutfit,
  }) {
    if (!classInfo) return;
    saveOutfit(studentApiId, nextOutfit);
    setActiveClassId(classInfo.id);
    setStudentSession({
      classId: classInfo.id,
      className: classInfo.name,
      inviteCode: classInfo.inviteCode,
      firestoreStudentId,
      apiStudentId: studentApiId,
      name: displayName,
      authUid: authUser?.uid || null,
      email: authUser?.email || null,
      investmentGoal: null,
    });
    clearJoinFromUrl();
    onComplete?.({
      classId: classInfo.id,
      apiStudentId: studentApiId,
      name: displayName,
      investmentGoal: null,
    });
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (!classInfo) return;
    setBusy(true);
    setError("");
    try {
      let user;
      try {
        user = await signUpStudent({ name, email, password });
      } catch (err) {
        const msg = String(err?.message || "");
        // Account was created on a previous hung attempt — continue as sign-in.
        if (/already.*account|already.*use|email-already/i.test(msg)) {
          user = await signInStudent({ email, password });
        } else {
          throw err;
        }
      }
      setAuthUser(user);
      setName(user.name || name);
      setOutfit(outfitForStudent(null, user.name || name));
      const seat = await ensureRosterSeat(user, { createIfMissing: true });
      if (!seat) throw new Error("Could not add you to the class roster.");
      setStep("welcome");
    } catch (err) {
      setError(err.message || "Could not create your account");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (!classInfo) return;
    setBusy(true);
    setError("");
    try {
      const user = await signInStudent({ email, password });
      setAuthUser(user);
      setName(user.name);
      const seat = await ensureRosterSeat(user, { createIfMissing: true });
      if (!seat) throw new Error("Could not find your seat in this class.");

      const nextOutfit =
        seat.outfit || outfitForStudent(seat.apiStudentId || seat.id, user.name);
      setOutfit(nextOutfit);

      // Returning students: enter class if they finished avatar once (Firestore or local).
      const hasOutfit = Boolean(seat.outfit) || user.onboardingComplete;
      if (!hasOutfit) {
        setStep("welcome");
        return;
      }

      await completeSession({
        displayName: seat.name || user.name,
        firestoreStudentId: seat.id,
        studentApiId: seat.apiStudentId || seat.id,
        nextOutfit,
      });
    } catch (err) {
      setError(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleAuth() {
    if (!classInfo) return;
    setBusy(true);
    setError("");
    try {
      const user = await signInStudentWithGoogle();
      setAuthUser(user);
      setName(user.name);
      setEmail(user.email || "");
      const seat = await ensureRosterSeat(user, { createIfMissing: true });
      if (!seat) throw new Error("Could not add you to the class roster.");

      const nextOutfit =
        seat.outfit || outfitForStudent(seat.apiStudentId || seat.id, user.name);
      setOutfit(nextOutfit);

      const hasOutfit = Boolean(seat.outfit) || user.onboardingComplete;
      if (!hasOutfit) {
        setStep("welcome");
        return;
      }

      await completeSession({
        displayName: seat.name || user.name,
        firestoreStudentId: seat.id,
        studentApiId: seat.apiStudentId || seat.id,
        nextOutfit,
      });
    } catch (err) {
      setError(err.message || "Could not continue with Google");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResetSent(false);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (err) {
      setError(err.message || "Could not send reset email");
    } finally {
      setBusy(false);
    }
  }

  function continueFromWelcome(e) {
    e.preventDefault();
    setError("");
    setStep("avatar");
  }

  async function finishJoin() {
    if (!classInfo || !authUser || !rosterId || !apiStudentId) {
      setError("Something went missing. Try signing in again.");
      setStep("auth");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Save roster + enter class first. Ledger ensure must not block onboarding —
      // a hung Admin SDK /api/students call was freezing "Updating" forever.
      await updateClassStudent(classInfo.id, rosterId, {
        outfit,
        name: name.trim() || authUser.name,
        apiStudentId: rosterId,
        authUid: authUser.uid,
      });
      await updateStudentUserProfile(authUser.uid, {
        onboardingComplete: true,
        primaryClassId: classInfo.id,
      });
      void ensureLedgerSeat(
        { ...authUser, name: name.trim() || authUser.name },
        rosterId,
        classInfo.startingCash
      );
      await completeSession({
        displayName: name.trim() || authUser.name,
        firestoreStudentId: rosterId,
        studentApiId: apiStudentId || rosterId,
        nextOutfit: outfit,
      });
    } catch (err) {
      setError(err.message || "Could not finish setup");
    } finally {
      setBusy(false);
    }
  }

  const enabledMarkets = {
    ...DEFAULT_MARKETS,
    ...(classInfo?.markets || {}),
  };
  const visibleMarkets = MARKET_GUIDE.filter(
    (m) => enabledMarkets[m.id] !== false
  );

  const stepIndex =
    step === "auth" ? 1 : step === "welcome" ? 2 : step === "avatar" ? 3 : 0;

  if (step === "loading") {
    return (
      <section className="panel join-panel">
        <header className="panel-header">
          <div>
            <h2>Joining class…</h2>
            <p>Checking your invite link.</p>
          </div>
        </header>
      </section>
    );
  }

  if (step === "invalid") {
    return (
      <section className="panel join-panel">
        <header className="panel-header">
          <div>
            <h2>Invite not found</h2>
            <p>Ask your teacher for a new class invite link.</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="panel join-panel">
      <header className="panel-header">
        <div>
          <p className="join-kicker">Join {classInfo?.name || "class"}</p>
          <h2>
            {step === "auth"
              ? authMode === "signup"
                ? "Create your account"
                : authMode === "reset"
                  ? "Reset password"
                  : "Welcome back"
              : step === "welcome"
                ? "Welcome to Ledger Lab"
                : "Customize your avatar"}
          </h2>
          <p>
            {step === "auth"
              ? authMode === "signup"
                ? `Sign up to join the roster. You'll start with ${money(classInfo?.startingCash)} to invest.`
                : authMode === "reset"
                  ? "Enter your account email and we’ll send a link to choose a new password."
                  : "Sign in with the email and password you used for this class."
              : step === "welcome"
                ? "How class investing works — then pick your look."
                : "Pick a look — you can change outfits anytime from your home page."}
          </p>
        </div>
        <div className="join-steps" aria-hidden="true">
          <span className={stepIndex === 1 ? "active" : stepIndex > 1 ? "done" : ""}>
            1
          </span>
          <span className={stepIndex === 2 ? "active" : stepIndex > 2 ? "done" : ""}>
            2
          </span>
          <span className={stepIndex === 3 ? "active" : ""}>3</span>
        </div>
      </header>

      {step === "auth" && (
        <div className="student-auth-portal">
          {authMode !== "reset" && (
            <div className="auth-mode-toggle" role="tablist" aria-label="Account">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "signup"}
                className={authMode === "signup" ? "active" : ""}
                data-click="select"
                onClick={() => {
                  setAuthMode("signup");
                  setResetSent(false);
                  setError("");
                }}
              >
                Sign up
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "signin"}
                className={authMode === "signin" ? "active" : ""}
                data-click="select"
                onClick={() => {
                  setAuthMode("signin");
                  setResetSent(false);
                  setError("");
                }}
              >
                Sign in
              </button>
            </div>
          )}

          {authMode !== "reset" && (
            <>
              <button
                type="button"
                className="google-btn"
                data-click="select"
                onClick={handleGoogleAuth}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>
              <div className="auth-divider" role="separator" aria-label="or">
                <span>or</span>
              </div>
            </>
          )}

          {authMode === "signup" ? (
            <form className="join-auth-form" onSubmit={handleSignUp}>
              <label htmlFor="student-name">
                Your name
                <input
                  id="student-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Lee"
                  autoComplete="name"
                  autoFocus
                  required
                />
              </label>
              <label htmlFor="student-email">
                Email
                <input
                  id="student-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  autoComplete="email"
                  required
                />
              </label>
              <PasswordField
                id="student-password"
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button type="submit" className="primary-btn" data-click="confirm">
                Create account
              </button>
            </form>
          ) : authMode === "reset" ? (
            <form className="join-auth-form" onSubmit={handleReset}>
              <label htmlFor="join-reset-email">
                Email
                <input
                  id="join-reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>
              {resetSent ? (
                <p className="auth-success-hint">
                  If an account exists for that email, a reset link is on the way.
                  Check your inbox (and spam), then sign in with your new password.
                </p>
              ) : (
                <p className="teacher-code-hint">
                  Use the same email you used for this class.
                </p>
              )}
              <button type="submit" className="primary-btn" data-click="confirm">
                {resetSent ? "Send again" : "Send reset link"}
              </button>
              <button
                type="button"
                className="ghost-btn auth-back-btn"
                data-click="select"
                onClick={() => {
                  setAuthMode("signin");
                  setResetSent(false);
                  setError("");
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form className="join-auth-form" onSubmit={handleSignIn}>
              <label htmlFor="signin-email">
                Email
                <input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>
              <PasswordField
                id="signin-password"
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <div className="auth-inline-actions">
                <button
                  type="button"
                  className="text-link-btn"
                  data-click="select"
                  onClick={() => {
                    setAuthMode("reset");
                    setResetSent(false);
                    setError("");
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <button type="submit" className="primary-btn" data-click="confirm">
                Sign in
              </button>
            </form>
          )}
        </div>
      )}

      {step === "welcome" && (
        <form className="join-welcome" onSubmit={continueFromWelcome}>
          <section className="welcome-block" aria-labelledby="howto-heading">
            <h3 id="howto-heading">How to play</h3>
            <ol className="welcome-steps">
              <li>
                <strong>Start with cash</strong>
                <span>
                  You begin with {money(classInfo?.startingCash)}. Use it to buy
                  assets — sell anytime to free cash again.
                </span>
              </li>
              <li>
                <strong>Open a market</strong>
                <span>
                  From home, pick a market card, browse prices, then buy or sell.
                </span>
              </li>
              <li>
                <strong>Watch the news</strong>
                <span>
                  Classroom headlines can move prices. Check the news desk before
                  you trade.
                </span>
              </li>
              <li>
                <strong>Track your standing</strong>
                <span>
                  Your portfolio value updates as prices change. Compare with
                  classmates anytime.
                </span>
              </li>
            </ol>
          </section>

          <section className="welcome-block welcome-markets" aria-labelledby="markets-heading">
            <div className="market-menu-head">
              <p className="market-menu-kicker">Your class markets</p>
              <h3 id="markets-heading">Where you can trade</h3>
              <p className="market-menu-lead">
                These floors are open for your class — same cards you’ll see on
                your home page.
              </p>
            </div>
            <div className="market-lanes join-market-lanes" role="list">
              {visibleMarkets.map((market, i) => (
                <div
                  key={market.id}
                  role="listitem"
                  className={`market-lane market-lane-${market.id} market-lane-static`}
                  style={{ animationDelay: `${i * 55}ms` }}
                >
                  <span className="market-lane-visual" aria-hidden="true">
                    <MarketGlyph id={market.id} />
                  </span>
                  <span className="market-lane-copy">
                    <span className="market-lane-tag">{market.tag}</span>
                    <strong>{market.title}</strong>
                    <span className="market-lane-blurb">{market.blurb}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="form-actions join-avatar-actions">
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={() => setStep("auth")}
            >
              Back
            </button>
            <button type="submit" className="primary-btn" data-click="confirm">
              Continue
            </button>
          </div>
        </form>
      )}

      {step === "avatar" && (
        <div className="join-avatar-step">
          <AvatarSetupPanel
            outfit={outfit}
            onChangeOutfit={setOutfit}
            studentName={name.trim() || authUser?.name || "Student"}
          />
          <div className="form-actions join-avatar-actions">
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={() => setStep("welcome")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary-btn"
              data-click="confirm"
              onClick={finishJoin}
            >
              Enter class
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
