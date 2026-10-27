/**
 * auth.js
 * ─────────────────────────────────────────────────────────────────────
 * Authentication: login, logout, password reset, librarian allowlist.
 * ─────────────────────────────────────────────────────────────────────
 */

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { showToast } from "./ui.js";
import { icon } from "./icons.js";

let _auth = null;
let _db = null;

/** Called once by app.js after Firebase is initialised. */
export function initAuth(app) {
  _auth = getAuth(app);
  _db = getFirestore(app);
}

/**
 * Attempts login. Returns the Firebase User on success, or throws.
 * After login we verify the librarian allowlist; if the user is not
 * in the "librarians" collection we sign them out and throw.
 */
export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  const user = cred.user;

  // Allowlist check
  const libDoc = await getDoc(doc(_db, "librarians", user.uid));
  if (!libDoc.exists()) {
    await signOut(_auth);
    const err = new Error("This account is not authorized as a librarian. Contact your administrator.");
    err.isUnauthorized = true;
    throw err;
  }

  return user;
}

/**
 * Signs the current user out.
 */
export async function logoutUser() {
  await signOut(_auth);
}

/**
 * Sends a password-reset email.
 */
export async function resetPassword(email) {
  await sendPasswordResetEmail(_auth, email);
}

/**
 * Returns the currently signed-in Auth user, or null.
 */
export function currentUser() {
  return _auth ? _auth.currentUser : null;
}

/* ════════════════════════════════════════════════════════════
   LOGIN VIEW CONTROLLER
   ════════════════════════════════════════════════════════════ */

/**
 * Wires up the login form events.
 * Should be called once during app initialisation.
 */
export function setupLoginView() {
  const form = document.getElementById("login-form");
  const emailEl = document.getElementById("login-email");
  const passEl = document.getElementById("login-password");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  const forgotLink = document.getElementById("forgot-password-link");
  const pwdToggleBtn = document.getElementById("login-pwd-toggle");

  // Populate input SVG icons
  const emailIconSlot = document.getElementById("login-email-icon");
  const pwdIconSlot = document.getElementById("login-pwd-icon");
  if (emailIconSlot) emailIconSlot.innerHTML = icon("user", { size: 18 });
  if (pwdIconSlot) pwdIconSlot.innerHTML = icon("clock", { size: 18 }); // or key/lock
  if (pwdToggleBtn) pwdToggleBtn.innerHTML = icon("eye", { size: 18 });

  if (!form) return;

  // Password visibility toggle
  let showPassword = false;
  pwdToggleBtn?.addEventListener("click", () => {
    showPassword = !showPassword;
    passEl.type = showPassword ? "text" : "password";
    pwdToggleBtn.innerHTML = icon(showPassword ? "eye-off" : "eye", { size: 18 });
    pwdToggleBtn.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    setLoading(true);

    try {
      await loginUser(emailEl.value.trim(), passEl.value);
      // onAuthStateChanged in app.js will handle the view switch
    } catch (err) {
      showError(friendlyAuthError(err), err.isUnauthorized);
    } finally {
      setLoading(false);
    }
  });

  forgotLink && forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    if (!email) {
      showError("Enter your email address above first.");
      return;
    }
    try {
      await resetPassword(email);
      showToast("Password reset email sent. Check your inbox.", "success");
    } catch (err) {
      showError(friendlyAuthError(err));
    }
  });

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.textContent = loading ? "Signing in…" : "Sign in";
  }

  function showError(msg, isInfo = false) {
    if (errorEl) {
      errorEl.className = isInfo ? "login-error login-error--info" : "login-error";
      errorEl.innerHTML = `${icon(isInfo ? "alert" : "alert", { size: 18 })} <span>${msg}</span>`;
      errorEl.hidden = false;
    }
  }

  function clearError() {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }
}

/**
 * Converts Firebase Auth error codes to human-friendly messages.
 */
function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("api-key-not-valid") || err?.message?.includes("api-key-not-valid"))
    return "Firebase API Key is missing or invalid. Please update js/firebase-config.js with your project credentials.";
  if (code.includes("wrong-password") || code.includes("invalid-credential"))
    return "That email or password doesn't look right. Please check and try again.";
  if (code.includes("user-not-found"))
    return "No librarian account found with that email address.";
  if (code.includes("invalid-email"))
    return "Please enter a valid email address.";
  if (code.includes("too-many-requests"))
    return "Too many failed attempts. Please wait a moment and try again.";
  return err.message || "Login failed. Please try again.";
}
