/**
 * ui.js
 * ─────────────────────────────────────────────────────────────────────
 * Reusable UI helpers: toast notifications, confirm dialogs,
 * modal management, and generic DOM rendering helpers.
 * No Firebase imports — stays pure UI logic.
 * ─────────────────────────────────────────────────────────────────────
 */

import { escHtml } from "./utils.js";
import { icon } from "./icons.js";

/* ═══════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS (Stackable, Pause-on-Hover, Undo Action)
   ═══════════════════════════════════════════════════════════ */

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration  milliseconds (default 4000)
 * @param {Object} [options]
 * @param {string} [options.actionText] e.g. "Undo"
 * @param {Function} [options.onAction] callback when action button clicked
 */
export function showToast(message, type = "info", duration = 4000, { actionText, onAction } = {}) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "polite");

  const iconName = type === "success" ? "check" : type === "error" ? "alert" : "alert";

  let actionHtml = "";
  if (actionText && typeof onAction === "function") {
    actionHtml = `<button type="button" class="toast__undo-btn">${escHtml(actionText)}</button>`;
  }

  toast.innerHTML = `
    <span class="toast__icon">${icon(iconName, { size: 18 })}</span>
    <span class="toast__msg">${escHtml(message)}</span>
    ${actionHtml}
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  let remaining = duration;
  let startTime = Date.now();
  let timerId = null;

  const startTimer = () => {
    timerId = setTimeout(() => dismiss(), remaining);
  };

  const pauseTimer = () => {
    clearTimeout(timerId);
    remaining -= Date.now() - startTime;
  };

  // Pause on hover
  toast.addEventListener("mouseenter", pauseTimer);
  toast.addEventListener("mouseleave", () => {
    startTime = Date.now();
    startTimer();
  });

  const dismiss = () => {
    toast.classList.remove("toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  };

  startTimer();

  // Action button handling
  if (actionText && onAction) {
    const actBtn = toast.querySelector(".toast__undo-btn");
    actBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismiss();
      onAction();
    });
  }

  // Click toast to dismiss early
  toast.addEventListener("click", (e) => {
    if (!e.target.closest(".toast__undo-btn")) {
      dismiss();
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   CONFIRM DIALOG (Clear title, consequence, safe button focus)
   ═══════════════════════════════════════════════════════════ */

/**
 * Shows a modal confirmation dialog.
 * @param {string}  message
 * @param {Object}  options
 * @param {string}  options.title         (default "Please confirm")
 * @param {string}  options.confirmText   (default "Confirm")
 * @param {string}  options.cancelText    (default "Cancel")
 * @param {boolean} options.danger        (true = red confirm button)
 * @returns {Promise<boolean>}  true if confirmed, false if cancelled
 */
export function confirmDialog(message, { title = "Please confirm", confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", title);

    const iconColor = danger ? "var(--clr-danger)" : "var(--clr-primary)";
    const iconName = danger ? "trash" : "alert";

    overlay.innerHTML = `
      <div class="modal confirm-modal">
        <div class="confirm-modal__icon" style="color:${iconColor};">
          ${icon(iconName, { size: 36 })}
        </div>
        <h3 class="confirm-modal__title">${escHtml(title)}</h3>
        <p class="confirm-modal__msg">${escHtml(message)}</p>
        <div class="confirm-modal__actions">
          <button class="btn btn--outline" id="confirm-cancel">${escHtml(cancelText)}</button>
          <button class="btn ${danger ? "btn--danger" : "btn--primary"}" id="confirm-ok">${escHtml(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector("#confirm-ok").addEventListener("click", () => close(true));
    overlay.querySelector("#confirm-cancel").addEventListener("click", () => close(false));

    // Escape key
    const onKey = (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        close(false);
      }
    };
    document.addEventListener("keydown", onKey);

    // Focus safe cancel button by default
    overlay.querySelector("#confirm-cancel").focus();
  });
}

/* ═══════════════════════════════════════════════════════════
   HELP SHEET (plain-language how-tos)
   ═══════════════════════════════════════════════════════════ */

