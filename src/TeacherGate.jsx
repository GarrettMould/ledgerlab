import { useState } from "react";
import {
  sendPasswordReset,
  signInAccount,
  signInAccountWithGoogle,
  signUpTeacher,
  signUpTeacherWithGoogle,
} from "./teacherAuth";

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

function GoogleIcon() {
  return (
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
  );
}

function PasswordField({ id, label, value, onChange, autoComplete }) {
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
          required
          minLength={6}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow((v) => !v)}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </label>
  );
}

function AuthDivider({ label = "or" }) {
  return (
    <div className="auth-divider" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}

function GoogleButton({ onClick, children }) {
  return (
    <button
      type="button"
      className="google-btn"
      data-click="select"
      onClick={onClick}
    >
      <GoogleIcon />
      <span>{children}</span>
    </button>
  );
}

/**
 * Main-site auth: sign in for teachers and students; sign up is teachers only.
 */
export default function TeacherGate({ onAuthenticated, setError, setBusy }) {
  const [authMode, setAuthMode] = useState("signin"); // signin | signup | reset
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instructorCode, setInstructorCode] = useState("");
  const [resetSent, setResetSent] = useState(false);

  async function handleSignUp(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const teacher = await signUpTeacher({
        name,
        email,
        password,
        instructorCode,
      });
      onAuthenticated({ role: "teacher", profile: teacher });
    } catch (err) {
      setError(err.message || "Could not create teacher account");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await signInAccount({ email, password });
      onAuthenticated(result);
    } catch (err) {
      setError(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");
    try {
      const result = await signInAccountWithGoogle();
      onAuthenticated(result);
    } catch (err) {
      setError(err.message || "Could not sign in with Google");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleTeacherSignUp() {
    setBusy(true);
    setError("");
    try {
      const result = await signUpTeacherWithGoogle({
        instructorCode,
        name,
      });
      onAuthenticated(result);
    } catch (err) {
      setError(err.message || "Could not create teacher account with Google");
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

  const heading =
    authMode === "signup"
      ? "Create teacher account"
      : authMode === "reset"
        ? "Reset password"
        : "Sign in";

  const subcopy =
    authMode === "signup"
      ? "Teacher registration only. You’ll need your school’s instructor code."
      : authMode === "reset"
        ? "Enter your account email and we’ll send a link to choose a new password."
        : "Teachers and students can sign in here. We’ll open the right home for your account.";

  return (
    <section className="panel teacher-gate-panel">
      <header className="panel-header">
        <div>
          <p className="join-kicker">Ledger Lab</p>
          <h2>{heading}</h2>
          <p>{subcopy}</p>
        </div>
      </header>

      <div className="student-auth-portal teacher-gate-portal">
        {authMode !== "reset" && (
          <div className="auth-mode-toggle" role="tablist" aria-label="Account">
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
              Teacher sign up
            </button>
          </div>
        )}

        {authMode === "signup" ? (
          <form className="join-auth-form" onSubmit={handleSignUp}>
            <label htmlFor="teacher-name">
              Your name
              <input
                id="teacher-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ms. Rivera"
                autoComplete="name"
                autoFocus
              />
            </label>
            <label htmlFor="teacher-email">
              Email
              <input
                id="teacher-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                autoComplete="email"
                required
              />
            </label>
            <PasswordField
              id="teacher-password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <label htmlFor="instructor-code">
              Instructor code
              <input
                id="instructor-code"
                value={instructorCode}
                onChange={(e) => setInstructorCode(e.target.value)}
                placeholder="Enter your school’s code"
                autoComplete="one-time-code"
                inputMode="numeric"
                required
              />
            </label>
            <p className="teacher-code-hint">
              Students join with a class invite link first, then sign in here.
            </p>
            <button type="submit" className="primary-btn" data-click="confirm">
              Create teacher account
            </button>
            <AuthDivider />
            <GoogleButton onClick={handleGoogleTeacherSignUp}>
              Continue with Google
            </GoogleButton>
            <p className="teacher-code-hint">
              Google teacher signup still needs a valid instructor code above.
            </p>
          </form>
        ) : authMode === "reset" ? (
          <form className="join-auth-form" onSubmit={handleReset}>
            <label htmlFor="reset-email">
              Email
              <input
                id="reset-email"
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
                Use the same email you signed up with.
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
            <GoogleButton onClick={handleGoogleSignIn}>
              Continue with Google
            </GoogleButton>
            <AuthDivider />
            <label htmlFor="account-signin-email">
              Email
              <input
                id="account-signin-email"
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
              id="account-signin-password"
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
            <p className="teacher-code-hint">
              New student? Use the invite link from your teacher to create an
              account.
            </p>
            <button type="submit" className="primary-btn" data-click="confirm">
              Sign in
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
