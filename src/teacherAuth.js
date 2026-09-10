import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

/** Required on teacher signup. Share privately with instructors — not for students. */
export const INSTRUCTOR_CODE = "9759";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code === "auth/email-already-in-use") {
    return "That email already has an account. Try signing in.";
  }
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") {
    return "Password should be at least 6 characters.";
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return "Email or password is incorrect.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (code === "auth/missing-email") {
    return "Enter your email address first.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was cancelled.";
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain isn’t allowed for Google sign-in yet. In Firebase → Authentication → Settings → Authorized domains, add this site’s domain.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "An account already exists with this email using a different sign-in method. Try email/password, or use the same method you used before.";
  }
  if (code === "auth/configuration-not-found" || /configuration-not-found/i.test(err?.message || "")) {
    return "Firebase Authentication isn’t set up yet. In the Firebase console, open Authentication → Get started, then enable Email/Password and Google under Sign-in method.";
  }
  if (code === "auth/operation-not-allowed") {
    return "That sign-in method isn’t enabled. In Firebase → Authentication → Sign-in method, turn on Email/Password and Google, then save.";
  }
  return err?.message || "Could not sign in.";
}

export function isValidInstructorCode(code) {
  return String(code || "").trim() === INSTRUCTOR_CODE;
}

/** Send a Firebase password-reset email. Always succeeds message-wise for unknown emails (privacy). */
export async function sendPasswordReset(email) {
  const trimmedEmail = String(email || "").trim().toLowerCase();
  if (!trimmedEmail) throw new Error("Enter your email address first.");
  try {
    await sendPasswordResetEmail(auth, trimmedEmail);
  } catch (err) {
    if (err?.code === "auth/user-not-found" || err?.code === "auth/invalid-email") {
      if (err.code === "auth/invalid-email") {
        throw new Error("Enter a valid email address.");
      }
      return;
    }
    throw new Error(friendlyAuthError(err));
  }
}

