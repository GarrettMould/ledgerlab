import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

/** Required on teacher signup. Share privately with instructors — not for students. */
export const INSTRUCTOR_CODE = "9759";

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
  if (code === "auth/configuration-not-found" || /configuration-not-found/i.test(err?.message || "")) {
    return "Firebase Authentication isn’t set up yet. In the Firebase console, open Authentication → Get started, then enable Email/Password under Sign-in method.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/password sign-in isn’t enabled. In Firebase → Authentication → Sign-in method, turn on Email/Password and save.";
  }
  return err?.message || "Could not sign in.";
}

export function isValidInstructorCode(code) {
  return String(code || "").trim() === INSTRUCTOR_CODE;
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

export async function signInTeacher({ email, password }) {
  const trimmedEmail = String(email || "").trim().toLowerCase();
  if (!trimmedEmail) throw new Error("Enter your email.");
  if (!password) throw new Error("Enter your password.");

  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      trimmedEmail,
      password
    );
    const profileSnap = await getDoc(doc(db, "users", cred.user.uid));
    const profile = profileSnap.exists() ? profileSnap.data() : {};
    const role = profile.role || "student";
    if (role !== "teacher" && role !== "admin") {
      await signOut(auth);
      throw new Error(
        "This account is for students. Open your class invite link to sign in."
      );
    }
    const name =
      profile.name ||
      cred.user.displayName ||
      trimmedEmail.split("@")[0];
    return {
      uid: cred.user.uid,
      name,
      email: cred.user.email || trimmedEmail,
      role: role === "admin" ? "admin" : "teacher",
    };
  } catch (err) {
    if (err?.message?.includes("invite link")) throw err;
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

export function watchTeacherAuth(onChange) {
  return onAuthStateChanged(auth, async (user) => {
    try {
      const profile = await resolveTeacherProfile(user);
      onChange(profile);
    } catch {
      onChange(null);
    }
  });
}