const HELP_TOPICS = [
  {
    icon: "plus",
    title: "Lend a book",
    text: 'Tap the blue "Lend a book" button, search for the book, then type the borrower\'s name and phone number. Pick a due date and save — that\'s it.',
  },
  {
    icon: "check",
    title: "Receive a returned book",
    text: 'Find the loan in the list and tap "Book returned." The book goes back on the shelf right away. Changed your mind? Tap "Undo" on the confirmation message.',
  },
  {
    icon: "whatsapp",
    title: "Remind on WhatsApp",
    text: 'Open the "⋯" menu on a loan and choose "Remind on WhatsApp" to send that borrower a friendly reminder about their due date.',
  },
  {
    icon: "download",
    title: "Download the list",
    text: '"Download list (Excel)" saves everything you\'re currently looking at as a spreadsheet file, so you can open it in Excel or share it by email.',
  },
];

/** Opens the Help sheet listing plain-language how-tos for common tasks. */
export function openHelpSheet() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Help");

  const itemsHtml = HELP_TOPICS.map(
    (t) => `
      <div class="help-modal__item">
        <span class="help-modal__icon">${icon(t.icon, { size: 18 })}</span>
        <div>
          <div class="help-modal__title">${escHtml(t.title)}</div>
          <div class="help-modal__text">${escHtml(t.text)}</div>
        </div>
      </div>`
  ).join("");

  overlay.innerHTML = `
    <div class="modal modal--small">
      <div class="modal__header">
        <h2 class="modal__title">How to use this app</h2>
        <button class="modal__close" id="help-close" title="Close" aria-label="Close">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        ${itemsHtml}
      </div>
    </div>`;

  openModal(overlay, null);
  overlay.querySelector("#help-close")?.addEventListener("click", () => closeModal(overlay, null));
}

/* ═══════════════════════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════════════════════ */

/** Stack of open modal overlays for focus management */
const modalStack = [];

/**
 * Opens a modal overlay element (adds to DOM, manages focus + ESC).
 * @param {HTMLElement} overlay  - the .modal-overlay element
 * @param {Function}    onClose  - called when the modal should close
 */
export function openModal(overlay, onClose) {
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const firstFocusable = overlay.querySelector(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (firstFocusable) firstFocusable.focus();

  const handleKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeModal(overlay, onClose, handleKey);
    }
    // Trap focus inside modal
    if (e.key === "Tab") {
      trapFocus(e, overlay);
    }
  };
  document.addEventListener("keydown", handleKey);
  modalStack.push({ overlay, handleKey, onClose });

  // Click backdrop to close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal(overlay, onClose, handleKey);
    }
  });
}

/**
 * Closes a specific modal overlay.
 */
export function closeModal(overlay, onClose, handleKey) {
  if (!overlay.parentNode) return;
  overlay.remove();
  if (handleKey) document.removeEventListener("keydown", handleKey);
  if (onClose) onClose();

  const idx = modalStack.findIndex((m) => m.overlay === overlay);
  if (idx !== -1) modalStack.splice(idx, 1);

  if (modalStack.length === 0) {
    document.body.style.overflow = "";
  }
}

/**
 * Traps keyboard focus within the modal.
 */
