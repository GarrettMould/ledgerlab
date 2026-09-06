import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

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

export async function signUpStudent({ name, email, password }) {
  const trimmedName = String(name || "").trim();
  const trimmedEmail = String(email || "").trim().toLowerCase();
  if (!trimmedName) throw new Error("Enter your name.");
  if (!trimmedEmail) throw new Error("Enter your email.");
  if (!password || password.length < 6) {
    throw new Error("Password should be at least 6 characters.");
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
      role: "student",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      uid: cred.user.uid,
      name: trimmedName,
      email: trimmedEmail,
    };
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

export async function signInStudent({ email, password }) {
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
    const name =
      profile.name ||
      cred.user.displayName ||
      trimmedEmail.split("@")[0];
    return {
      uid: cred.user.uid,
      name,
      email: cred.user.email || trimmedEmail,
      investmentGoal: profile.investmentGoal || null,
      onboardingComplete: Boolean(profile.onboardingComplete),
    };
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

export async function updateStudentUserProfile(uid, patch) {
  if (!uid) return;
  await setDoc(
    doc(db, "users", uid),
    {
      ...patch,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function signOutStudentAuth() {
  try {
    await signOut(auth);
  } catch {
    // Ignore — local session clear still matters.
  }
}
