/**
 * loans.js
 * ─────────────────────────────────────────────────────────────────────
 * Loans tab: new-loan modal, loans list rendering, pill filters,
 * live search, dashboard cards, record actions (return, reopen,
 * extend, edit, delete, WhatsApp, call), CSV export.
 * ─────────────────────────────────────────────────────────────────────
 */

import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
  showToast,
  confirmDialog,
  openModal,
  closeModal,
  setButtonLoading,
  statusBadge,
  daysChip,
  emptyStateLoans,
  emptyStateNoResults,
  skeletonRows,
} from "./ui.js";

import { icon } from "./icons.js";

import {
  normalizePhone,
  todayString,
  addDays,
  dayDiff,
  friendlyDate,
  computeLoanStatus,
  sortLoans,
  phoneSearchKey,
  buildCSV,
  downloadCSV,
  buildWhatsAppURL,
  escHtml,
} from "./utils.js";

import { getBooks } from "./books.js";

let _db = null;
let _unsubLoans = null;

/** All loans in memory. */
let _loans = [];

/** Current filter: "all" | "active" | "overdue" | "returned" */
let _filter = "all";

/** Current search query string. */
let _search = "";

export function initLoans(app) {
  _db = getFirestore(app);
}

/** Returns all active loans for a specific book ID (used by Books tab peek modal). */
export function getActiveLoansForBook(bookId) {
  return _loans.filter((l) => l.bookId === bookId && !l.returnedOn);
}

/**
 * Returns the most recent loans for a specific book ID (any status), newest
 * borrowedOn first, for the Books tab detail drawer's loan history.
 */
export function getLoanHistoryForBook(bookId, max = 10) {
  return _loans
    .filter((l) => l.bookId === bookId)
    .sort((a, b) => (b.borrowedOn || "").localeCompare(a.borrowedOn || ""))
    .slice(0, max);
}

/* ════════════════════════════════════════════════════════════
   REAL-TIME LISTENER
   ════════════════════════════════════════════════════════════ */

export function subscribeLoans(onUpdate) {
  if (_unsubLoans) _unsubLoans();

  _unsubLoans = onSnapshot(
    collection(_db, "loans"),
    (snap) => {
      _loans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onUpdate(_loans);
    },
    (err) => {
      console.error("Loans snapshot error:", err);
      showToast("Failed to load loans. Check your connection.", "error");
    }
  );

  return () => {
    if (_unsubLoans) { _unsubLoans(); _unsubLoans = null; }
  };
}

export function unsubscribeLoans() {
  if (_unsubLoans) { _unsubLoans(); _unsubLoans = null; }
}

/* ════════════════════════════════════════════════════════════
   FILTER / SEARCH HELPERS
   ════════════════════════════════════════════════════════════ */

function applyFilterAndSearch(loans, today) {
  const q = _search.trim().toLowerCase();
  const qPhone = phoneSearchKey(_search);

  return loans.filter((loan) => {
    const { status } = computeLoanStatus(loan, today);

    // Filter
    if (_filter !== "all" && status !== _filter) return false;

    // Search
    if (q) {
      const titleMatch = (loan.bookTitle || "").toLowerCase().includes(q);
      const authorMatch = (loan.bookAuthor || "").toLowerCase().includes(q);
      const nameMatch = (loan.borrowerName || "").toLowerCase().includes(q);
      const phoneMatch = phoneSearchKey(loan.borrowerPhone || "").includes(qPhone);
      if (!titleMatch && !authorMatch && !nameMatch && !phoneMatch) return false;
    }

    return true;
  });
}

function countByStatus(loans, today) {
  const counts = { all: loans.length, active: 0, overdue: 0, returned: 0 };
  loans.forEach((l) => {
    const { status } = computeLoanStatus(l, today);
    counts[status]++;
  });
  return counts;
}

/* ════════════════════════════════════════════════════════════
   LOANS TAB RENDERING
   ════════════════════════════════════════════════════════════ */

export function renderLoansTab(loans) {
  const today = todayString();
  const sorted = sortLoans(loans, today);
  const counts = countByStatus(loans, today);
  const visible = applyFilterAndSearch(sorted, today);

  renderDashboard(loans, counts, today);
  renderPills(counts);
  renderLoansList(visible, loans.length === 0, today);
}

function renderDashboard(loans, counts, today) {
  const totalBooksCard = document.querySelector('.dash-card[aria-label="Total book titles"]');
  const borrowedCard = document.querySelector('.dash-card[aria-label="Currently borrowed"]');
  const overdueCard = document.getElementById("dash-overdue-card");
  const dueSoonCard = document.getElementById("dash-due-soon-card");

  // Render icon chips and helper text if not already populated
  if (totalBooksCard && !totalBooksCard.querySelector(".dash-card__header")) {
    totalBooksCard.innerHTML = `
      <div class="dash-card__header">
        <span class="dash-card__label">Book Titles</span>
        <span class="dash-card__icon-chip">${icon("books", { size: 18 })}</span>
      </div>
      <div class="dash-card__value" id="dash-total-books">0</div>
      <div class="dash-card__helper">Catalog size</div>
    `;
  }
  if (borrowedCard && !borrowedCard.querySelector(".dash-card__header")) {
    borrowedCard.innerHTML = `
      <div class="dash-card__header">
        <span class="dash-card__label">Borrowed</span>
        <span class="dash-card__icon-chip">${icon("book", { size: 18 })}</span>
      </div>
      <div class="dash-card__value" id="dash-borrowed">0</div>
      <div class="dash-card__helper">Currently out</div>
    `;
  }
  if (overdueCard && !overdueCard.querySelector(".dash-card__header")) {
    overdueCard.innerHTML = `
      <div class="dash-card__header">
        <span class="dash-card__label">Overdue</span>
        <span class="dash-card__icon-chip">${icon("alert", { size: 18 })}</span>
      </div>
      <div class="dash-card__value" id="dash-overdue">0</div>
      <div class="dash-card__helper">Needs follow-up</div>
    `;
  }
  if (dueSoonCard && !dueSoonCard.querySelector(".dash-card__header")) {
    dueSoonCard.innerHTML = `
      <div class="dash-card__header">
        <span class="dash-card__label">Due Soon</span>
        <span class="dash-card__icon-chip">${icon("clock", { size: 18 })}</span>
      </div>
      <div class="dash-card__value" id="dash-due-soon">0</div>
      <div class="dash-card__helper">Next 3 days</div>
    `;
  }

  // Update values
  const books = getBooks();
  const tbVal = document.getElementById("dash-total-books");
  if (tbVal) tbVal.textContent = books.length;

  const bwVal = document.getElementById("dash-borrowed");
  if (bwVal) bwVal.textContent = counts.active + counts.overdue;

  const odVal = document.getElementById("dash-overdue");
  if (odVal) {
    odVal.textContent = counts.overdue;
    if (counts.overdue === 0) {
      overdueCard?.classList.add("dash-card--overdue-zero");
      overdueCard?.classList.remove("dash-card--overdue");
      const helper = overdueCard?.querySelector(".dash-card__helper");
      if (helper) helper.textContent = "All up to date";
    } else {
      overdueCard?.classList.remove("dash-card--overdue-zero");
      overdueCard?.classList.add("dash-card--overdue");
      const helper = overdueCard?.querySelector(".dash-card__helper");
      if (helper) helper.textContent = "Needs follow-up";
    }
  }

  // Calculate Due Soon (next 3 days: diff 0, 1, or 2)
  const dueSoon = loans.filter((l) => {
    if (l.returnedOn) return false;
    const { status } = computeLoanStatus(l, today);
    if (status !== "active") return false;
    const diff = dayDiff(l.dueOn, today);
    return diff >= 0 && diff <= 2;
  });

  const dsVal = document.getElementById("dash-due-soon");
  if (dsVal) dsVal.textContent = dueSoon.length;

  // Highlight active filter card border
  overdueCard?.classList.toggle("dash-card--active-filter", _filter === "overdue");
}

