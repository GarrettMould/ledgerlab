import { useState } from "react";
import { signInTeacher, signUpTeacher } from "./teacherAuth";

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

/**
 * Teacher-only entry for the main site URL (not invite links).
 * Signup requires the school instructor code.
 */
export default function TeacherGate({ onAuthenticated, setError, setBusy }) {
  const [authMode, setAuthMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instructorCode, setInstructorCode] = useState("");

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
      onAuthenticated(teacher);
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
      const teacher = await signInTeacher({ email, password });
      onAuthenticated(teacher);
    } catch (err) {
      setError(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel teacher-gate-panel">
      <header className="panel-header">
        <div>
          <p className="join-kicker">Ledger Lab for Teachers</p>
          <h2>{authMode === "signup" ? "Create teacher account" : "Teacher sign in"}</h2>
          <p>
            {authMode === "signup"
              ? "Teachers only. You’ll need your school’s instructor code to register."
              : "Sign in with the email you used to set up Ledger Lab for your classes."}
          </p>
        </div>
      </header>

      <div className="student-auth-portal teacher-gate-portal">
        <div className="auth-mode-toggle" role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            aria-selected={authMode === "signin"}
            className={authMode === "signin" ? "active" : ""}
            data-click="select"
            onClick={() => {
              setAuthMode("signin");
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
              setError("");
            }}
          >
            Sign up
          </button>
        </div>

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
                required
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
              Students join with a class invite link — not this page.
            </p>
            <button type="submit" className="primary-btn" data-click="confirm">
              Create teacher account
            </button>
          </form>
        ) : (
          <form className="join-auth-form" onSubmit={handleSignIn}>
            <label htmlFor="teacher-signin-email">
              Email
              <input
                id="teacher-signin-email"
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
              id="teacher-signin-password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="submit" className="primary-btn" data-click="confirm">
              Sign in
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