async function signInWithGooglePopup() {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

async function resolveAccountFromUser(user) {
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const role = profile.role || "student";
  const name =
    profile.name ||
    user.displayName ||
    (user.email || "").split("@")[0] ||
    "User";
  const emailOut = user.email || profile.email || "";

  if (role === "teacher" || role === "admin") {
    return {
      role: "teacher",
      profile: {
        uid: user.uid,
        name,
        email: emailOut,
        role: role === "admin" ? "admin" : "teacher",
      },
    };
  }

  const { buildStudentSessionFromAuth, getStudentSession } = await import(
    "./classStore"
  );
  let session = await buildStudentSessionFromAuth(user.uid, {
    name,
    email: emailOut,
    investmentGoal: profile.investmentGoal,
  });
  if (!session) {
    const local = getStudentSession();
    if (local?.authUid === user.uid || (emailOut && local?.email === emailOut)) {
      session = { ...local, authUid: user.uid, email: emailOut };
    }
  }
  if (!session) {
    await signOut(auth);
    throw new Error(
      "No class found for this account. Open your class invite link to join first, then you can sign in here."
    );
  }
  return { role: "student", session };
}

export async function signUpTeacher({ name, email, password, instructorCode }) {
  const trimmedName = String(name || "").trim();
  const trimmedEmail = String(email || "").trim().toLowerCase();
  if (!trimmedName) throw new Error("Enter your name.");
  if (!trimmedEmail) throw new Error("Enter your email.");
  if (!password || password.length < 6) {
    throw new Error("Password should be at least 6 characters.");
  }
  if (!isValidInstructorCode(instructorCode)) {
    throw new Error(
      "That instructor code isn’t valid. Ask your school for the Ledger Lab teacher code."
    );
  }

  try {
    const cred = await createUserWithEmailAndPassword(
      auth,
      trimmedEmail,
      password
    );
    await updateProfile(cred.user, { displayName: trimmedName });
    await setDoc(doc(db, "users", cred.user.uid), {
      name: trimmedName,
      email: trimmedEmail,
      role: "teacher",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      uid: cred.user.uid,
      name: trimmedName,
      email: trimmedEmail,
      role: "teacher",
    };
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

/** Teacher registration via Google — still requires the instructor code. */
export async function signUpTeacherWithGoogle({ instructorCode, name }) {
  if (!isValidInstructorCode(instructorCode)) {
    throw new Error(
      "That instructor code isn’t valid. Ask your school for the Ledger Lab teacher code."
    );
  }
  try {
    const user = await signInWithGooglePopup();
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    const existing = profileSnap.exists() ? profileSnap.data() : null;
    if (existing?.role === "student") {
      await signOut(auth);
      throw new Error(
        "That Google account is already a student. Use a different Google account for teacher signup."
      );
    }
    const trimmedName =
      String(name || "").trim() ||
      existing?.name ||
      user.displayName ||
      (user.email || "").split("@")[0] ||
      "Teacher";
    const emailOut = user.email || existing?.email || "";
    await setDoc(
      doc(db, "users", user.uid),
      {
        name: trimmedName,
        email: emailOut,
        role: "teacher",
        createdAt: existing?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (!user.displayName && trimmedName) {
      try {
        await updateProfile(user, { displayName: trimmedName });
      } catch {
        /* ignore */
      }
    }
    return {
      role: "teacher",
      profile: {
        uid: user.uid,
        name: trimmedName,
        email: emailOut,
        role: "teacher",
      },
    };
  } catch (err) {
    if (
      err?.message?.includes("already a student") ||
      err?.message?.includes("instructor code")
    ) {
      throw err;
    }
    throw new Error(friendlyAuthError(err));
  }
}

export async function signInTeacher({ email, password }) {
  const result = await signInAccount({ email, password });
  if (result.role !== "teacher") {
    await signOut(auth);
    throw new Error(
      "This account is for students. Use Sign in on the home page, or your class invite link."
    );
  }
  return result.profile;
}

/** Sign in any Ledger Lab account and route by role (teacher | student). */
export async function signInAccount({ email, password }) {
  const trimmedEmail = String(email || "").trim().toLowerCase();
  if (!trimmedEmail) throw new Error("Enter your email.");
  if (!password) throw new Error("Enter your password.");

  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      trimmedEmail,
      password
    );
    return await resolveAccountFromUser(cred.user);
  } catch (err) {
    if (
      err?.message?.includes("invite link") ||
      err?.message?.includes("No class found")
    ) {
      throw err;
    }
    throw new Error(friendlyAuthError(err));
  }
}

/** Google sign-in for existing teacher/student accounts on the main site. */
export async function signInAccountWithGoogle() {
  try {
    const user = await signInWithGooglePopup();
    return await resolveAccountFromUser(user);
  } catch (err) {
    if (
      err?.message?.includes("invite link") ||
      err?.message?.includes("No class found")
    ) {
      throw err;
    }
    throw new Error(friendlyAuthError(err));
  }
}

/**
 * Google auth for class invite flow — creates/updates a student profile.
 * Returns the same shape as signInStudent / signUpStudent.
 */
export async function signInStudentWithGoogle() {
  try {
    const user = await signInWithGooglePopup();
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    const existing = profileSnap.exists() ? profileSnap.data() : null;
    if (existing?.role === "teacher" || existing?.role === "admin") {
      await signOut(auth);
      throw new Error(
        "That Google account is a teacher account. Students should use a different Google account, or sign in with email."
      );
    }
    const name =
      existing?.name ||
      user.displayName ||
      (user.email || "").split("@")[0] ||
      "Student";
    const emailOut = user.email || existing?.email || "";
    await setDoc(
      doc(db, "users", user.uid),
      {
        name,
        email: emailOut,
        role: "student",
        createdAt: existing?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return {
      uid: user.uid,
      name,
      email: emailOut,
      investmentGoal: existing?.investmentGoal || null,
      onboardingComplete: Boolean(existing?.onboardingComplete),
    };
  } catch (err) {
    if (err?.message?.includes("teacher account")) throw err;
    throw new Error(friendlyAuthError(err));
  }
}

export async function signOutTeacherAuth() {
  try {
    await signOut(auth);
  } catch {
    /* ignore */
  }
}

/** Resolve signed-in Firebase user to a teacher profile, or null. */
export async function resolveTeacherProfile(user) {
  if (!user) return null;
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const role = profile.role || "";
  if (role !== "teacher" && role !== "admin") return null;
  return {
    uid: user.uid,
    name: profile.name || user.displayName || user.email?.split("@")[0] || "Teacher",
    email: user.email || profile.email || "",
    role: role === "admin" ? "admin" : "teacher",
  };
}

/**
 * Watch Firebase auth and resolve teacher or student session.
 * onChange({ type: 'teacher', profile } | { type: 'student', session } | null)
 */
export function watchAccountAuth(onChange) {
  return onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        onChange(null);
        return;
      }
      const teacher = await resolveTeacherProfile(user);
      if (teacher) {
        onChange({ type: "teacher", profile: teacher });
        return;
      }
      const { buildStudentSessionFromAuth, getStudentSession } = await import(
        "./classStore"
      );
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      const profile = profileSnap.exists() ? profileSnap.data() : {};
      let session = await buildStudentSessionFromAuth(user.uid, {
        name: profile.name || user.displayName,
        email: user.email || profile.email,
        investmentGoal: profile.investmentGoal,
      });
      if (!session) {
        const local = getStudentSession();
        if (local?.authUid === user.uid) session = local;
      }
      if (session) {
        onChange({ type: "student", session });
        return;
      }
      onChange(null);
    } catch {
      onChange(null);
    }
  });
}

/** @deprecated Prefer watchAccountAuth */
export function watchTeacherAuth(onChange) {
  return watchAccountAuth((account) => {
    onChange(account?.type === "teacher" ? account.profile : null);
  });
}