function renderPills(counts) {
  const pillsEl = document.getElementById("filter-pills");
  if (!pillsEl) return;

  const filters = ["all", "active", "overdue", "returned"];
  const labels = { all: "All", active: "Active", overdue: "Overdue", returned: "Returned" };

  pillsEl.innerHTML = filters
    .map((f) => `
      <button class="pill ${_filter === f ? "pill--active" : ""}"
        data-filter="${f}" aria-pressed="${_filter === f}">
        <span>${escHtml(labels[f])}</span>
        <span class="pill-badge">${counts[f]}</span>
      </button>`)
    .join("");

  pillsEl.querySelectorAll(".pill").forEach((btn) =>
    btn.addEventListener("click", () => {
      _filter = btn.dataset.filter;
      renderLoansTab(_loans);
    })
  );
}

function updateSummaryLine(visibleCount, totalCount) {
  const summaryEl = document.getElementById("loans-summary-line");
  if (!summaryEl) return;

  if (totalCount === 0) {
    summaryEl.textContent = "";
    return;
  }

  if (visibleCount === totalCount) {
    summaryEl.textContent = `Showing all ${totalCount} loans`;
  } else {
    summaryEl.textContent = `Showing ${visibleCount} of ${totalCount} loans`;
  }
}

/* ════════════════════════════════════════════════════════════
   FIRST-RUN GUIDANCE CHECKLIST (Section 8)
   ════════════════════════════════════════════════════════════ */

export function updateChecklist() {
  const card = document.getElementById("first-run-checklist");
  if (!card) return;

  const dismissed = localStorage.getItem("rcf_checklist_dismissed") === "true";
  if (dismissed) {
    card.hidden = true;
    return;
  }

  const booksCount = getBooks().length;
  const loansCount = _loans.length;
  const waDone = localStorage.getItem("rcf_checklist_wa_done") === "true";

  const booksDone = booksCount > 0;
  const loansDone = loansCount > 0;

  // If all are completed, automatically dismiss
  if (booksDone && loansDone && waDone) {
    card.hidden = true;
    localStorage.setItem("rcf_checklist_dismissed", "true");
    return;
  }

  card.hidden = false;
  const completedCount = (booksDone ? 1 : 0) + (loansDone ? 1 : 0) + (waDone ? 1 : 0);

  card.innerHTML = `
    <div class="checklist-card__header">
      <div class="checklist-card__title">
        ${icon("sparkles", { size: 16 })}
        <span>Getting Started (${completedCount}/3 completed)</span>
      </div>
      <button class="btn-icon" id="checklist-dismiss-btn" title="Dismiss guidance checklist" aria-label="Dismiss checklist">
        ${icon("x", { size: 14 })}
      </button>
    </div>
    <div class="checklist-items">
      <div class="checklist-item ${booksDone ? "checklist-item--done" : ""}">
        <span class="checklist-check ${booksDone ? "checklist-check--done" : ""}">
          ${icon(booksDone ? "check" : "books", { size: 13 })}
        </span>
        <span class="checklist-text">1. Add or import your books</span>
      </div>
      <div class="checklist-item ${loansDone ? "checklist-item--done" : ""}">
        <span class="checklist-check ${loansDone ? "checklist-check--done" : ""}">
          ${icon(loansDone ? "check" : "book", { size: 13 })}
        </span>
        <span class="checklist-text">2. Record your first loan</span>
      </div>
      <div class="checklist-item ${waDone ? "checklist-item--done" : ""}" id="checklist-item-wa" style="cursor:pointer;" title="Click to complete step">
        <span class="checklist-check ${waDone ? "checklist-check--done" : ""}">
          ${icon(waDone ? "check" : "whatsapp", { size: 13 })}
        </span>
        <span class="checklist-text">3. Set up WhatsApp reminders ${waDone ? "(Ready)" : "(Click to mark ready)"}</span>
      </div>
    </div>
  `;

  card.querySelector("#checklist-dismiss-btn")?.addEventListener("click", () => {
    localStorage.setItem("rcf_checklist_dismissed", "true");
    card.hidden = true;
  });

  card.querySelector("#checklist-item-wa")?.addEventListener("click", () => {
    localStorage.setItem("rcf_checklist_wa_done", "true");
    updateChecklist();
  });
}

/* ════════════════════════════════════════════════════════════
   LOANS LIST RENDERING (Desktop Table & Mobile Accordion Cards)
   ════════════════════════════════════════════════════════════ */