function trapFocus(e, container) {
  const focusable = Array.from(
    container.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/* ═══════════════════════════════════════════════════════════
   LOADING STATE HELPERS
   ═══════════════════════════════════════════════════════════ */

/**
 * Sets a button into a loading state (disabled + spinner text).
 * @param {HTMLButtonElement} btn
 * @param {string} loadingText
 * @returns {Function} restore — call to reset the button
 */
export function setButtonLoading(btn, loadingText = "Saving…") {
  const original = btn.innerHTML;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span style="display:inline-flex; align-items:center; gap:0.4rem;">${icon("clock", { size: 16 })} <span>${loadingText}</span></span>`;
  return () => {
    btn.disabled = originalDisabled;
    btn.innerHTML = original;
  };
}

/* ═══════════════════════════════════════════════════════════
   STATUS BADGE & DAYS-LEFT CHIP RENDERING
   ═══════════════════════════════════════════════════════════ */

/**
 * Returns the HTML string for a status badge with icon.
 * @param {"active"|"overdue"|"returned"} status
 */
export function statusBadge(status) {
  const labels = { active: "Out now", overdue: "Late", returned: "Returned" };
  const iconNames = { active: "clock", overdue: "alert", returned: "check" };
  const label = labels[status] || status;
  const ic = icon(iconNames[status] || "clock", { size: 12 });
  return `<span class="badge badge--${escHtml(status)}">${ic}<span>${escHtml(label)}</span></span>`;
}

/**
 * Returns HTML string for the days-left chip with appropriate semantic tone.
 */
export function daysChip(status, daysText, diff) {
  let chipClass = "days-chip--active";
  let iconName = "clock";

  if (status === "returned") {
    chipClass = "days-chip--returned";
    iconName = "check";
  } else if (status === "overdue") {
    chipClass = "days-chip--overdue";
    iconName = "alert";
  } else if (diff >= 0 && diff <= 3) {
    chipClass = "days-chip--soon";
    iconName = "clock";
  }

  const ic = icon(iconName, { size: 13 });
  return `<span class="days-chip ${chipClass}">${ic}<span>${escHtml(daysText)}</span></span>`;
}

/* ═══════════════════════════════════════════════════════════
   EMPTY STATE RENDERING (Illustrated with SVGs)
   ═══════════════════════════════════════════════════════════ */

/**
 * Returns HTML for the "no loans at all" empty state (Loans tab).
 */
export function emptyStateLoans() {
  return `
    <div class="empty-state">
      <div class="empty-state__icon" style="color:var(--clr-primary);">
        ${icon("book", { size: 48 })}
      </div>
      <h3 class="empty-state__title">Nothing lent out yet</h3>
      <p class="empty-state__msg">When someone borrows a book, record it here. Use the "Lend a book" button above to get started.</p>
    </div>`;
}

/**
 * Returns HTML for the "no results" state (after filter / search).
 */
export function emptyStateNoResults() {
  return `
    <div class="empty-state">
      <div class="empty-state__icon" style="color:var(--clr-text-muted);">
        ${icon("search", { size: 40 })}
      </div>
      <h3 class="empty-state__title">No records found</h3>
      <p class="empty-state__msg">Try adjusting your search terms or clearing status filters.</p>
      <button class="btn btn--secondary btn--sm" id="clear-search-btn" style="display:inline-flex; align-items:center; gap:0.35rem;">
        ${icon("x", { size: 14 })}
        <span>Clear search</span>
      </button>
    </div>`;
}

/**
 * Returns HTML for the "no books" state on the Books tab.
 */
export function emptyStateBooks() {
  return `
    <div class="empty-state">
      <div class="empty-state__icon" style="color:var(--clr-primary);">
        ${icon("books", { size: 48 })}
      </div>
      <h3 class="empty-state__title">No books in the library catalog yet</h3>
      <p class="empty-state__msg">Add individual books, import from a spreadsheet, or populate test samples.</p>
      <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;">
        <button class="btn btn--secondary" id="load-sample-books-btn" style="display:inline-flex; align-items:center; gap:0.4rem;">
          ${icon("sparkles", { size: 16 })}
          <span>Load 5 sample books</span>
        </button>
      </div>
    </div>`;
}

/**
 * Returns skeleton shimmer markup for table / cards while data loads.
 */
export function skeletonRows(count = 4) {
  let html = '<div class="skeleton-wrap" aria-label="Loading content">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-row">
        <div class="skeleton-shimmer" style="width:36px; height:36px; border-radius:50%;"></div>
        <div style="flex:1; display:flex; flex-direction:column; gap:0.4rem;">
          <div class="skeleton-shimmer" style="width:40%; height:14px;"></div>
          <div class="skeleton-shimmer" style="width:25%; height:11px;"></div>
        </div>
        <div class="skeleton-shimmer" style="width:80px; height:24px; border-radius:999px;"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

