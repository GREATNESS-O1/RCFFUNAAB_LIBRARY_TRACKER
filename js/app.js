/**
 * app.js
 * ─────────────────────────────────────────────────────────────────────
 * Application entry point.
 * - Initialises Firebase
 * - Listens to auth state changes
 * - Routes between login view and app view
 * - Sets up tab navigation and global UI wiring
 * - Theme management (Dark / Light with localStorage persistence)
 * - Offline connectivity banner
 * - Header scroll shadow & keyboard shortcuts ('/' to search)
 * - Manages all real-time listeners (subscribes on login, unsubscribes on logout)
 * - Handles midnight status rollover via a visibility-change / interval check
 * ─────────────────────────────────────────────────────────────────────
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDoc, doc, getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { initAuth, setupLoginView, logoutUser } from "./auth.js";
import { initBooks, subscribeBooks, unsubscribeBooks, renderBooksTab, refreshCategoryChipsOverflow } from "./books.js";
import { initLoans, subscribeLoans, unsubscribeLoans, renderLoansTab, openNewLoanModal, exportCSV, setLoansSearch } from "./loans.js";
import { showToast } from "./ui.js";
import { icon } from "./icons.js";
import { todayString } from "./utils.js";

/* ─── Firebase init ──────────────────────────────────────────────── */
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

initAuth(firebaseApp);
initBooks(firebaseApp);
initLoans(firebaseApp);

/* ─── DOM references ─────────────────────────────────────────────── */
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");

/* ─── Active tab tracking ────────────────────────────────────────── */
let _activeTab = "loans";
let _unsubBooks = null;
let _unsubLoans = null;
let _currentLoans = []; // Kept in sync by the snapshot listener

/* ─── Global Initializations (Theme, Offline, Icons) ─────────────── */
initTheme();
initNetworkBanner();
initGlobalShortcuts();

/* ─── Auth state listener ────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const libDoc = await getDoc(doc(db, "librarians", user.uid));
      if (!libDoc.exists()) {
        await logoutUser();
        showLoginView();
        showToast("This account is not authorized as a librarian.", "error", 6000);
        return;
      }
    } catch (err) {
      // If offline, allow cached session through
      console.warn("Could not verify librarian:", err);
    }

    showAppView(user);
  } else {
    teardownApp();
    showLoginView();
  }
});

/* ─── View switching ─────────────────────────────────────────────── */

function showLoginView() {
  if (loginView) loginView.hidden = false;
  if (appView) appView.hidden = true;
  setupLoginView();
}

function showAppView(user) {
  if (loginView) loginView.hidden = true;
  if (appView) appView.hidden = false;

  // Librarian email and user avatar letter
  const email = user.email || "";
  const emailEl = document.getElementById("librarian-email");
  if (emailEl) {
    emailEl.textContent = email;
    emailEl.title = email;
  }
  const avatarLetterEl = document.getElementById("user-avatar-letter");
  if (avatarLetterEl) {
    avatarLetterEl.textContent = (email.charAt(0) || "L").toUpperCase();
  }

  initStaticIcons();
  setupAppUI();
  startListeners();
}

function teardownApp() {
  if (_unsubBooks) { _unsubBooks(); _unsubBooks = null; }
  if (_unsubLoans) { _unsubLoans(); _unsubLoans = null; }
  unsubscribeBooks();
  unsubscribeLoans();
}

/* ─── Theme Management ───────────────────────────────────────────── */