function renderLoansList(visible, isEmpty, today) {
  const listEl = document.getElementById("loans-list");
  if (!listEl) return;

  updateSummaryLine(visible.length, _loans.length);
  updateChecklist();

  if (isEmpty) {
    listEl.innerHTML = emptyStateLoans();
    document.getElementById("empty-new-loan-btn")?.addEventListener("click", openNewLoanModal);
    return;
  }

  if (visible.length === 0) {
    listEl.innerHTML = emptyStateNoResults();
    document.getElementById("clear-search-btn")?.addEventListener("click", () => {
      const searchInput = document.getElementById("global-search");
      if (searchInput) searchInput.value = "";
      setLoansSearch("");
      const clearBtn = document.getElementById("search-clear-btn");
      if (clearBtn) clearBtn.hidden = true;
    });
    return;
  }

  // Group visible loans into sections: Overdue, Due Soon, Active, Returned
  const groups = {
    overdue: [],
    dueSoon: [],
    active: [],
    returned: [],
  };

  visible.forEach((loan) => {
    const { status } = computeLoanStatus(loan, today);
    const diff = dayDiff(loan.dueOn, today);
    if (status === "returned") {
      groups.returned.push(loan);
    } else if (status === "overdue") {
      groups.overdue.push(loan);
    } else if (diff >= 0 && diff <= 3) {
      groups.dueSoon.push(loan);
    } else {
      groups.active.push(loan);
    }
  });

  const sectionOrder = [
    { key: "overdue", label: "Overdue", icon: "alert", items: groups.overdue },
    { key: "dueSoon", label: "Due Soon", icon: "clock", items: groups.dueSoon },
    { key: "active", label: "Active", icon: "book", items: groups.active },
    { key: "returned", label: "Returned", icon: "check", items: groups.returned },
  ];

  // Desktop table (sticky header, row hover highlight, primary action + overflow menu)
  const tableHtml = `
    <div class="table-wrap desktop-only">
      <table class="data-table" aria-label="Loans list">
        <thead>
          <tr>
            <th scope="col">Book</th>
            <th scope="col">Borrower</th>
            <th scope="col">Borrowed</th>
            <th scope="col">Due Date</th>
            <th scope="col">Status</th>
            <th scope="col">Timeline</th>
            <th scope="col" style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${sectionOrder.map((sec) => {
            if (sec.items.length === 0) return "";
            return `
              <tr class="section-divider-row">
                <td colspan="7" class="loans-section-header loans-section-header--${sec.key}">
                  ${icon(sec.icon, { size: 14 })}
                  <span>${sec.label} (${sec.items.length})</span>
                </td>
              </tr>
              ${sec.items.map((l) => loanRow(l, today)).join("")}
            `;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  // Mobile cards (compact accordion with status bar, quick call/wa buttons, expandable details)
  const cardsHtml = `
    <div class="mobile-only">
      ${sectionOrder.map((sec) => {
        if (sec.items.length === 0) return "";
        return `
          <div class="loans-section-header loans-section-header--${sec.key}">
            ${icon(sec.icon, { size: 14 })}
            <span>${sec.label} (${sec.items.length})</span>
          </div>
          ${sec.items.map((l) => loanCard(l, today)).join("")}
        `;
      }).join("")}
    </div>`;

  listEl.innerHTML = tableHtml + cardsHtml;
  bindLoanActions();
}

function loanRow(loan, today) {
  const { status, daysText } = computeLoanStatus(loan, today);
  const diff = dayDiff(loan.dueOn, today);
  const isReturned = status === "returned";

  const primaryBtn = isReturned
    ? `<button class="btn btn--outline btn--sm btn-reopen" data-id="${escHtml(loan.id)}" title="Reopen loan" aria-label="Reopen loan">
        ${icon("undo", { size: 14 })}
        <span>Reopen</span>
      </button>`
    : `<button class="btn btn--primary btn--sm btn-return" data-id="${escHtml(loan.id)}" title="Mark returned" aria-label="Mark returned">
        ${icon("check", { size: 14 })}
        <span>Return</span>
      </button>`;

  const overflowMenu = `
    <div class="action-overflow-wrap">
      <button class="btn-icon btn-action-more" aria-label="More actions for ${escHtml(loan.bookTitle)}" aria-haspopup="true" aria-expanded="false" data-id="${escHtml(loan.id)}">
        ${icon("more-vertical", { size: 16 })}
      </button>
      <div class="action-overflow-menu" hidden role="menu">
        ${!isReturned ? `
          <button class="action-menu-item btn-extend" data-id="${escHtml(loan.id)}" role="menuitem">
            ${icon("calendar", { size: 14 })}
            <span>Extend due date</span>
          </button>
          <button class="action-menu-item btn-remind" data-id="${escHtml(loan.id)}" role="menuitem">
            ${icon("whatsapp", { size: 14 })}
            <span>Send reminder</span>
          </button>
        ` : ""}
        <a href="tel:${escHtml(loan.borrowerPhone)}" class="action-menu-item" role="menuitem">
          ${icon("phone", { size: 14 })}
          <span>Call ${escHtml(loan.borrowerName)}</span>
        </a>
        <button class="action-menu-item btn-edit-loan" data-id="${escHtml(loan.id)}" role="menuitem">
          ${icon("edit", { size: 14 })}
          <span>Edit loan</span>
        </button>
        <button class="action-menu-item action-menu-item--danger btn-delete-loan" data-id="${escHtml(loan.id)}" role="menuitem">
          ${icon("trash", { size: 14 })}
          <span>Delete loan</span>
        </button>
      </div>
    </div>`;

  return `
    <tr data-loan-id="${escHtml(loan.id)}" class="loan-row loan-row--${escHtml(status)}">
      <td>
        <div class="td-title" title="${escHtml(loan.bookTitle)}">${escHtml(loan.bookTitle)}</div>
        <div class="td-sub">${escHtml(loan.bookAuthor || "")}</div>
      </td>
      <td>
        <div style="font-weight:600;">${escHtml(loan.borrowerName)}</div>
        <div class="td-sub">${escHtml(loan.borrowerPhone)}</div>
      </td>
      <td>${friendlyDate(loan.borrowedOn)}</td>
      <td>${friendlyDate(loan.dueOn)}</td>
      <td>${statusBadge(status)}</td>
      <td>${daysChip(status, daysText, diff)}</td>
      <td class="td-actions" style="display:flex; align-items:center; justify-content:flex-end; gap:0.5rem;">
        ${primaryBtn}
        ${overflowMenu}
      </td>
    </tr>`;
}

function loanCard(loan, today) {
  const { status, daysText } = computeLoanStatus(loan, today);
  const diff = dayDiff(loan.dueOn, today);
  const isReturned = status === "returned";

  return `
    <div class="loan-card card loan-card--${escHtml(status)}" data-loan-id="${escHtml(loan.id)}">
      <div class="loan-card__main" role="button" tabindex="0" aria-expanded="false" aria-label="Toggle details for ${escHtml(loan.bookTitle)}">
        <div class="loan-card__header">
          <div>
            <div class="loan-card__title" title="${escHtml(loan.bookTitle)}">${escHtml(loan.bookTitle)}</div>
            <div class="loan-card__author">${escHtml(loan.bookAuthor || "")}</div>
          </div>
          ${statusBadge(status)}
        </div>
        <div class="loan-card__borrower">
          <span style="font-weight:600;">${escHtml(loan.borrowerName)}</span>
          <span class="loan-card__phone">${escHtml(loan.borrowerPhone)}</span>
        </div>
        <div class="loan-card__footer">
          <div class="loan-card__quick-contact">
            <button class="quick-icon-btn quick-icon-btn--wa btn-quick-wa" data-id="${escHtml(loan.id)}" title="WhatsApp reminder" aria-label="Send WhatsApp to ${escHtml(loan.borrowerName)}">
              ${icon("whatsapp", { size: 16 })}
            </button>
            <a href="tel:${escHtml(loan.borrowerPhone)}" class="quick-icon-btn quick-icon-btn--call" title="Call borrower" aria-label="Call ${escHtml(loan.borrowerName)}">
              ${icon("phone", { size: 15 })}
            </a>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            ${daysChip(status, daysText, diff)}
            <span class="card-expand-caret" style="color:var(--clr-text-muted); display:inline-flex;">${icon("chevron-down", { size: 15 })}</span>
          </div>
        </div>
      </div>
      <div class="loan-card__expanded" hidden>
        <div class="loan-card__dates">
          <span style="display:inline-flex; align-items:center; gap:0.35rem;">${icon("calendar", { size: 13 })} Borrowed: <strong>${friendlyDate(loan.borrowedOn)}</strong></span>
          <span style="display:inline-flex; align-items:center; gap:0.35rem;">${icon("clock", { size: 13 })} Due: <strong>${friendlyDate(loan.dueOn)}</strong></span>
          ${loan.notes ? `<div class="loan-card__notes" style="margin-top:0.25rem;"><strong>Notes:</strong> ${escHtml(loan.notes)}</div>` : ""}
        </div>
        <div class="loan-card__actions">
          ${!isReturned ? `
            <button class="btn btn--primary btn--sm btn-return" data-id="${escHtml(loan.id)}">${icon("check", { size: 14 })}<span>Return</span></button>
            <button class="btn btn--outline btn--sm btn-extend" data-id="${escHtml(loan.id)}">${icon("calendar", { size: 14 })}<span>Extend</span></button>
            <button class="btn btn--outline btn--sm btn-remind" data-id="${escHtml(loan.id)}">${icon("whatsapp", { size: 14 })}<span>Remind</span></button>
          ` : `
            <button class="btn btn--outline btn--sm btn-reopen" data-id="${escHtml(loan.id)}">${icon("undo", { size: 14 })}<span>Reopen</span></button>
          `}
          <button class="btn btn--outline btn--sm btn-edit-loan" data-id="${escHtml(loan.id)}">${icon("edit", { size: 14 })}<span>Edit</span></button>
          <button class="btn btn--danger btn--sm btn-delete-loan" data-id="${escHtml(loan.id)}">${icon("trash", { size: 14 })}<span>Delete</span></button>
        </div>
      </div>
    </div>`;
}

function bindLoanActions() {
  // Desktop overflow menus
  document.querySelectorAll(".btn-action-more").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".action-overflow-wrap");
      const menu = wrap?.querySelector(".action-overflow-menu");
      const isExpanded = btn.getAttribute("aria-expanded") === "true";

      // Close all other menus first
      document.querySelectorAll(".action-overflow-menu").forEach((m) => {
        if (m !== menu) m.hidden = true;
      });
      document.querySelectorAll(".btn-action-more").forEach((b) => {
        if (b !== btn) b.setAttribute("aria-expanded", "false");
      });

      if (menu) {
        menu.hidden = isExpanded;
        btn.setAttribute("aria-expanded", (!isExpanded).toString());
      }
    });
  });

  // Global click listener to close overflow menus
  document.addEventListener("click", () => {
    document.querySelectorAll(".action-overflow-menu").forEach((m) => { m.hidden = true; });
    document.querySelectorAll(".btn-action-more").forEach((b) => { b.setAttribute("aria-expanded", "false"); });
  });

  // Mobile accordion cards
  document.querySelectorAll(".loan-card__main").forEach((cardMain) => {
    cardMain.addEventListener("click", (e) => {
      if (e.target.closest(".quick-icon-btn")) return;

      const card = cardMain.closest(".loan-card");
      const expanded = card.querySelector(".loan-card__expanded");
      const caret = card.querySelector(".card-expand-caret");
      if (!expanded) return;

      const isHidden = expanded.hidden;
      expanded.hidden = !isHidden;
      cardMain.setAttribute("aria-expanded", isHidden.toString());
      if (caret) {
        caret.innerHTML = isHidden ? icon("chevron-up", { size: 15 }) : icon("chevron-down", { size: 15 });
      }
    });

    // Keyboard support for accordion
    cardMain.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cardMain.click();
      }
    });
  });

  // Prevent quick phone link from bubbling
  document.querySelectorAll(".quick-icon-btn--call").forEach((a) => {
    a.addEventListener("click", (e) => e.stopPropagation());
  });

  // Quick WhatsApp button
  document.querySelectorAll(".btn-quick-wa").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendReminder(btn.dataset.id);
    });
  });

  // Action button triggers
  document.querySelectorAll(".btn-return").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); markReturned(btn.dataset.id); })
  );
  document.querySelectorAll(".btn-reopen").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); reopenLoan(btn.dataset.id); })
  );
  document.querySelectorAll(".btn-extend").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); extendDueDate(btn.dataset.id); })
  );
  document.querySelectorAll(".btn-remind").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); sendReminder(btn.dataset.id); })
  );
  document.querySelectorAll(".btn-edit-loan").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); openEditLoanModal(btn.dataset.id); })
  );
  document.querySelectorAll(".btn-delete-loan").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteLoan(btn.dataset.id); })
  );
}

/* ════════════════════════════════════════════════════════════
   NEW LOAN MODAL (Section 4: 3-step layout, combobox, date chips)
   ════════════════════════════════════════════════════════════ */

export function openNewLoanModal(preselectBook) {
  const today = todayString();
  const defaultDue = addDays(today, 30);
  const allBooks = getBooks();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "New Loan");

  overlay.innerHTML = `
    <div class="modal modal--large">
      <div class="modal__header">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--clr-primary); display:inline-flex;">${icon("book", { size: 20 })}</span>
          <h2 class="modal__title">New Loan</h2>
        </div>
        <button class="modal__close" id="nl-close" aria-label="Close modal">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        <!-- Step 1: Who is borrowing? -->
        <div class="modal-step-section">
          <div class="modal-step-heading">
            <span class="modal-step-number">1</span>
            <span>Who is borrowing?</span>
          </div>
          <div class="form-group">
            <label for="nl-phone">Borrower Phone Number <span class="required">*</span></label>
            <div class="phone-input-wrap" style="display:flex;">
              <span class="phone-prefix-chip">+234</span>
              <input type="tel" id="nl-phone" class="form-control" required
                placeholder="e.g. 0801 234 5678" autocomplete="tel" style="flex:1;">
            </div>
            <div class="field-feedback" id="nl-phone-feedback" style="margin-top:0.35rem; font-size:0.8125rem;"></div>
            <div class="field-error-msg" id="nl-phone-error" hidden></div>
          </div>
          <div class="form-group">
            <label for="nl-name">Borrower Full Name <span class="required">*</span></label>
            <input type="text" id="nl-name" class="form-control" required
              placeholder="e.g. Sister Grace Adebayo" autocomplete="name">
            <div class="field-error-msg" id="nl-name-error" hidden></div>
          </div>
        </div>

        <!-- Step 2: Which book? -->
        <div class="modal-step-section">
          <div class="modal-step-heading">
            <span class="modal-step-number">2</span>
            <span>Which book?</span>
          </div>
          <div class="form-group">
            <label for="nl-book-search">Select Book <span class="required">*</span></label>
            <div class="book-select-wrap">
              <input type="text" id="nl-book-search" class="form-control"
                placeholder="Type book title or author…" autocomplete="off" aria-autocomplete="list" aria-controls="nl-book-list">
              <div class="book-dropdown" id="nl-book-list" role="listbox" hidden></div>
              <input type="hidden" id="nl-book-id">
              <div class="selected-book" id="nl-selected-book" hidden></div>
            </div>
            <div class="field-error-msg" id="nl-book-error" hidden></div>
          </div>
        </div>

        <!-- Step 3: When is it due? -->
        <div class="modal-step-section">
          <div class="modal-step-heading">
            <span class="modal-step-number">3</span>
            <span>When is it due?</span>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="nl-borrowed">Borrowed Date <span class="required">*</span></label>
              <input type="date" id="nl-borrowed" class="form-control" value="${today}" required>
              <div class="field-error-msg" id="nl-borrowed-error" hidden></div>
            </div>
            <div class="form-group">
              <label for="nl-due">Due Date <span class="required">*</span></label>
              <input type="date" id="nl-due" class="form-control" value="${defaultDue}" required>
              <div class="quick-date-chips" role="group" aria-label="Quick due duration">
                <button type="button" class="date-chip" data-days="7">1 week</button>
                <button type="button" class="date-chip" data-days="14">2 weeks</button>
                <button type="button" class="date-chip date-chip--selected" data-days="30">1 month</button>
              </div>
              <div class="due-friendly-preview" id="nl-due-preview">
                ${icon("clock", { size: 13 })}
                <span>Due ${friendlyDate(defaultDue)}</span>
              </div>
              <div class="field-error-msg" id="nl-due-error" hidden></div>
            </div>
          </div>
          <div class="form-group">
            <label for="nl-notes">Notes <span class="optional">(optional)</span></label>
            <textarea id="nl-notes" class="form-control" rows="2" placeholder="e.g. Needs book for Bible study preparation"></textarea>
          </div>
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--outline" id="nl-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" id="nl-save">
          ${icon("check", { size: 16 })}
          <span>Create Loan</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);

  const phoneEl = overlay.querySelector("#nl-phone");
  const phoneFeedback = overlay.querySelector("#nl-phone-feedback");
  const phoneError = overlay.querySelector("#nl-phone-error");
  const nameEl = overlay.querySelector("#nl-name");
  const nameError = overlay.querySelector("#nl-name-error");

  const bookSearch = overlay.querySelector("#nl-book-search");
  const bookList = overlay.querySelector("#nl-book-list");
  const bookIdInput = overlay.querySelector("#nl-book-id");
  const selectedBook = overlay.querySelector("#nl-selected-book");
  const bookError = overlay.querySelector("#nl-book-error");

  const borrowedEl = overlay.querySelector("#nl-borrowed");
  const borrowedError = overlay.querySelector("#nl-borrowed-error");
  const dueEl = overlay.querySelector("#nl-due");
  const dueError = overlay.querySelector("#nl-due-error");
  const duePreview = overlay.querySelector("#nl-due-preview");
  const dateChips = overlay.querySelectorAll(".date-chip");
  const notesEl = overlay.querySelector("#nl-notes");

  const saveBtn = overlay.querySelector("#nl-save");
  const cancelBtn = overlay.querySelector("#nl-cancel");
  const closeBtn = overlay.querySelector("#nl-close");

  let selectedBookData = null;

  // Discard changes confirmation handler
  async function attemptClose() {
    const isDirty = phoneEl.value.trim() || nameEl.value.trim() || bookIdInput.value || notesEl.value.trim();
    if (isDirty) {
      const discard = await confirmDialog("Discard unsaved loan details?", {
        title: "Discard changes",
        confirmText: "Discard",
        danger: true,
      });
      if (!discard) return;
    }
    closeModal(overlay);
  }

  closeBtn.addEventListener("click", attemptClose);
  cancelBtn.addEventListener("click", attemptClose);

  // Phone lookup with instant returning borrower feedback
  let phoneTimeout;
  phoneEl.addEventListener("input", () => {
    clearTimeout(phoneTimeout);
    phoneFeedback.innerHTML = "";
    phoneError.hidden = true;
    phoneEl.classList.remove("input-error");

    const val = phoneEl.value.trim();
    if (!val) return;

    phoneTimeout = setTimeout(async () => {
      const res = normalizePhone(val);
      if (!res.ok) {
        if (val.replace(/\D/g, "").length >= 10) {
          phoneFeedback.innerHTML = `<span style="color:var(--clr-text-sub);">${escHtml(res.error)}</span>`;
        }
        return;
      }
      try {
        const borrowerDoc = await getDoc(doc(_db, "borrowers", res.normalized));
        if (borrowerDoc.exists()) {
          const data = borrowerDoc.data();
          if (!nameEl.value.trim()) {
            nameEl.value = data.fullName;
          }
          phoneFeedback.innerHTML = `<span style="color:var(--clr-success); font-weight:600; display:inline-flex; align-items:center; gap:0.3rem;">
            ${icon("check", { size: 14 })}
            <span>Returning borrower: <strong>${escHtml(data.fullName)}</strong></span>
          </span>`;
        } else {
          phoneFeedback.innerHTML = `<span style="color:var(--clr-text-sub); font-size:0.8125rem;">New borrower</span>`;
        }
      } catch (err) {
        // Silent catch for offline lookup
      }
    }, 350);
  });

  // Book Combobox Dropdown
  function filterAndRenderDropdown() {
    const q = bookSearch.value.trim().toLowerCase();
    const filtered = allBooks.filter((b) => {
      if (!q) return true;
      return (b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q);
    });
    renderBookDropdown(bookList, filtered, (book) => {
      selectBook(book);
    });
  }

  function selectBook(book) {
    selectedBookData = book;
    bookIdInput.value = book.id;
    selectedBook.innerHTML = `
      <div>
        <span class="selected-book__title">${escHtml(book.title)}</span>
        <span class="selected-book__meta">${escHtml(book.author || "")} · ${book.copiesAvailable} available</span>
      </div>
      <button type="button" class="selected-book__clear" aria-label="Clear book selection">${icon("x", { size: 14 })}</button>
    `;
    selectedBook.hidden = false;
    bookSearch.hidden = true;
    bookList.hidden = true;
    bookError.hidden = true;
    bookSearch.classList.remove("input-error");

    selectedBook.querySelector(".selected-book__clear").addEventListener("click", () => {
      selectedBookData = null;
      bookIdInput.value = "";
      selectedBook.hidden = true;
      bookSearch.hidden = false;
      bookSearch.value = "";
      bookSearch.focus();
    });
  }

  if (preselectBook) selectBook(preselectBook);

  bookSearch.addEventListener("focus", () => {
    filterAndRenderDropdown();
    bookList.hidden = false;
  });

  bookSearch.addEventListener("input", () => {
    filterAndRenderDropdown();
    bookList.hidden = false;
  });

  // Keyboard navigation for book combobox
  let highlightedIndex = -1;
  bookSearch.addEventListener("keydown", (e) => {
    const selectable = Array.from(bookList.querySelectorAll(".book-dropdown__item[data-book-id]"));
    if (selectable.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % selectable.length;
      selectable.forEach((item, idx) => item.classList.toggle("book-dropdown__item--selected", idx === highlightedIndex));
      selectable[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = (highlightedIndex - 1 + selectable.length) % selectable.length;
      selectable.forEach((item, idx) => item.classList.toggle("book-dropdown__item--selected", idx === highlightedIndex));
      selectable[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && selectable[highlightedIndex]) {
        selectable[highlightedIndex].click();
      }
    } else if (e.key === "Escape") {
      bookList.hidden = true;
    }
  });

  // Click outside closes dropdown
  document.addEventListener("click", (e) => {
    if (!overlay.querySelector(".book-select-wrap")?.contains(e.target)) {
      bookList.hidden = true;
    }
  }, { capture: true });

  // Quick Select Date Chips
  dateChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      dateChips.forEach((c) => c.classList.remove("date-chip--selected"));
      chip.classList.add("date-chip--selected");

      const days = parseInt(chip.dataset.days, 10);
      const start = borrowedEl.value || today;
      const calculated = addDays(start, days);
      dueEl.value = calculated;
      duePreview.innerHTML = `${icon("clock", { size: 13 })} <span>Due ${friendlyDate(calculated)}</span>`;
      dueError.hidden = true;
      dueEl.classList.remove("input-error");
    });
  });

  // Custom Due Date Picker change
  dueEl.addEventListener("input", () => {
    dateChips.forEach((c) => c.classList.remove("date-chip--selected"));
    if (dueEl.value) {
      duePreview.innerHTML = `${icon("clock", { size: 13 })} <span>Due ${friendlyDate(dueEl.value)}</span>`;
    }
  });

  // Borrowed Date change
  borrowedEl.addEventListener("change", () => {
    const selectedChip = overlay.querySelector(".date-chip--selected");
    if (selectedChip) {
      const days = parseInt(selectedChip.dataset.days, 10);
      const calculated = addDays(borrowedEl.value || today, days);
      dueEl.value = calculated;
      duePreview.innerHTML = `${icon("clock", { size: 13 })} <span>Due ${friendlyDate(calculated)}</span>`;
    } else if (borrowedEl.value && (!dueEl.value || dueEl.value < borrowedEl.value)) {
      dueEl.value = addDays(borrowedEl.value, 30);
      duePreview.innerHTML = `${icon("clock", { size: 13 })} <span>Due ${friendlyDate(dueEl.value)}</span>`;
    }
  });

  // Save handler with inline field validation & toast undo
  saveBtn.addEventListener("click", async () => {
    clearFieldErrors(overlay);

    const phone = phoneEl.value.trim();
    const name = nameEl.value.trim();
    const bookId = bookIdInput.value;
    const borrowedOn = borrowedEl.value;
    const dueOn = dueEl.value;
    const notes = notesEl.value.trim();

    let firstInvalid = null;

    // Validate phone
    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      showFieldError(phoneEl, phoneError, phoneResult.error);
      if (!firstInvalid) firstInvalid = phoneEl;
    }

    // Validate name
    if (!name) {
      showFieldError(nameEl, nameError, "Borrower name is required.");
      if (!firstInvalid) firstInvalid = nameEl;
    }

    // Validate book
    if (!bookId) {
      showFieldError(bookSearch, bookError, "Please select a book from the catalog.");
      if (!firstInvalid) firstInvalid = bookSearch;
    }

    // Validate dates
    if (!borrowedOn) {
      showFieldError(borrowedEl, borrowedError, "Borrowed date is required.");
      if (!firstInvalid) firstInvalid = borrowedEl;
    }
    if (!dueOn) {
      showFieldError(dueEl, dueError, "Due date is required.");
      if (!firstInvalid) firstInvalid = dueEl;
    } else if (borrowedOn && dueOn < borrowedOn) {
      showFieldError(dueEl, dueError, "Due date cannot be before borrowed date.");
      if (!firstInvalid) firstInvalid = dueEl;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const normalizedPhone = phoneResult.normalized;

    // Duplicate loan check
    const dupCheck = _loans.find(
      (l) => l.borrowerId === normalizedPhone && l.bookId === bookId && !l.returnedOn
    );
    if (dupCheck) {
      const proceed = await confirmDialog(
        `${name} already has an active loan for this book. Create another loan anyway?`,
        { title: "Duplicate active loan", confirmText: "Create Anyway", danger: false }
      );
      if (!proceed) return;
    }

    const restore = setButtonLoading(saveBtn, "Creating loan…");
    try {
      const newLoanId = await createLoanTransaction({
        bookId,
        borrowerId: normalizedPhone,
        borrowerPhone: normalizedPhone,
        borrowerName: name,
        borrowedOn,
        dueOn,
        notes,
      });

      // Brief success checkmark feedback before closing
      saveBtn.innerHTML = `<span style="display:inline-flex; align-items:center; gap:0.4rem;">${icon("check", { size: 16 })} <span>Created!</span></span>`;

      setTimeout(() => {
        closeModal(overlay);
        // Show stackable toast with 6-second Undo action
        showToast("Loan created successfully!", "success", 6000, {
          actionText: "Undo",
          onAction: async () => {
            try {
              await undoCreateLoan(newLoanId, bookId);
              showToast("Loan creation undone.", "info");
            } catch (undoErr) {
              console.error("Undo error:", undoErr);
              showToast("Could not undo: " + undoErr.message, "error");
            }
          },
        });
      }, 250);
    } catch (err) {
      console.error(err);
      restore();
      showToast(err.message || "Failed to create loan. Please try again.", "error");
    }
  });
}