function initTheme() {
  // Light is the default for everyone; only a saved toggle choice opts
  // into dark — we don't follow the OS preference (matches the
  // anti-flash script in index.html's <head>).
  const saved = localStorage.getItem("rcf_theme");
  applyTheme(saved || "light");

  // Header theme toggle button
  document.getElementById("theme-toggle-btn")?.addEventListener("click", toggleTheme);

  // User menu theme toggle button
  document.getElementById("menu-theme-btn")?.addEventListener("click", () => {
    toggleTheme();
    closeUserMenu();
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("rcf_theme", theme);

  const toggleBtn = document.getElementById("theme-toggle-btn");
  const menuIcon = document.getElementById("menu-theme-icon");
  const menuLabel = document.getElementById("menu-theme-label");

  const isDark = theme === "dark";
  const iconMarkup = icon(isDark ? "sun" : "moon", { size: 18 });
  const labelText = isDark ? "Switch to Light mode" : "Switch to Dark mode";

  if (toggleBtn) {
    toggleBtn.innerHTML = iconMarkup;
    toggleBtn.title = labelText;
    toggleBtn.setAttribute("aria-label", labelText);
  }
  if (menuIcon) menuIcon.innerHTML = icon(isDark ? "sun" : "moon", { size: 16 });
  if (menuLabel) menuLabel.textContent = labelText;
}

/* ─── Network Status Banner ──────────────────────────────────────── */

function initNetworkBanner() {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;

  const iconSlot = banner.querySelector(".offline-banner__icon");
  if (iconSlot) iconSlot.innerHTML = icon("wifi-off", { size: 16 });

  const updateBanner = () => {
    banner.hidden = navigator.onLine;
  };

  window.addEventListener("online", () => {
    updateBanner();
    showToast("Back online. Synchronizing data…", "success");
  });
  window.addEventListener("offline", updateBanner);
  updateBanner();
}

/* ─── Global Keyboard Shortcuts & Header Scroll ──────────────────── */

function initGlobalShortcuts() {
  // '/' to focus global search
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      const searchInput = document.getElementById("global-search");
      if (searchInput && !document.getElementById("loans-panel").hidden) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // Sticky header subtle shadow on scroll
  const header = document.getElementById("app-header");
  window.addEventListener("scroll", () => {
    if (header) {
      header.classList.toggle("app-header--scrolled", window.scrollY > 4);
    }
  }, { passive: true });
}

/* ─── Inject Inline SVG Icons for Static Shell Elements ──────────── */

function initStaticIcons() {
  const loansIcon = document.getElementById("tab-icon-loans");
  if (loansIcon && !loansIcon.innerHTML) loansIcon.innerHTML = icon("book", { size: 16 });

  const booksIcon = document.getElementById("tab-icon-books");
  if (booksIcon && !booksIcon.innerHTML) booksIcon.innerHTML = icon("books", { size: 16 });

  const searchSlot = document.getElementById("search-icon-slot");
  if (searchSlot && !searchSlot.innerHTML) searchSlot.innerHTML = icon("search", { size: 16 });

  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn && !clearBtn.innerHTML) clearBtn.innerHTML = icon("x", { size: 14 });

  const newLoanSlot = document.getElementById("new-loan-icon-slot");
  if (newLoanSlot && !newLoanSlot.innerHTML) newLoanSlot.innerHTML = icon("plus", { size: 16 });

  const fab = document.getElementById("fab-new-loan");
  if (fab) fab.innerHTML = icon("plus", { size: 24 });

  const exportSlot = document.getElementById("export-icon-slot");
  if (exportSlot && !exportSlot.innerHTML) exportSlot.innerHTML = icon("download", { size: 14 });

  const logoutIcon = document.getElementById("menu-logout-icon");
  if (logoutIcon && !logoutIcon.innerHTML) logoutIcon.innerHTML = icon("logout", { size: 16 });
}

/* ─── User Avatar Menu Handling ──────────────────────────────────── */

function closeUserMenu() {
  const menu = document.getElementById("user-menu-dropdown");
  const avatarBtn = document.getElementById("user-avatar-btn");
  if (menu) menu.hidden = true;
  if (avatarBtn) avatarBtn.setAttribute("aria-expanded", "false");
}

function setupUserMenu() {
  const avatarBtn = document.getElementById("user-avatar-btn");
  const menu = document.getElementById("user-menu-dropdown");
  if (!avatarBtn || !menu) return;

  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = avatarBtn.getAttribute("aria-expanded") === "true";
    menu.hidden = isExpanded;
    avatarBtn.setAttribute("aria-expanded", (!isExpanded).toString());
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== avatarBtn) {
      closeUserMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      closeUserMenu();
      avatarBtn.focus();
    }
  });
}

/* ─── App UI wiring ──────────────────────────────────────────────── */

function setupAppUI() {
  setupUserMenu();

  // Logout button
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      closeUserMenu();
      await logoutUser();
    } catch (err) {
      showToast("Logout failed. Please try again.", "error");
    }
  });

  // Tab navigation
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Global search bar & clear button
  const searchEl = document.getElementById("global-search");
  const clearBtn = document.getElementById("search-clear-btn");

  searchEl?.addEventListener("input", (e) => {
    const val = e.target.value;
    if (clearBtn) clearBtn.hidden = !val;
    setLoansSearch(val);
  });

  clearBtn?.addEventListener("click", () => {
    if (searchEl) {
      searchEl.value = "";
      searchEl.focus();
    }
    clearBtn.hidden = true;
    setLoansSearch("");
  });

  // New Loan button (header / FAB)
  document.getElementById("new-loan-btn")?.addEventListener("click", openNewLoanModal);
  document.getElementById("fab-new-loan")?.addEventListener("click", openNewLoanModal);

  // Export CSV button
  document.getElementById("export-csv-btn")?.addEventListener("click", exportCSV);

  // Dashboard card click → filter
  document.getElementById("dash-overdue-card")?.addEventListener("click", () => {
    switchTab("loans");
    const pill = document.querySelector('.pill[data-filter="overdue"]');
    pill?.click();
  });
  document.getElementById("dash-due-soon-card")?.addEventListener("click", () => {
    switchTab("loans");
    const pill = document.querySelector('.pill[data-filter="active"]');
    pill?.click();
  });

  // Initial tab
  switchTab("loans");
}

function switchTab(tab) {
  _activeTab = tab;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("tab-btn--active", isActive);
    btn.setAttribute("aria-selected", isActive);
  });

  const loansPanel = document.getElementById("loans-panel");
  const booksPanel = document.getElementById("books-panel");
  if (loansPanel) loansPanel.hidden = tab !== "loans";
  if (booksPanel) booksPanel.hidden = tab !== "books";

  if (tab === "books") refreshCategoryChipsOverflow();
}

/* ─── Real-time listeners ────────────────────────────────────────── */

function startListeners() {
  _unsubBooks = subscribeBooks((books) => {
    renderBooksTab(books);
  });

  _unsubLoans = subscribeLoans((loans) => {
    _currentLoans = loans;
    renderLoansTab(loans);
  });
}

/* ─── Midnight status rollover ───────────────────────────────────── */
let _lastDay = todayString();

function checkDayRollover() {
  const today = todayString();
  if (today !== _lastDay) {
    _lastDay = today;
    if (_currentLoans.length > 0) {
      renderLoansTab(_currentLoans);
    }
  }
}

setInterval(checkDayRollover, 60_000);
window.addEventListener("focus", checkDayRollover);