function renderBookDropdown(listEl, books, onSelect) {
  listEl.innerHTML = "";

  if (books.length === 0) {
    const empty = document.createElement("div");
    empty.className = "book-dropdown__item book-dropdown__item--empty";
    empty.textContent = "No matching books found";
    listEl.appendChild(empty);
    return;
  }

  books.forEach((b) => {
    const isAvail = (b.copiesAvailable || 0) > 0;
    const item = document.createElement(isAvail ? "button" : "div");
    item.className = `book-dropdown__item ${!isAvail ? "book-dropdown__item--disabled" : ""}`;
    item.setAttribute("role", "option");

    if (isAvail) {
      item.type = "button";
      item.dataset.bookId = b.id;
      item.innerHTML = `
        <span class="book-opt-title">${escHtml(b.title)}</span>
        <span class="book-opt-meta">${escHtml(b.author || "")} · <span class="badge badge--soft-blue">${b.copiesAvailable} of ${b.copiesTotal || 1} available</span></span>
      `;
      item.addEventListener("click", () => onSelect(b));
    } else {
      item.setAttribute("aria-disabled", "true");
      item.style.opacity = "0.55";
      item.style.cursor = "not-allowed";
      item.innerHTML = `
        <span class="book-opt-title">${escHtml(b.title)}</span>
        <span class="book-opt-meta">${escHtml(b.author || "")} · <span class="badge badge--soft-red">None available</span></span>
      `;
    }

    listEl.appendChild(item);
  });
}

/* ════════════════════════════════════════════════════════════
   CREATE & UNDO LOAN TRANSACTIONS
   ════════════════════════════════════════════════════════════ */

async function createLoanTransaction({ bookId, borrowerId, borrowerPhone, borrowerName, borrowedOn, dueOn, notes }) {
  const bookRef = doc(_db, "books", bookId);
  const borrowerRef = doc(_db, "borrowers", borrowerId);
  const loansCol = collection(_db, "loans");
  const loanRef = doc(loansCol);

  await runTransaction(_db, async (tx) => {
    const bookSnap = await tx.get(bookRef);
    if (!bookSnap.exists()) throw new Error("Book not found.");

    const bookData = bookSnap.data();
    if ((bookData.copiesAvailable || 0) < 1) {
      throw new Error("No copies available for this book right now.");
    }

    // Decrement copies
    tx.update(bookRef, { copiesAvailable: bookData.copiesAvailable - 1 });

    // Upsert borrower
    const borrowerSnap = await tx.get(borrowerRef);
    if (!borrowerSnap.exists()) {
      tx.set(borrowerRef, {
        fullName: borrowerName,
        phone: borrowerPhone,
        createdAt: serverTimestamp(),
      });
    } else if (borrowerSnap.data().fullName !== borrowerName) {
      tx.update(borrowerRef, { fullName: borrowerName });
    }

    // Create loan
    tx.set(loanRef, {
      bookId,
      bookTitle: bookData.title,
      bookAuthor: bookData.author || "",
      borrowerId,
      borrowerName,
      borrowerPhone,
      borrowedOn,
      dueOn,
      returnedOn: null,
      notes: notes || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return loanRef.id;
}

export async function undoCreateLoan(loanId, bookId) {
  await runTransaction(_db, async (tx) => {
    const loanRef = doc(_db, "loans", loanId);
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) return;

    tx.delete(loanRef);

    const bookRef = doc(_db, "books", bookId);
    const bookSnap = await tx.get(bookRef);
    if (bookSnap.exists()) {
      const book = bookSnap.data();
      const newAvail = Math.min((book.copiesAvailable || 0) + 1, book.copiesTotal || 1);
      tx.update(bookRef, { copiesAvailable: newAvail });
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RECORD ACTIONS
   ════════════════════════════════════════════════════════════ */

async function markReturned(loanId) {
  const ok = await confirmDialog(
    "Mark this book as returned? This will return 1 copy to the shelf.",
    { title: "Mark as Returned", confirmText: "Mark Returned", danger: false }
  );
  if (!ok) return;

  const today = todayString();
  const loanRef = doc(_db, "loans", loanId);

  try {
    await runTransaction(_db, async (tx) => {
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists()) throw new Error("Loan not found.");
      const loan = loanSnap.data();
      if (loan.returnedOn) throw new Error("Loan is already returned.");

      const bookRef = doc(_db, "books", loan.bookId);
      const bookSnap = await tx.get(bookRef);

      tx.update(loanRef, { returnedOn: today, updatedAt: serverTimestamp() });

      if (bookSnap.exists()) {
        const book = bookSnap.data();
        const newAvail = Math.min((book.copiesAvailable || 0) + 1, book.copiesTotal || 1);
        tx.update(bookRef, { copiesAvailable: newAvail });
      }
    });
    showToast("Marked as returned.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to mark returned: " + err.message, "error");
  }
}

async function reopenLoan(loanId) {
  const ok = await confirmDialog(
    "Reopen this loan? This will take 1 copy off the shelf.",
    { title: "Reopen Loan", confirmText: "Reopen Loan", danger: false }
  );
  if (!ok) return;

  const loanRef = doc(_db, "loans", loanId);

  try {
    await runTransaction(_db, async (tx) => {
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists()) throw new Error("Loan not found.");
      const loan = loanSnap.data();
      if (!loan.returnedOn) throw new Error("Loan is not returned.");

      const bookRef = doc(_db, "books", loan.bookId);
      const bookSnap = await tx.get(bookRef);

      if (!bookSnap.exists()) throw new Error("Book not found — it may have been deleted.");
      const book = bookSnap.data();
      if ((book.copiesAvailable || 0) < 1) {
        throw new Error("No copies available to reopen this loan. All copies are currently out.");
      }

      tx.update(loanRef, { returnedOn: null, updatedAt: serverTimestamp() });
      tx.update(bookRef, { copiesAvailable: (book.copiesAvailable || 0) - 1 });
    });
    showToast("Loan reopened.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to reopen loan: " + err.message, "error");
  }
}

async function extendDueDate(loanId) {
  const loan = _loans.find((l) => l.id === loanId);
  if (!loan) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Extend Due Date");

  const minDate = addDays(loan.dueOn, 1);

  overlay.innerHTML = `
    <div class="modal modal--small">
      <div class="modal__header">
        <h2 class="modal__title">Extend Due Date</h2>
        <button class="modal__close" aria-label="Close">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        <p style="font-size:0.875rem; margin-bottom:1rem; color:var(--clr-text-sub);">
          Current due date: <strong style="color:var(--clr-text);">${friendlyDate(loan.dueOn)}</strong>
        </p>
        <div class="form-group">
          <label for="ext-date">New Due Date <span class="required">*</span></label>
          <input type="date" id="ext-date" class="form-control" min="${minDate}" value="${minDate}" required>
          <div class="field-error-msg" id="ext-error" hidden></div>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--outline" id="ext-cancel">Cancel</button>
        <button class="btn btn--primary" id="ext-save">
          ${icon("calendar", { size: 15 })}
          <span>Extend</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);
  overlay.querySelector(".modal__close").addEventListener("click", () => closeModal(overlay));
  overlay.querySelector("#ext-cancel").addEventListener("click", () => closeModal(overlay));

  const saveBtn = overlay.querySelector("#ext-save");
  const errorEl = overlay.querySelector("#ext-error");
  const dateInput = overlay.querySelector("#ext-date");

  saveBtn.addEventListener("click", async () => {
    const newDate = dateInput.value;
    if (!newDate) {
      showFieldError(dateInput, errorEl, "Please select a new due date.");
      return;
    }
    if (newDate <= loan.dueOn) {
      showFieldError(dateInput, errorEl, `New due date must be after current due date (${friendlyDate(loan.dueOn)}).`);
      return;
    }

    const restore = setButtonLoading(saveBtn, "Extending…");
    try {
      await updateDoc(doc(_db, "loans", loanId), {
        dueOn: newDate,
        updatedAt: serverTimestamp(),
      });
      showToast("Due date extended.", "success");
      closeModal(overlay);
    } catch (err) {
      showFieldError(dateInput, errorEl, "Failed to extend: " + err.message);
    } finally {
      restore();
    }
  });
}

function sendReminder(loanId) {
  const loan = _loans.find((l) => l.id === loanId);
  if (!loan) return;
  const today = todayString();
  const url = buildWhatsAppURL(loan, today);
  window.open(url, "_blank", "noopener,noreferrer");
}

async function openEditLoanModal(loanId) {
  const loan = _loans.find((l) => l.id === loanId);
  if (!loan) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Edit Loan");

  overlay.innerHTML = `
    <div class="modal modal--large">
      <div class="modal__header">
        <h2 class="modal__title">Edit Loan</h2>
        <button class="modal__close" aria-label="Close">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        <div class="info-banner" style="display:flex; align-items:center; gap:0.4rem; padding:0.65rem 0.875rem; background:var(--clr-surface-alt); border:1px solid var(--clr-border); border-radius:var(--radius); margin-bottom:1.25rem; font-size:0.875rem;">
          ${icon("book", { size: 15 })}
          <span>Book: <strong>${escHtml(loan.bookTitle)}</strong> (cannot be changed)</span>
        </div>
        <div class="form-group">
          <label for="ed-name">Borrower Full Name <span class="required">*</span></label>
          <input type="text" id="ed-name" class="form-control" value="${escHtml(loan.borrowerName)}" required>
          <div class="field-error-msg" id="ed-name-error" hidden></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="ed-borrowed">Borrowed Date</label>
            <input type="date" id="ed-borrowed" class="form-control" value="${loan.borrowedOn}">
          </div>
          <div class="form-group">
            <label for="ed-due">Due Date</label>
            <input type="date" id="ed-due" class="form-control" value="${loan.dueOn}">
            <div class="field-error-msg" id="ed-due-error" hidden></div>
          </div>
        </div>
        <div class="form-group">
          <label for="ed-notes">Notes</label>
          <textarea id="ed-notes" class="form-control" rows="3">${escHtml(loan.notes || "")}</textarea>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--outline" id="ed-cancel">Cancel</button>
        <button class="btn btn--primary" id="ed-save">
          ${icon("check", { size: 15 })}
          <span>Save Changes</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);
  overlay.querySelector(".modal__close").addEventListener("click", () => closeModal(overlay));
  overlay.querySelector("#ed-cancel").addEventListener("click", () => closeModal(overlay));

  const saveBtn = overlay.querySelector("#ed-save");
  const nameEl = overlay.querySelector("#ed-name");
  const nameError = overlay.querySelector("#ed-name-error");
  const dueEl = overlay.querySelector("#ed-due");
  const dueError = overlay.querySelector("#ed-due-error");

  saveBtn.addEventListener("click", async () => {
    nameError.hidden = true;
    dueError.hidden = true;

    const name = nameEl.value.trim();
    const borrowedOn = overlay.querySelector("#ed-borrowed").value;
    const dueOn = dueEl.value;
    const notes = overlay.querySelector("#ed-notes").value.trim();

    if (!name) {
      showFieldError(nameEl, nameError, "Name is required.");
      nameEl.focus();
      return;
    }
    if (dueOn && borrowedOn && dueOn < borrowedOn) {
      showFieldError(dueEl, dueError, "Due date cannot be before borrowed date.");
      dueEl.focus();
      return;
    }

    const restore = setButtonLoading(saveBtn, "Saving…");
    try {
      const updates = { borrowerName: name, notes, updatedAt: serverTimestamp() };
      if (borrowedOn) updates.borrowedOn = borrowedOn;
      if (dueOn) updates.dueOn = dueOn;

      await updateDoc(doc(_db, "loans", loanId), updates);

      // Update borrower name in borrower collection if changed
      if (name !== loan.borrowerName) {
        const borrowerRef = doc(_db, "borrowers", loan.borrowerId);
        await updateDoc(borrowerRef, { fullName: name }).catch(() => {});
      }

      showToast("Loan updated successfully.", "success");
      closeModal(overlay);
    } catch (err) {
      showToast("Failed to save: " + err.message, "error");
    } finally {
      restore();
    }
  });
}

async function deleteLoan(loanId) {
  const loan = _loans.find((l) => l.id === loanId);
  if (!loan) return;

  const ok = await confirmDialog(
    `Delete this loan record for "${loan.bookTitle}" borrowed by ${loan.borrowerName}? This will return 1 copy to the shelf. This action cannot be undone.`,
    { title: "Delete Loan Record", confirmText: "Delete Record", danger: true }
  );
  if (!ok) return;

  const today = todayString();
  const { status } = computeLoanStatus(loan, today);
  const isActive = status !== "returned";

  try {
    await runTransaction(_db, async (tx) => {
      const loanRef = doc(_db, "loans", loanId);
      tx.delete(loanRef);

      // If loan was active, restore the copy to the shelf
      if (isActive) {
        const bookRef = doc(_db, "books", loan.bookId);
        const bookSnap = await tx.get(bookRef);
        if (bookSnap.exists()) {
          const book = bookSnap.data();
          const newAvail = Math.min((book.copiesAvailable || 0) + 1, book.copiesTotal || 1);
          tx.update(bookRef, { copiesAvailable: newAvail });
        }
      }
    });
    showToast("Loan deleted.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to delete loan: " + err.message, "error");
  }
}

/* ════════════════════════════════════════════════════════════
   CSV EXPORT
   ════════════════════════════════════════════════════════════ */

export function exportCSV() {
  const today = todayString();
  const sorted = sortLoans(_loans, today);
  const visible = applyFilterAndSearch(sorted, today);

  if (visible.length === 0) {
    showToast("Nothing to export — no records match the current filter/search.", "info");
    return;
  }

  const csv = buildCSV(visible, today);
  if (!csv) {
    showToast("Nothing to export.", "info");
    return;
  }

  const filename = `library-records-${today}.csv`;
  downloadCSV(csv, filename);
  showToast(`Exported ${visible.length} record(s).`, "success");
}

/* ════════════════════════════════════════════════════════════
   SEARCH & FILTER STATE (called from app.js)
   ════════════════════════════════════════════════════════════ */

export function setLoansSearch(q) {
  _search = q;
  renderLoansTab(_loans);
}

export function setLoansFilter(f) {
  _filter = f;
  renderLoansTab(_loans);
}

/* ════════════════════════════════════════════════════════════
   VALIDATION HELPERS
   ════════════════════════════════════════════════════════════ */

function showFieldError(inputEl, errorEl, msg) {
  if (errorEl) {
    errorEl.innerHTML = `${icon("alert", { size: 13 })} <span>${escHtml(msg)}</span>`;
    errorEl.hidden = false;
  }
  if (inputEl) {
    inputEl.classList.add("input-error");
  }
}

function clearFieldErrors(overlay) {
  overlay.querySelectorAll(".field-error-msg").forEach((el) => {
    el.hidden = true;
    el.innerHTML = "";
  });
  overlay.querySelectorAll(".input-error").forEach((el) => el.classList.remove("input-error"));
}
