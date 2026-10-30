/**
 * books.js
 * ─────────────────────────────────────────────────────────────────────
 * Books tab: listing, add, edit, delete, copy-count management,
 * sample books loader, and the Books tab modal.
 * ─────────────────────────────────────────────────────────────────────
 */

import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { showToast, confirmDialog, openModal, closeModal, setButtonLoading, statusBadge, emptyStateBooks } from "./ui.js";
import { icon } from "./icons.js";
import { escHtml, friendlyDate, todayString, parseCSV, detectColumnMapping, downloadCSV, categoryColorIndex, csvCell, buildWhatsAppURL, dayDiff } from "./utils.js";
import { getActiveLoansForBook, getLoanHistoryForBook, openNewLoanModal } from "./loans.js";

let _db = null;
let _unsubBooks = null;

/** In-memory cache of all books (populated by the snapshot listener). */
let _books = [];

/** Current sort mode: "title" | "most-borrowed" | "avail" */
let _bookSort = "title";

/** Suggested categories offered in the Add/Edit form — librarians can add their own. */
const SEED_CATEGORIES = [
  "Prayer", "Faith", "Marriage & Family", "Leadership", "Finance & Wealth",
  "Youth", "Devotional", "Biography", "Bible Study", "Healing", "Evangelism", "Other",
];

/** Returns the distinct non-empty values of a book field, sorted, for datalist suggestions. */
function distinctBookValues(field) {
  const set = new Set();
  _books.forEach((b) => {
    const v = (b[field] || "").trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

const SAMPLE_BOOKS = [
  { title: "Mere Christianity", author: "C.S. Lewis", totalPages: 227, copiesTotal: 2 },
  { title: "The Purpose Driven Life", author: "Rick Warren", totalPages: 368, copiesTotal: 3 },
  { title: "Boundaries", author: "Henry Cloud & John Townsend", totalPages: 352, copiesTotal: 2 },
  { title: "The Case for Christ", author: "Lee Strobel", totalPages: 384, copiesTotal: 1 },
  { title: "Redeeming Love", author: "Francine Rivers", totalPages: 464, copiesTotal: 2 },
];

export function initBooks(app) {
  _db = getFirestore(app);
}

/** Returns a snapshot of the current books array (for use in loan forms). */
export function getBooks() {
  return _books;
}

/**
 * Starts the real-time listener for the books collection.
 * Calls `onUpdate(books)` whenever data changes.
 * Returns the unsubscribe function.
 */
export function subscribeBooks(onUpdate) {
  if (_unsubBooks) _unsubBooks();

  _unsubBooks = onSnapshot(
    collection(_db, "books"),
    (snap) => {
      _books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onUpdate(_books);
    },
    (err) => {
      console.error("Books snapshot error:", err);
      showToast("Couldn't load the books. Check your internet connection and try again.", "error");
    }
  );

  return () => {
    if (_unsubBooks) { _unsubBooks(); _unsubBooks = null; }
  };
}

/** Stops the books listener. Called on logout. */
export function unsubscribeBooks() {
  if (_unsubBooks) { _unsubBooks(); _unsubBooks = null; }
}

/* ════════════════════════════════════════════════════════════
   BOOKS TAB RENDERING
   ════════════════════════════════════════════════════════════ */

let _searchQuery = "";

/** "all" | "Uncategorized" | a specific category string */
let _categoryFilter = "all";

/** "all" | "__none__" | a specific shelf location string */
let _shelfFilter = "all";

/** "all" | "available" | "all-out" */
let _availFilter = "all";

const UNCATEGORIZED = "Uncategorized";

function matchesCategoryFilter(b) {
  if (_categoryFilter === "all") return true;
  const cat = (b.category || "").trim();
  if (_categoryFilter === UNCATEGORIZED) return !cat;
  return cat === _categoryFilter;
}

function matchesShelfFilter(b) {
  if (_shelfFilter === "all") return true;
  const shelf = (b.shelfLocation || "").trim();
  if (_shelfFilter === "__none__") return !shelf;
  return shelf === _shelfFilter;
}

function matchesAvailFilter(b) {
  if (_availFilter === "all") return true;
  const avail = b.copiesAvailable || 0;
  if (_availFilter === "available") return avail > 0;
  return avail === 0; // "all-out"
}

function renderCountLine(visibleCount, totalCount) {
  if (visibleCount === totalCount) {
    return `${totalCount} book${totalCount === 1 ? "" : "s"}`;
  }
  return `${visibleCount} of ${totalCount} book${totalCount === 1 ? "" : "s"}`;
}

/**
 * Category chip counts are computed from the search-filtered list only
 * (ignoring the shelf/availability filters), so each chip always answers
 * "how many would I see if I picked this category, given my search".
 */
function renderCategoryChips(list) {
  const counts = new Map();
  let uncategorizedCount = 0;
  list.forEach((b) => {
    const cat = (b.category || "").trim();
    if (!cat) {
      uncategorizedCount++;
    } else {
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
  });

  const categories = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));

  const chip = (value, label, count) => `
    <button type="button" class="pill books-cat-chip ${_categoryFilter === value ? "pill--active" : ""}" data-category="${escHtml(value)}">
      <span>${escHtml(label)}</span>
      <span class="pill-badge">${count}</span>
    </button>`;

  let html = chip("all", "All", list.length);
  html += categories.map((c) => chip(c, c, counts.get(c))).join("");
  if (uncategorizedCount > 0) {
    html += chip(UNCATEGORIZED, UNCATEGORIZED, uncategorizedCount);
  }
  return html;
}

function renderShelfOptions(list) {
  const shelves = new Set();
  let noneCount = 0;
  list.forEach((b) => {
    const shelf = (b.shelfLocation || "").trim();
    if (shelf) shelves.add(shelf);
    else noneCount++;
  });
  const sorted = Array.from(shelves).sort((a, b) => a.localeCompare(b));

  let html = `<option value="all" ${_shelfFilter === "all" ? "selected" : ""}>All shelves</option>`;
  html += sorted.map((s) => `<option value="${escHtml(s)}" ${_shelfFilter === s ? "selected" : ""}>${escHtml(s)}</option>`).join("");
  if (noneCount > 0) {
    html += `<option value="__none__" ${_shelfFilter === "__none__" ? "selected" : ""}>No shelf assigned</option>`;
  }
  return html;
}

/**
 * Renders the books tab content into `#books-content`.
 */
export function renderBooksTab(books) {
  const container = document.getElementById("books-content");
  if (!container) return;

  const searchFiltered = books.filter((b) => {
    if (!_searchQuery) return true;
    const q = _searchQuery.toLowerCase();
    return (
      (b.title || "").toLowerCase().includes(q) ||
      (b.author || "").toLowerCase().includes(q) ||
      (b.category || "").toLowerCase().includes(q) ||
      (b.shelfLocation || "").toLowerCase().includes(q) ||
      (b.description || "").toLowerCase().includes(q)
    );
  });

  const filtered = searchFiltered.filter(
    (b) => matchesCategoryFilter(b) && matchesShelfFilter(b) && matchesAvailFilter(b)
  );

  // Apply Sort
  if (_bookSort === "most-borrowed") {
    filtered.sort((a, b) => {
      const outA = (a.copiesTotal || 0) - (a.copiesAvailable || 0);
      const outB = (b.copiesTotal || 0) - (b.copiesAvailable || 0);
      return outB - outA;
    });
  } else if (_bookSort === "avail") {
    filtered.sort((a, b) => (b.copiesAvailable || 0) - (a.copiesAvailable || 0));
  } else if (_bookSort === "author") {
    filtered.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
  } else if (_bookSort === "recent") {
    filtered.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
  } else if (_bookSort === "category") {
    filtered.sort((a, b) => {
      const ca = a.category || "￿"; // uncategorized sorts last
      const cb = b.category || "￿";
      return ca.localeCompare(cb) || (a.title || "").localeCompare(b.title || "");
    });
  } else {
    // Title A-Z default
    filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  if (books.length === 0) {
    container.innerHTML = `
      <div class="books-toolbar">
        <div class="search-bar-wrap" style="flex:1;">
          <span class="search-icon-slot" id="books-search-icon-slot">${icon("search", { size: 16 })}</span>
          <input type="search" class="search-bar search-bar--enhanced" id="books-search"
            placeholder="Search books…" aria-label="Search books"
            value="${escHtml(_searchQuery)}">
          <button type="button" id="books-search-clear-btn" class="search-clear-btn" title="Clear search" aria-label="Clear search query" ${_searchQuery ? "" : "hidden"}>${icon("x", { size: 14 })}</button>
        </div>
        <button class="btn btn--outline" id="import-books-btn">
          ${icon("download", { size: 15 })}
          <span>Import (.csv)</span>
        </button>
        <button class="btn btn--primary" id="add-book-btn">
          ${icon("plus", { size: 15 })}
          <span>Add Book</span>
        </button>
      </div>
      ${emptyStateBooks()}`;
    bindBooksToolbar(books);
    const sampleBtn = container.querySelector("#load-sample-books-btn");
    if (sampleBtn) sampleBtn.addEventListener("click", loadSampleBooks);
    return;
  }

  let html = `
    <div class="books-toolbar">
      <div class="search-bar-wrap" style="flex:1;">
        <span class="search-icon-slot" id="books-search-icon-slot">${icon("search", { size: 16 })}</span>
        <input type="search" class="search-bar search-bar--enhanced" id="books-search"
          placeholder="Search books…" aria-label="Search books"
          value="${escHtml(_searchQuery)}">
        <button type="button" id="books-search-clear-btn" class="search-clear-btn" title="Clear search" aria-label="Clear search query" ${_searchQuery ? "" : "hidden"}>${icon("x", { size: 14 })}</button>
      </div>
      <div class="books-sort-wrap">
        <label for="books-sort" style="font-size:0.8125rem; color:var(--clr-text-sub); font-weight:600;">Sort:</label>
        <select id="books-sort" class="books-sort-select" aria-label="Sort books catalog">
          <option value="title" ${_bookSort === "title" ? "selected" : ""}>Title (A–Z)</option>
          <option value="author" ${_bookSort === "author" ? "selected" : ""}>Author (A–Z)</option>
          <option value="recent" ${_bookSort === "recent" ? "selected" : ""}>Recently Added</option>
          <option value="category" ${_bookSort === "category" ? "selected" : ""}>Category</option>
          <option value="most-borrowed" ${_bookSort === "most-borrowed" ? "selected" : ""}>Most Borrowed</option>
          <option value="avail" ${_bookSort === "avail" ? "selected" : ""}>Availability</option>
        </select>
      </div>
      <button class="btn btn--outline" id="apply-categories-btn">
        ${icon("tag", { size: 15 })}
        <span>Set Categories (.csv)</span>
      </button>
      <button class="btn btn--outline" id="import-books-btn">
        ${icon("download", { size: 15 })}
        <span>Import (.csv)</span>
      </button>
      <button class="btn btn--primary" id="add-book-btn">
        ${icon("plus", { size: 15 })}
        <span>Add Book</span>
      </button>
    </div>

    <div class="books-count-line" id="books-count-line">${renderCountLine(filtered.length, books.length)}</div>

    <div class="books-filter-row">
      <div class="filter-pills-scroll" id="books-category-chips" role="group" aria-label="Filter by category">
        ${renderCategoryChips(searchFiltered)}
      </div>
      <div class="books-filter-selects">
        <select id="books-shelf-filter" class="books-sort-select" aria-label="Filter by shelf location">
          ${renderShelfOptions(searchFiltered)}
        </select>
        <select id="books-avail-filter" class="books-sort-select" aria-label="Filter by availability">
          <option value="all" ${_availFilter === "all" ? "selected" : ""}>All copies</option>
          <option value="available" ${_availFilter === "available" ? "selected" : ""}>Available</option>
          <option value="all-out" ${_availFilter === "all-out" ? "selected" : ""}>All out</option>
        </select>
      </div>
    </div>`;

  if (filtered.length === 0) {
    html += `<div class="no-results">No books match your search and filters.</div>`;
  } else {
    // Desktop table + mobile cards
    html += `
    <div class="table-wrap desktop-only">
      <table class="data-table" aria-label="Books catalog">
        <thead>
          <tr>
            <th scope="col" style="width:34%;">Title</th>
            <th scope="col">Author</th>
            <th scope="col" style="width:5.5rem;">Pages</th>
            <th scope="col">Availability</th>
            <th scope="col">Out</th>
            <th scope="col" style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((b) => bookRow(b)).join("")}
        </tbody>
      </table>
    </div>
    <div class="mobile-only">
      ${filtered.map((b) => bookCard(b)).join("")}
    </div>`;
  }

  container.innerHTML = html;
  bindBooksToolbar(books);
  bindBookActions();
  refreshCategoryChipsOverflow();
}

/**
 * Toggles the category-chip row's scroll-fade based on whether it actually
 * overflows. Exported so app.js can re-run it when the Books tab is switched
 * into view — a Firestore update can re-render this tab while its panel is
 * still `hidden` (0×0 at that moment), so checking only at render time can
 * permanently miss real overflow.
 */
export function refreshCategoryChipsOverflow() {
  const chipsEl = document.getElementById("books-category-chips");
  if (!chipsEl) return;
  chipsEl.classList.toggle("has-overflow-fade", chipsEl.scrollWidth > chipsEl.clientWidth + 1);
}

/**
 * Renders the availability progress bar with semantic coloring:
 * - Green when all copies are in (avail === total)
 * - Amber when some, but not all, copies are in (0 < avail < total)
 * - Red when none are in (avail === 0, "All out")
 */
function bookAvailability(avail, total) {
  const safeTotal = Math.max(1, total || 1);
  const safeAvail = Math.max(0, avail ?? 0);
  const pct = Math.min(100, Math.round((safeAvail / safeTotal) * 100));

  let colorClass = "green";
  let text = `${safeAvail} / ${safeTotal} in`;

  if (safeAvail === 0) {
    colorClass = "red";
    text = "All out";
  } else if (safeAvail < safeTotal) {
    colorClass = "amber";
  }

  return `
    <div class="avail-bar-wrap">
      <div class="avail-bar" role="progressbar" aria-valuenow="${safeAvail}" aria-valuemin="0" aria-valuemax="${safeTotal}" aria-label="${text}">
        <div class="avail-bar__fill avail-bar__fill--${colorClass}" style="width: ${pct}%;"></div>
      </div>
      <span class="avail-text avail-text--${colorClass}">${text}</span>
    </div>`;
}

/**
 * Returns a clickable out-count badge that opens the quick peek modal if > 0.
 */
function outPeekBadge(b) {
  const out = (b.copiesTotal || 0) - (b.copiesAvailable || 0);
  if (out <= 0) {
    return `<span class="out-peek-badge" aria-label="0 out">–</span>`;
  }
  return `
    <button type="button" class="out-peek-badge out-peek-badge--active btn-peek-borrowers"
      data-id="${escHtml(b.id)}" title="Click to see currently active borrowers" aria-label="View ${out} current borrower(s)">
      ${out} out
    </button>`;
}

/**
 * Renders the category chip + shelf location line for a book, with muted
 * "add" placeholders when either value is missing. Exported for reuse on
 * the Loans tab (book picker / loan rows).
 */
export function categoryShelfMeta(b) {
  const catHtml = b.category
    ? `<span class="cat-chip cat-chip--${categoryColorIndex(b.category)}">${escHtml(b.category)}</span>`
    : `<button type="button" class="meta-add-btn btn-add-field" data-id="${escHtml(b.id)}" data-focus="category" title="Add a category">
        <span>No category</span>${icon("plus", { size: 10 })}
      </button>`;

  const shelfHtml = b.shelfLocation
    ? `<span class="shelf-tag">${icon("pin", { size: 11 })}<span>${escHtml(b.shelfLocation)}</span></span>`
    : `<button type="button" class="meta-add-btn btn-add-field" data-id="${escHtml(b.id)}" data-focus="shelf" title="Add a shelf location">
        <span>No shelf</span>${icon("plus", { size: 10 })}
      </button>`;

  return `<div class="book-meta-row">${catHtml}${shelfHtml}</div>`;
}

function bookRow(b) {
  return `
    <tr data-book-id="${escHtml(b.id)}">
      <td class="td-title-cell">
        <div class="td-title" title="${escHtml(b.title)}">${escHtml(b.title)}</div>
        ${categoryShelfMeta(b)}
      </td>
      <td class="td-author">${escHtml(b.author || "")}</td>
      <td>${b.totalPages || "—"}</td>
      <td>${bookAvailability(b.copiesAvailable, b.copiesTotal)}</td>
      <td>${outPeekBadge(b)}</td>
      <td class="td-actions" style="text-align:right;">
        <button class="btn-icon btn-edit-book" data-id="${escHtml(b.id)}" title="Edit book" aria-label="Edit ${escHtml(b.title)}">
          ${icon("edit", { size: 15 })}
        </button>
        <button class="btn-icon btn-icon--danger btn-delete-book" data-id="${escHtml(b.id)}" title="Delete book" aria-label="Delete ${escHtml(b.title)}">
          ${icon("trash", { size: 15 })}
        </button>
      </td>
    </tr>`;
}

function bookCard(b) {
  return `
    <div class="book-card card" data-book-id="${escHtml(b.id)}" style="margin-bottom:0.75rem;">
      <div class="book-card__header">
        <div>
          <div class="book-card__title" title="${escHtml(b.title)}">${escHtml(b.title)}</div>
          <div class="book-card__author">${escHtml(b.author || "")}</div>
        </div>
        <div class="book-card__actions">
          <button class="btn-icon btn-edit-book" data-id="${escHtml(b.id)}" title="Edit" aria-label="Edit ${escHtml(b.title)}">
            ${icon("edit", { size: 15 })}
          </button>
          <button class="btn-icon btn-icon--danger btn-delete-book" data-id="${escHtml(b.id)}" title="Delete" aria-label="Delete ${escHtml(b.title)}">
            ${icon("trash", { size: 15 })}
          </button>
        </div>
      </div>
      ${categoryShelfMeta(b)}
      <div style="margin-top:0.6rem; display:flex; flex-direction:column; gap:0.4rem;">
        ${bookAvailability(b.copiesAvailable, b.copiesTotal)}
      </div>
      <div class="book-card__meta" style="margin-top:0.6rem; display:flex; align-items:center; justify-content:space-between; font-size:0.8125rem;">
        <span>${b.totalPages ? `${b.totalPages} pages` : ""}</span>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span style="color:var(--clr-text-sub);">Borrowed:</span>
          ${outPeekBadge(b)}
        </div>
      </div>
    </div>`;
}

function bindBooksToolbar(books) {
  const searchEl = document.getElementById("books-search");
  const clearBtn = document.getElementById("books-search-clear-btn");
  const sortEl = document.getElementById("books-sort");
  const addBtn = document.getElementById("add-book-btn");
  const importBtn = document.getElementById("import-books-btn");

  searchEl?.addEventListener("input", (e) => {
    _searchQuery = e.target.value;
    renderBooksTab(books);
  });

  clearBtn?.addEventListener("click", () => {
    _searchQuery = "";
    renderBooksTab(books);
    document.getElementById("books-search")?.focus();
  });

  sortEl?.addEventListener("change", (e) => {
    _bookSort = e.target.value;
    renderBooksTab(books);
  });

  document.querySelectorAll(".books-cat-chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      _categoryFilter = btn.dataset.category;
      renderBooksTab(books);
    })
  );

  document.getElementById("books-shelf-filter")?.addEventListener("change", (e) => {
    _shelfFilter = e.target.value;
    renderBooksTab(books);
  });

  document.getElementById("books-avail-filter")?.addEventListener("change", (e) => {
    _availFilter = e.target.value;
    renderBooksTab(books);
  });

  addBtn?.addEventListener("click", () => openBookModal(null));
  importBtn?.addEventListener("click", () => openImportBooksModal());
  document.getElementById("apply-categories-btn")?.addEventListener("click", () => openApplyCategoriesModal());
}

function bindBookActions() {
  document.querySelectorAll(".btn-edit-book").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const book = _books.find((b) => b.id === btn.dataset.id);
      if (book) openBookModal(book);
    })
  );

  document.querySelectorAll(".btn-delete-book").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteBook(btn.dataset.id);
    })
  );

  // "No category" / "No shelf" add affordances
  document.querySelectorAll(".btn-add-field").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const book = _books.find((b) => b.id === btn.dataset.id);
      if (book) openBookModal(book, btn.dataset.focus);
    })
  );

  // Currently borrowed peek modal
  document.querySelectorAll(".btn-peek-borrowers").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const book = _books.find((b) => b.id === btn.dataset.id);
      if (book) openCurrentlyBorrowedModal(book);
    })
  );

  // Clicking the row/card itself (outside any action control) opens the detail drawer
  document.querySelectorAll("[data-book-id]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const book = _books.find((b) => b.id === el.dataset.bookId);
      if (book) openBookDetailDrawer(book);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   CURRENTLY BORROWED BY (QUICK PEEK MODAL)
   ════════════════════════════════════════════════════════════ */

function openCurrentlyBorrowedModal(book) {
  const activeLoans = getActiveLoansForBook(book.id);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Current borrowers for ${book.title}`);

  overlay.innerHTML = `
    <div class="modal modal--small">
      <div class="modal__header">
        <div>
          <h3 class="modal__title">Currently Borrowed</h3>
          <div style="font-size:0.8125rem; color:var(--clr-text-sub); margin-top:0.2rem;">${escHtml(book.title)}</div>
        </div>
        <button class="modal__close" title="Close" aria-label="Close modal">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        ${activeLoans.length === 0 ? `
          <p style="color:var(--clr-text-sub); font-size:0.875rem;">All copies are currently available on the shelf.</p>
        ` : `
          <div class="borrowed-by-list">
            ${activeLoans.map((l) => {
              const { status } = computeLoanStatusSimple(l);
              return `
                <div class="borrowed-by-item">
                  <div>
                    <div style="font-weight:600; color:var(--clr-text);">${escHtml(l.borrowerName)}</div>
                    <div style="font-size:0.8125rem; color:var(--clr-text-sub); margin-top:0.15rem;">
                      Due: <strong>${friendlyDate(l.dueOn)}</strong>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    ${statusBadge(status)}
                    <a href="tel:${escHtml(l.borrowerPhone)}" class="quick-icon-btn" title="Call borrower" aria-label="Call ${escHtml(l.borrowerName)}">
                      ${icon("phone", { size: 14 })}
                    </a>
                  </div>
                </div>`;
            }).join("")}
          </div>
        `}
      </div>
      <div class="modal__footer">
        <button class="btn btn--outline" id="peek-close-btn">Close</button>
      </div>
    </div>`;

  openModal(overlay, null);
  overlay.querySelector(".modal__close").addEventListener("click", () => closeModal(overlay));
  overlay.querySelector("#peek-close-btn").addEventListener("click", () => closeModal(overlay));
}

function computeLoanStatusSimple(loan) {
  const today = todayString();
  if (loan.returnedOn) return { status: "returned" };
  if (loan.dueOn < today) return { status: "overdue" };
  return { status: "active" };
}

/* ════════════════════════════════════════════════════════════
   BOOK DETAIL DRAWER
   ════════════════════════════════════════════════════════════ */

const PLACEHOLDER_AUTHORS = ["author unknown", "unknown", "n/a", "-"];

function isPlaceholderAuthor(author) {
  return PLACEHOLDER_AUTHORS.includes((author || "").trim().toLowerCase());
}

function bookInitials(title) {
  const words = (title || "?").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function bookCoverHtml(book) {
  const idx = categoryColorIndex(book.category || book.title);
  return `<div class="book-cover book-cover--${idx}" aria-hidden="true">${escHtml(bookInitials(book.title))}</div>`;
}

function openBookDetailDrawer(book) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay book-drawer-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Book details for ${book.title}`);

  const author = isPlaceholderAuthor(book.author) ? "" : (book.author || "").trim();
  const authorHtml = author
    ? escHtml(author)
    : `<em style="color:var(--text-faint);">Unknown author</em>`;

  const activeLoans = getActiveLoansForBook(book.id);
  const history = getLoanHistoryForBook(book.id, 10);
  const today = todayString();

  const borrowerRow = (l) => {
    const { status } = computeLoanStatusSimple(l);
    const diff = dayDiff(l.dueOn, today);
    const daysText = diff < 0 ? `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue` : diff === 0 ? "Due today" : `${diff} day${diff === 1 ? "" : "s"} left`;
    const waUrl = buildWhatsAppURL(l, today);
    return `
      <div class="borrowed-by-item">
        <div>
          <div style="font-weight:600; color:var(--clr-text);">${escHtml(l.borrowerName)}</div>
          <div style="font-size:0.8125rem; color:var(--clr-text-sub); margin-top:0.15rem;">
            Due ${friendlyDate(l.dueOn)} · ${escHtml(daysText)}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          ${statusBadge(status)}
          <a href="tel:${escHtml(l.borrowerPhone)}" class="quick-icon-btn" title="Call ${escHtml(l.borrowerName)}" aria-label="Call ${escHtml(l.borrowerName)}">
            ${icon("phone", { size: 14 })}
          </a>
          <a href="${escHtml(waUrl)}" target="_blank" rel="noopener noreferrer" class="quick-icon-btn quick-icon-btn--wa" title="WhatsApp ${escHtml(l.borrowerName)}" aria-label="WhatsApp ${escHtml(l.borrowerName)}">
            ${icon("whatsapp", { size: 14 })}
          </a>
        </div>
      </div>`;
  };

  const historyRow = (l) => {
    const { status } = computeLoanStatusSimple(l);
    return `
      <div class="loan-history-row">
        <div>
          <div style="font-weight:500; color:var(--clr-text); font-size:0.875rem;">${escHtml(l.borrowerName)}</div>
          <div style="font-size:0.8125rem; color:var(--clr-text-sub);">
            ${friendlyDate(l.borrowedOn)} → ${l.returnedOn ? friendlyDate(l.returnedOn) : friendlyDate(l.dueOn) + " (due)"}
          </div>
        </div>
        ${statusBadge(status)}
      </div>`;
  };

  const descriptionHtml = book.description
    ? `<p style="font-size:0.875rem; color:var(--clr-text); white-space:pre-wrap; line-height:1.5;">${escHtml(book.description)}</p>`
    : `<button type="button" class="meta-add-btn btn-drawer-add-desc" style="font-size:0.8125rem;">
        <span>No description yet. Add one</span>${icon("plus", { size: 11 })}
      </button>`;

  overlay.innerHTML = `
    <div class="book-drawer" role="document">
      <button class="modal__close book-drawer__close" title="Close" aria-label="Close book details">${icon("x", { size: 18 })}</button>

      <div class="book-drawer__header">
        ${bookCoverHtml(book)}
        <div>
          <h2 class="book-drawer__title">${escHtml(book.title)}</h2>
          <p class="book-drawer__author">${authorHtml}</p>
          <div class="book-meta-row">
            ${book.category ? `<span class="cat-chip cat-chip--${categoryColorIndex(book.category)}">${escHtml(book.category)}</span>` : `<span class="meta-add-btn" style="border-style:dashed;">No category</span>`}
            ${book.shelfLocation ? `<span class="shelf-tag">${icon("pin", { size: 11 })}<span>${escHtml(book.shelfLocation)}</span></span>` : ""}
            ${book.totalPages ? `<span class="shelf-tag">${book.totalPages} pages</span>` : ""}
            ${book.language ? `<span class="shelf-tag">${escHtml(book.language)}</span>` : ""}
          </div>
        </div>
      </div>

      <div class="book-drawer__section">
        <h3 class="book-drawer__section-title">Availability</h3>
        ${bookAvailability(book.copiesAvailable, book.copiesTotal)}
        ${activeLoans.length > 0 ? `<div class="borrowed-by-list" style="margin-top:0.75rem;">${activeLoans.map(borrowerRow).join("")}</div>` : ""}
      </div>

      <div class="book-drawer__section">
        <h3 class="book-drawer__section-title">Description</h3>
        ${descriptionHtml}
      </div>

      <div class="book-drawer__section">
        <h3 class="book-drawer__section-title">Loan History</h3>
        ${history.length > 0
          ? `<div class="loan-history-list">${history.map(historyRow).join("")}</div>`
          : `<p style="font-size:0.8125rem; color:var(--clr-text-sub);">No loans recorded for this book yet.</p>`}
      </div>

      <div class="book-drawer__actions">
        <button class="btn btn--outline" id="drawer-edit-btn">${icon("edit", { size: 14 })}<span>Edit</span></button>
        <button class="btn btn--primary" id="drawer-lend-btn">${icon("book", { size: 14 })}<span>Lend this book</span></button>
        <button class="btn btn--danger" id="drawer-delete-btn">${icon("trash", { size: 14 })}<span>Delete</span></button>
      </div>
    </div>`;

  openModal(overlay, null);

  overlay.querySelector(".book-drawer__close").addEventListener("click", () => closeModal(overlay));
  overlay.querySelector(".btn-drawer-add-desc")?.addEventListener("click", () => {
    closeModal(overlay);
    openBookModal(book, "description");
  });
  overlay.querySelector("#drawer-edit-btn").addEventListener("click", () => {
    closeModal(overlay);
    openBookModal(book);
  });
  overlay.querySelector("#drawer-lend-btn").addEventListener("click", () => {
    closeModal(overlay);
    openNewLoanModal(book);
  });
  overlay.querySelector("#drawer-delete-btn").addEventListener("click", () => {
    closeModal(overlay);
    deleteBook(book.id);
  });
}

/* ════════════════════════════════════════════════════════════
   BOOK MODAL (Add / Edit)
   ════════════════════════════════════════════════════════════ */

function openBookModal(book, focusField) {
  const isEdit = !!book;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", isEdit ? "Edit Book" : "Add Book");

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal__header">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--clr-primary); display:inline-flex;">${icon("book", { size: 18 })}</span>
          <h2 class="modal__title">${isEdit ? "Edit Book" : "Add New Book"}</h2>
        </div>
        <button class="modal__close" title="Close" aria-label="Close modal">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal__body">
        <div class="form-group">
          <label for="bk-title">Title <span class="required">*</span></label>
          <input type="text" id="bk-title" class="form-control" required
            value="${escHtml(book?.title || "")}" placeholder="e.g. Mere Christianity">
        </div>
        <div class="form-group">
          <label for="bk-author">Author <span class="required">*</span></label>
          <input type="text" id="bk-author" class="form-control" required
            value="${escHtml(book?.author || "")}" placeholder="e.g. C.S. Lewis">
        </div>
        <div class="form-group">
          <label for="bk-pages">Total Pages <span class="optional">(optional)</span></label>
          <input type="number" id="bk-pages" class="form-control" min="1"
            value="${book?.totalPages || ""}" placeholder="e.g. 227">
        </div>
        <div class="form-group">
          <label for="bk-copies">Total Copies <span class="required">*</span></label>
          <input type="number" id="bk-copies" class="form-control" min="1" required
            value="${book?.copiesTotal || 1}" placeholder="1">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="bk-category">Category <span class="optional">(optional)</span></label>
            <input type="text" id="bk-category" class="form-control" list="bk-category-options"
              value="${escHtml(book?.category || "")}" placeholder="e.g. Prayer" autocomplete="off">
            <datalist id="bk-category-options">
              ${Array.from(new Set([...SEED_CATEGORIES, ...distinctBookValues("category")]))
                .map((c) => `<option value="${escHtml(c)}">`).join("")}
            </datalist>
          </div>
          <div class="form-group">
            <label for="bk-shelf">Shelf Location <span class="optional">(optional)</span></label>
            <input type="text" id="bk-shelf" class="form-control" list="bk-shelf-options"
              value="${escHtml(book?.shelfLocation || "")}" placeholder="e.g. A3" autocomplete="off">
            <datalist id="bk-shelf-options">
              ${distinctBookValues("shelfLocation").map((s) => `<option value="${escHtml(s)}">`).join("")}
            </datalist>
          </div>
        </div>
        <div class="form-group">
          <label for="bk-language">Language <span class="optional">(optional)</span></label>
          <input type="text" id="bk-language" class="form-control"
            value="${escHtml(book?.language || "")}" placeholder="e.g. English">
        </div>
        <div class="form-group">
          <label for="bk-description">Description <span class="optional">(optional)</span></label>
          <textarea id="bk-description" class="form-control" rows="3" maxlength="600"
            placeholder="A short blurb about this book…">${escHtml(book?.description || "")}</textarea>
          <div class="field-hint" id="bk-description-counter" style="text-align:right;"></div>
        </div>
        <p id="bk-error" class="form-error" hidden></p>
      </div>
      <div class="modal__footer">
        <button class="btn btn--outline" id="bk-cancel">Cancel</button>
        <button class="btn btn--primary" id="bk-save">
          ${icon("check", { size: 15 })}
          <span>${isEdit ? "Save Changes" : "Add Book"}</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);

  if (focusField === "category") overlay.querySelector("#bk-category")?.focus();
  else if (focusField === "shelf") overlay.querySelector("#bk-shelf")?.focus();
  else if (focusField === "description") overlay.querySelector("#bk-description")?.focus();

  overlay.querySelector(".modal__close").addEventListener("click", () => closeModal(overlay));
  overlay.querySelector("#bk-cancel").addEventListener("click", () => closeModal(overlay));

  const saveBtn = overlay.querySelector("#bk-save");
  const errorEl = overlay.querySelector("#bk-error");
  const descEl = overlay.querySelector("#bk-description");
  const descCounter = overlay.querySelector("#bk-description-counter");

  const updateDescCounter = () => {
    descCounter.textContent = `${descEl.value.length} / 600`;
  };
  updateDescCounter();
  descEl.addEventListener("input", updateDescCounter);

  saveBtn.addEventListener("click", async () => {
    const title = overlay.querySelector("#bk-title").value.trim();
    const author = overlay.querySelector("#bk-author").value.trim();
    const pagesRaw = overlay.querySelector("#bk-pages").value;
    const copiesRaw = overlay.querySelector("#bk-copies").value;
    const category = overlay.querySelector("#bk-category").value.trim();
    const shelfLocation = overlay.querySelector("#bk-shelf").value.trim();
    const language = overlay.querySelector("#bk-language").value.trim();
    const description = descEl.value.trim().slice(0, 600);

    // Validation
    if (!title || !author) {
      showFormError(errorEl, "Title and author are required.");
      return;
    }
    const copiesTotal = parseInt(copiesRaw, 10);
    if (isNaN(copiesTotal) || copiesTotal < 1) {
      showFormError(errorEl, "Total copies must be at least 1.");
      return;
    }
    const totalPages = pagesRaw ? parseInt(pagesRaw, 10) : null;
    if (pagesRaw && (isNaN(totalPages) || totalPages < 1)) {
      showFormError(errorEl, "Total pages must be a positive number.");
      return;
    }
    errorEl.hidden = true;

    const fields = { title, author, totalPages, copiesTotal, category, shelfLocation, language, description };

    const restore = setButtonLoading(saveBtn, "Saving…");
    try {
      if (isEdit) {
        await editBookTransaction(book, fields);
        showToast("Done! Changes saved.", "success");
      } else {
        await addDoc(collection(_db, "books"), {
          title,
          author,
          category: category || "",
          shelfLocation: shelfLocation || "",
          language: language || "",
          description: description || "",
          totalPages: totalPages || null,
          copiesTotal,
          copiesAvailable: copiesTotal,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        showToast("Done! Book added to the library.", "success");
      }
      closeModal(overlay);
    } catch (err) {
      console.error(err);
      showFormError(errorEl, err.message || "Failed to save book.");
    } finally {
      restore();
    }
  });
}

/**
 * Edits a book inside a Firestore transaction so copy counts stay consistent.
 */
async function editBookTransaction(book, { title, author, totalPages, copiesTotal, category, shelfLocation, language, description }) {
  const bookRef = doc(_db, "books", book.id);
  await runTransaction(_db, async (tx) => {
    const snap = await tx.get(bookRef);
    if (!snap.exists()) throw new Error("Book not found.");

    const current = snap.data();
    const currentOut = (current.copiesTotal || 0) - (current.copiesAvailable || 0);

    if (copiesTotal < currentOut) {
      throw new Error(
        `Cannot reduce copies to ${copiesTotal} — ${currentOut} ${currentOut === 1 ? "copy is" : "copies are"} currently out on loan.`
      );
    }

    const delta = copiesTotal - (current.copiesTotal || 0);
    const newAvailable = Math.max(0, Math.min(copiesTotal, (current.copiesAvailable || 0) + delta));

    tx.update(bookRef, {
      title,
      author,
      totalPages: totalPages || null,
      copiesTotal,
      copiesAvailable: newAvailable,
      category: category || "",
      shelfLocation: shelfLocation || "",
      language: language || "",
      description: description || "",
      updatedAt: serverTimestamp(),
    });
  });
}

/* ════════════════════════════════════════════════════════════
   DELETE BOOK
   ════════════════════════════════════════════════════════════ */

async function deleteBook(bookId) {
  const book = _books.find((b) => b.id === bookId);
  const bookTitle = book ? book.title : "this book";

  // Check for active loans
  const loansSnap = await getDocs(
    query(
      collection(_db, "loans"),
      where("bookId", "==", bookId),
      where("returnedOn", "==", null)
    )
  );

  if (!loansSnap.empty) {
    showToast(
      "Can't delete this — someone still has it out. Mark it returned first.",
      "error",
      5000
    );
    return;
  }

  const ok = await confirmDialog(
    `Delete "${bookTitle}"? Past loan records will still show its title. This cannot be undone.`,
    { title: "Delete this book?", confirmText: "Yes, delete", danger: true }
  );
  if (!ok) return;

  try {
    await deleteDoc(doc(_db, "books", bookId));
    showToast("Deleted. That book is gone.", "success");
  } catch (err) {
    console.error(err);
    showToast("Couldn't delete that — " + err.message, "error");
  }
}

/* ════════════════════════════════════════════════════════════
   SAMPLE BOOKS LOADER
   ════════════════════════════════════════════════════════════ */

async function loadSampleBooks() {
  const btn = document.getElementById("load-sample-books-btn");
  if (btn) btn.disabled = true;

  try {
    const booksCol = collection(_db, "books");
    for (const b of SAMPLE_BOOKS) {
      await addDoc(booksCol, {
        ...b,
        copiesAvailable: b.copiesTotal,
        createdAt: serverTimestamp(),
      });
    }
    showToast("5 sample books added!", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to add sample books: " + err.message, "error");
    if (btn) btn.disabled = false;
  }
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

/* ════════════════════════════════════════════════════════════
   CSV IMPORT MODAL
   ════════════════════════════════════════════════════════════ */

export function openImportBooksModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--large" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div class="modal__header">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--clr-primary); display:inline-flex;">${icon("download", { size: 18 })}</span>
          <h2 class="modal__title" id="import-modal-title">Import Books from Spreadsheet</h2>
        </div>
        <button class="modal__close" title="Close" aria-label="Close modal">${icon("x", { size: 16 })}</button>
      </div>

      <div class="modal__body">
        <!-- Step 1: File selection -->
        <div id="import-step-file">
          <div class="import-dropzone" id="import-dropzone" tabindex="0" role="button" aria-label="Select CSV file">
            <input type="file" id="import-file-input" accept=".csv,text/csv">
            <div class="import-dropzone__icon" style="color:var(--clr-primary); display:inline-flex;">${icon("upload", { size: 36 })}</div>
            <div class="import-dropzone__text">Click or drag & drop a .csv file here</div>
            <div class="import-dropzone__subtext">Max size: 5 MB · Max rows: 5,000</div>
          </div>

          <div class="import-template-row">
            <span>Expected columns: <strong>Title</strong> (required), <strong>Author</strong>, <strong>Pages</strong>, <strong>Copies</strong></span>
            <button type="button" class="import-template-link" id="import-dl-template">Download template</button>
          </div>
        </div>

        <!-- Step 2: Mapping & Preview (hidden initially) -->
        <div id="import-step-preview" hidden>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:0.9rem;" id="import-file-name-display">File selected</strong>
            <button type="button" class="btn btn--outline btn--sm" id="import-reselect-file">Change file</button>
          </div>

          <div class="mapping-grid" id="import-mapping-grid">
            <!-- Dropdowns rendered dynamically -->
          </div>

          <div class="import-summary-bar" id="import-summary-bar">
            <!-- Summary counts rendered dynamically -->
          </div>

          <div class="import-preview-table-wrap">
            <table class="import-preview-table" aria-label="Preview of books to import">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Title</th>
                  <th scope="col">Author</th>
                  <th scope="col">Pages</th>
                  <th scope="col">Copies</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody id="import-preview-tbody">
                <!-- Preview rows rendered dynamically -->
              </tbody>
            </table>
          </div>

          <fieldset class="import-options-group">
            <legend>Existing books conflict resolution</legend>
            <label class="import-radio-label">
              <input type="radio" name="import-conflict" value="skip" checked>
              <span><strong>Skip existing</strong> — keep current copies untouched</span>
            </label>
            <label class="import-radio-label">
              <input type="radio" name="import-conflict" value="add">
              <span><strong>Add copies to existing</strong> — increase total and available copies</span>
            </label>
          </fieldset>

          <div class="import-progress-wrap" id="import-progress-wrap" hidden>
            <div style="display:flex; justify-content:space-between; font-size:0.8125rem;">
              <span id="import-progress-text">Saving to library…</span>
              <span id="import-progress-pct">0%</span>
            </div>
            <div class="import-progress-bar">
              <div class="import-progress-fill" id="import-progress-fill"></div>
            </div>
          </div>
        </div>

        <p id="import-error" class="form-error" hidden></p>
      </div>

      <div class="modal__footer">
        <button class="btn btn--outline" id="import-cancel">Cancel</button>
        <button class="btn btn--primary" id="import-submit" disabled>
          ${icon("download", { size: 15 })}
          <span>Import Books</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);

  const closeBtn = overlay.querySelector(".modal__close");
  const cancelBtn = overlay.querySelector("#import-cancel");
  const submitBtn = overlay.querySelector("#import-submit");
  const dropzone = overlay.querySelector("#import-dropzone");
  const fileInput = overlay.querySelector("#import-file-input");
  const templateBtn = overlay.querySelector("#import-dl-template");
  const reselectBtn = overlay.querySelector("#import-reselect-file");
  const errorEl = overlay.querySelector("#import-error");

  const stepFile = overlay.querySelector("#import-step-file");
  const stepPreview = overlay.querySelector("#import-step-preview");
  const mappingGrid = overlay.querySelector("#import-mapping-grid");
  const summaryBar = overlay.querySelector("#import-summary-bar");
  const previewTbody = overlay.querySelector("#import-preview-tbody");
  const fileNameDisplay = overlay.querySelector("#import-file-name-display");
  const progressWrap = overlay.querySelector("#import-progress-wrap");
  const progressFill = overlay.querySelector("#import-progress-fill");
  const progressText = overlay.querySelector("#import-progress-text");
  const progressPct = overlay.querySelector("#import-progress-pct");

  let parsedFile = null;
  let headers = [];
  let rawRows = [];
  let colMapping = { titleIndex: -1, authorIndex: -1, pagesIndex: -1, copiesIndex: -1 };
  let processedData = null;

  closeBtn.addEventListener("click", () => closeModal(overlay));
  cancelBtn.addEventListener("click", () => closeModal(overlay));

  templateBtn.addEventListener("click", () => {
    const templateCSV = "Title,Author,Pages,Copies\n\"Mere Christianity\",\"C.S. Lewis\",227,2\n";
    downloadCSV(templateCSV, "library_import_template.csv");
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  reselectBtn.addEventListener("click", () => {
    stepPreview.hidden = true;
    stepFile.hidden = false;
    fileInput.value = "";
    submitBtn.disabled = true;
    errorEl.hidden = true;
  });

  function handleFile(file) {
    errorEl.hidden = true;
    errorEl.textContent = "";

    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      showFormError(errorEl, "Please choose a valid .csv file.");
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showFormError(errorEl, "File size exceeds 5 MB limit.");
      return;
    }

    parsedFile = file;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const rows = parseCSV(text);

        if (!rows || rows.length === 0) {
          showFormError(errorEl, "The CSV file appears to be empty.");
          return;
        }

        const MAX_ROWS = 5000;
        if (rows.length - 1 > MAX_ROWS) {
          showFormError(errorEl, `File contains ${rows.length - 1} rows. The maximum limit is ${MAX_ROWS} rows.`);
          return;
        }

        headers = rows[0];
        rawRows = rows.slice(1);

        if (rawRows.length === 0) {
          showFormError(errorEl, "The file contains a header row but no data rows.");
          return;
        }

        fileNameDisplay.innerHTML = `<span style="display:inline-flex; align-items:center; gap:0.35rem;">${icon("book", { size: 14 })} <span>${escHtml(file.name)} (${rawRows.length} rows detected)</span></span>`;
        colMapping = detectColumnMapping(headers);

        renderMappingControls();
        updatePreview();

        stepFile.hidden = true;
        stepPreview.hidden = false;
      } catch (err) {
        console.error(err);
        showFormError(errorEl, "Failed to parse CSV: " + err.message);
      }
    };
    reader.onerror = () => {
      showFormError(errorEl, "Error reading file. Please try again.");
    };
    reader.readAsText(file, "UTF-8");
  }

  function renderMappingControls() {
    mappingGrid.innerHTML = "";

    const createSelect = (id, labelText, selectedIdx, isRequired) => {
      const item = document.createElement("div");
      item.className = "mapping-item";

      const label = document.createElement("label");
      label.htmlFor = id;
      label.innerHTML = `${labelText} ${isRequired ? '<span class="required">*</span>' : '<span class="optional">(optional)</span>'}`;

      const sel = document.createElement("select");
      sel.id = id;
      sel.className = "form-control";

      const noneOpt = document.createElement("option");
      noneOpt.value = "-1";
      noneOpt.textContent = "— Do not import —";
      sel.appendChild(noneOpt);

      headers.forEach((h, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${idx + 1}. ${h || "(Empty header)"}`;
        if (idx === selectedIdx) opt.selected = true;
        sel.appendChild(opt);
      });

      sel.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (id === "map-title") colMapping.titleIndex = val;
        if (id === "map-author") colMapping.authorIndex = val;
        if (id === "map-pages") colMapping.pagesIndex = val;
        if (id === "map-copies") colMapping.copiesIndex = val;
        updatePreview();
      });

      item.appendChild(label);
      item.appendChild(sel);
      return item;
    };

    mappingGrid.appendChild(createSelect("map-title", "Title Column", colMapping.titleIndex, true));
    mappingGrid.appendChild(createSelect("map-author", "Author Column", colMapping.authorIndex, false));
    mappingGrid.appendChild(createSelect("map-pages", "Pages Column", colMapping.pagesIndex, false));
    mappingGrid.appendChild(createSelect("map-copies", "Copies Column", colMapping.copiesIndex, false));
  }

  function updatePreview() {
    errorEl.hidden = true;
    errorEl.textContent = "";

    if (colMapping.titleIndex < 0) {
      previewTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--clr-overdue);">Please map the required <strong>Title</strong> column above.</td></tr>`;
      summaryBar.innerHTML = `<span style="color:var(--clr-overdue); font-weight:600;">Title column required to continue.</span>`;
      submitBtn.disabled = true;
      processedData = null;
      return;
    }

    const uniqueMap = new Map();
    let skippedCount = 0;
    let mergedCount = 0;
    const allRowResults = [];

    rawRows.forEach((row, rowIdx) => {
      const rawTitle = colMapping.titleIndex >= 0 ? (row[colMapping.titleIndex] || "").trim() : "";
      const rawAuthor = colMapping.authorIndex >= 0 ? (row[colMapping.authorIndex] || "").trim() : "";
      const rawPages = colMapping.pagesIndex >= 0 ? (row[colMapping.pagesIndex] || "").trim() : "";
      const rawCopies = colMapping.copiesIndex >= 0 ? (row[colMapping.copiesIndex] || "").trim() : "";

      const issues = [];

      if (!rawTitle) {
        issues.push("Missing title");
      }

      let totalPages = null;
      if (rawPages) {
        const p = Number(rawPages);
        if (!Number.isInteger(p) || p <= 0) {
          issues.push(`Invalid pages: "${rawPages}"`);
        } else {
          totalPages = p;
        }
      }

      let copies = 1;
      if (rawCopies) {
        const c = Number(rawCopies);
        if (!Number.isInteger(c) || c <= 0) {
          issues.push(`Invalid copies: "${rawCopies}"`);
        } else {
          copies = c;
        }
      }

      if (issues.length > 0) {
        skippedCount++;
        allRowResults.push({
          rowNumber: rowIdx + 2,
          title: rawTitle,
          author: rawAuthor,
          pages: rawPages || "—",
          copies: rawCopies || "1",
          status: "skipped",
          issues,
        });
        return;
      }

      const dedupKey = `${rawTitle.toLowerCase().replace(/\s+/g, " ")}:::${rawAuthor.toLowerCase().replace(/\s+/g, " ")}`;

      if (uniqueMap.has(dedupKey)) {
        mergedCount++;
        const existing = uniqueMap.get(dedupKey);
        existing.copiesTotal += copies;
        if (!existing.totalPages && totalPages) existing.totalPages = totalPages;
        existing.mergedRows.push(rowIdx + 2);

        allRowResults.push({
          rowNumber: rowIdx + 2,
          title: rawTitle,
          author: rawAuthor,
          pages: totalPages || "—",
          copies: copies,
          status: "merged",
          issues: [`Merged into row ${existing.mergedRows[0]}`],
        });
      } else {
        const record = {
          title: rawTitle,
          author: rawAuthor,
          totalPages,
          copiesTotal: copies,
          mergedRows: [rowIdx + 2],
        };
        uniqueMap.set(dedupKey, record);

        allRowResults.push({
          rowNumber: rowIdx + 2,
          title: rawTitle,
          author: rawAuthor,
          pages: totalPages || "—",
          copies: copies,
          status: "ready",
          issues: [],
        });
      }
    });

    const readyList = Array.from(uniqueMap.values());
    processedData = {
      readyBooks: readyList,
      skippedCount,
      mergedCount,
      totalDataRows: rawRows.length,
    };

    summaryBar.innerHTML = `
      <span class="import-summary-pill import-summary-pill--ready" style="display:inline-flex; align-items:center; gap:0.25rem;">
        ${icon("check", { size: 13 })}
        <span>${readyList.length} ready</span>
      </span>
      ${skippedCount > 0 ? `
        <span class="import-summary-pill import-summary-pill--skipped" style="display:inline-flex; align-items:center; gap:0.25rem;">
          ${icon("alert", { size: 13 })}
          <span>${skippedCount} skipped</span>
        </span>` : ""}
      ${mergedCount > 0 ? `
        <span class="import-summary-pill import-summary-pill--merged" style="display:inline-flex; align-items:center; gap:0.25rem;">
          ${icon("book", { size: 13 })}
          <span>${mergedCount} duplicates merged</span>
        </span>` : ""}
      <span style="margin-left:auto; font-size:0.8125rem; color:var(--clr-text-sub);">Previewing first 20 rows</span>
    `;

    const previewSubset = allRowResults.slice(0, 20);
    previewTbody.innerHTML = previewSubset
      .map((r) => {
        let rowClass = "";
        let badgeHtml = "";
        if (r.status === "skipped") {
          rowClass = "import-row--invalid";
          badgeHtml = `<span class="import-issue-tag">${escHtml(r.issues.join(", "))}</span>`;
        } else if (r.status === "merged") {
          rowClass = "import-row--merged";
          badgeHtml = `<span class="import-issue-tag" style="background:var(--clr-primary-lt); color:var(--clr-primary);">${escHtml(r.issues.join(", "))}</span>`;
        } else {
          badgeHtml = `<span style="color:var(--clr-success); font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;">${icon("check", { size: 12 })} Ready</span>`;
        }

        return `
          <tr class="${rowClass}">
            <td>${r.rowNumber}</td>
            <td><strong>${escHtml(r.title || "(Missing)")}</strong></td>
            <td>${escHtml(r.author || "—")}</td>
            <td>${r.pages}</td>
            <td>${r.copies}</td>
            <td>${badgeHtml}</td>
          </tr>
        `;
      })
      .join("");

    submitBtn.disabled = readyList.length === 0;
  }

  submitBtn.addEventListener("click", async () => {
    if (!processedData || processedData.readyBooks.length === 0) return;

    const conflictStrategy = overlay.querySelector('input[name="import-conflict"]:checked')?.value || "skip";

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    reselectBtn.disabled = true;
    errorEl.hidden = true;

    progressWrap.hidden = false;
    progressFill.style.width = "5%";
    progressPct.textContent = "5%";
    progressText.textContent = "Checking existing books in catalog…";

    try {
      const snap = await getDocs(collection(_db, "books"));
      const existingBooksMap = new Map();
      snap.forEach((d) => {
        const b = d.data();
        const key = `${(b.title || "").toLowerCase().replace(/\s+/g, " ")}:::${(b.author || "").toLowerCase().replace(/\s+/g, " ")}`;
        existingBooksMap.set(key, { id: d.id, ...b });
      });

      const readyBooks = processedData.readyBooks;
      const totalToProcess = readyBooks.length;

      let newCount = 0;
      let updatedCount = 0;
      let skippedExistingCount = 0;

      const BATCH_SIZE = 400;
      let currentBatch = writeBatch(_db);
      let opCountInBatch = 0;

      for (let i = 0; i < totalToProcess; i++) {
        const item = readyBooks[i];
        const key = `${item.title.toLowerCase().replace(/\s+/g, " ")}:::${item.author.toLowerCase().replace(/\s+/g, " ")}`;
        const existing = existingBooksMap.get(key);

        if (existing) {
          if (conflictStrategy === "add") {
            const bookRef = doc(_db, "books", existing.id);
            const newTotal = (existing.copiesTotal || 0) + item.copiesTotal;
            const newAvail = (existing.copiesAvailable || 0) + item.copiesTotal;

            const updateData = {
              copiesTotal: newTotal,
              copiesAvailable: newAvail,
            };
            if (!existing.totalPages && item.totalPages) {
              updateData.totalPages = item.totalPages;
            }

            currentBatch.update(bookRef, updateData);
            opCountInBatch++;
            updatedCount++;
          } else {
            skippedExistingCount++;
          }
        } else {
          const newDocRef = doc(collection(_db, "books"));
          currentBatch.set(newDocRef, {
            title: item.title,
            author: item.author,
            totalPages: item.totalPages || null,
            copiesTotal: item.copiesTotal,
            copiesAvailable: item.copiesTotal,
            createdAt: serverTimestamp(),
          });
          opCountInBatch++;
          newCount++;
        }

        if (opCountInBatch >= BATCH_SIZE) {
          await currentBatch.commit();
          currentBatch = writeBatch(_db);
          opCountInBatch = 0;
        }

        const pct = Math.round(((i + 1) / totalToProcess) * 90) + 5;
        progressFill.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
        progressText.textContent = `Saving ${i + 1} of ${totalToProcess} books…`;
      }

      if (opCountInBatch > 0) {
        await currentBatch.commit();
      }

      progressFill.style.width = "100%";
      progressPct.textContent = "100%";
      progressText.textContent = "Complete!";

      let summaryMsg = `Import completed: ${newCount} new book(s) added`;
      if (updatedCount > 0) summaryMsg += `, ${updatedCount} existing updated with copies`;
      if (processedData.mergedCount > 0) summaryMsg += `, ${processedData.mergedCount} duplicates merged`;
      if (skippedExistingCount > 0) summaryMsg += `, ${skippedExistingCount} existing skipped`;
      if (processedData.skippedCount > 0) summaryMsg += `, ${processedData.skippedCount} invalid rows skipped`;

      showToast(summaryMsg, "success", 7000);

      setTimeout(() => {
        closeModal(overlay);
      }, 500);
    } catch (err) {
      console.error(err);
      progressWrap.hidden = true;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      reselectBtn.disabled = false;
      showFormError(errorEl, "Import failed: " + err.message);
    }
  });
}

/* ════════════════════════════════════════════════════════════
   APPLY CATEGORIES FROM CSV
   One-off cleanup tool: match an existing CSV (that already has a
   Category/Genre column) against the catalog by normalized title, and
   write ONLY the `category` field for matched books. Never touches
   copies, pages, or any other field, and never creates new books.
   ════════════════════════════════════════════════════════════ */

function normalizeTitleKey(title) {
  return (title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const CATEGORY_COLUMN_ALIASES = ["category", "genre", "categories", "subject"];

function detectCategoryColumnIndex(headers) {
  const norm = headers.map((h) => (h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  return norm.findIndex((h) => CATEGORY_COLUMN_ALIASES.includes(h));
}

function downloadBooksBackupCSV() {
  const header = ["Title", "Author", "Category", "Shelf Location", "Language", "Description", "Total Pages", "Total Copies", "Available Copies"];
  const rows = _books.map((b) => [
    csvCell(b.title), csvCell(b.author), csvCell(b.category), csvCell(b.shelfLocation),
    csvCell(b.language), csvCell(b.description), csvCell(b.totalPages), csvCell(b.copiesTotal), csvCell(b.copiesAvailable),
  ].join(","));
  const csv = [header.map(csvCell).join(","), ...rows].join("\n");
  downloadCSV(csv, `library_books_backup_${todayString()}.csv`);
}

export function openApplyCategoriesModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--large" role="dialog" aria-modal="true" aria-labelledby="catimport-modal-title">
      <div class="modal__header">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--accent); display:inline-flex;">${icon("tag", { size: 18 })}</span>
          <h2 class="modal__title" id="catimport-modal-title">Set Categories from CSV</h2>
        </div>
        <button class="modal__close" title="Close" aria-label="Close modal">${icon("x", { size: 16 })}</button>
      </div>

      <div class="modal__body">
        <p style="font-size:0.875rem; color:var(--clr-text-sub); margin-bottom:0.75rem;">
          Matches rows in your CSV to existing books by title, and sets only the <strong>Category</strong>
          field. Nothing else is changed, and no new books are created.
        </p>

        <div id="catimport-step-file">
          <div class="import-dropzone" id="catimport-dropzone" tabindex="0" role="button" aria-label="Select CSV file">
            <input type="file" id="catimport-file-input" accept=".csv,text/csv">
            <div class="import-dropzone__icon" style="color:var(--accent); display:inline-flex;">${icon("upload", { size: 36 })}</div>
            <div class="import-dropzone__text">Click or drag & drop a .csv file here</div>
            <div class="import-dropzone__subtext">Needs a Title column and a Category (or Genre) column</div>
          </div>
        </div>

        <div id="catimport-step-preview" hidden>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <strong style="font-size:0.9rem;" id="catimport-file-name-display">File selected</strong>
            <div style="display:flex; gap:0.5rem;">
              <button type="button" class="btn btn--outline btn--sm" id="catimport-backup-btn">
                ${icon("download", { size: 13 })}<span>Download backup (.csv)</span>
              </button>
              <button type="button" class="btn btn--outline btn--sm" id="catimport-reselect-file">Change file</button>
            </div>
          </div>

          <div class="import-summary-bar" id="catimport-summary-bar"></div>

          <div class="import-preview-table-wrap">
            <table class="import-preview-table" aria-label="Preview of category updates">
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" id="catimport-select-all" aria-label="Select all matched rows"></th>
                  <th scope="col">Book (matched by title)</th>
                  <th scope="col">Current Category</th>
                  <th scope="col">New Category</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody id="catimport-preview-tbody"></tbody>
            </table>
          </div>

          <div class="import-progress-wrap" id="catimport-progress-wrap" hidden>
            <div style="display:flex; justify-content:space-between; font-size:0.8125rem;">
              <span id="catimport-progress-text">Updating categories…</span>
              <span id="catimport-progress-pct">0%</span>
            </div>
            <div class="import-progress-bar">
              <div class="import-progress-fill" id="catimport-progress-fill"></div>
            </div>
          </div>
        </div>

        <p id="catimport-error" class="form-error" hidden></p>
      </div>

      <div class="modal__footer">
        <button class="btn btn--outline" id="catimport-cancel">Cancel</button>
        <button class="btn btn--primary" id="catimport-submit" disabled>
          ${icon("check", { size: 15 })}
          <span>Apply Categories</span>
        </button>
      </div>
    </div>`;

  openModal(overlay, null);

  const closeBtn = overlay.querySelector(".modal__close");
  const cancelBtn = overlay.querySelector("#catimport-cancel");
  const submitBtn = overlay.querySelector("#catimport-submit");
  const dropzone = overlay.querySelector("#catimport-dropzone");
  const fileInput = overlay.querySelector("#catimport-file-input");
  const reselectBtn = overlay.querySelector("#catimport-reselect-file");
  const backupBtn = overlay.querySelector("#catimport-backup-btn");
  const errorEl = overlay.querySelector("#catimport-error");

  const stepFile = overlay.querySelector("#catimport-step-file");
  const stepPreview = overlay.querySelector("#catimport-step-preview");
  const fileNameDisplay = overlay.querySelector("#catimport-file-name-display");
  const summaryBar = overlay.querySelector("#catimport-summary-bar");
  const previewTbody = overlay.querySelector("#catimport-preview-tbody");
  const selectAllCb = overlay.querySelector("#catimport-select-all");
  const progressWrap = overlay.querySelector("#catimport-progress-wrap");
  const progressFill = overlay.querySelector("#catimport-progress-fill");
  const progressText = overlay.querySelector("#catimport-progress-text");
  const progressPct = overlay.querySelector("#catimport-progress-pct");

  /** { bookId, bookTitle, currentCategory, newCategory, rowNumber }[] — rows that will actually write */
  let updateRows = [];
  let noMatchCount = 0;
  let unchangedCount = 0;

  closeBtn.addEventListener("click", () => closeModal(overlay));
  cancelBtn.addEventListener("click", () => closeModal(overlay));
  backupBtn.addEventListener("click", downloadBooksBackupCSV);

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files?.length > 0) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length > 0) handleFile(e.target.files[0]);
  });

  reselectBtn.addEventListener("click", () => {
    stepPreview.hidden = true;
    stepFile.hidden = false;
    fileInput.value = "";
    submitBtn.disabled = true;
    errorEl.hidden = true;
  });

  function handleFile(file) {
    errorEl.hidden = true;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      showFormError(errorEl, "Please choose a valid .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const rows = parseCSV(evt.target.result);
        if (!rows || rows.length < 2) {
          showFormError(errorEl, "The CSV file appears to be empty.");
          return;
        }
        const headers = rows[0];
        const dataRows = rows.slice(1);

        const titleIdx = detectColumnMapping(headers).titleIndex;
        const catIdx = detectCategoryColumnIndex(headers);

        if (titleIdx < 0 || catIdx < 0) {
          showFormError(errorEl, "Couldn't find both a Title column and a Category/Genre column in this file.");
          return;
        }

        fileNameDisplay.textContent = `${file.name} (${dataRows.length} rows detected)`;
        buildPreview(dataRows, titleIdx, catIdx);

        stepFile.hidden = true;
        stepPreview.hidden = false;
      } catch (err) {
        console.error(err);
        showFormError(errorEl, "Failed to parse CSV: " + err.message);
      }
    };
    reader.onerror = () => showFormError(errorEl, "Error reading file. Please try again.");
    reader.readAsText(file, "UTF-8");
  }

  function buildPreview(dataRows, titleIdx, catIdx) {
    const byTitle = new Map();
    _books.forEach((b) => {
      const key = normalizeTitleKey(b.title);
      if (!byTitle.has(key)) byTitle.set(key, b);
    });

    updateRows = [];
    noMatchCount = 0;
    unchangedCount = 0;
    const seenBookIds = new Set();
    const rowsHtml = [];

    dataRows.forEach((row, idx) => {
      const rawTitle = (row[titleIdx] || "").trim();
      const rawCategory = (row[catIdx] || "").trim();
      if (!rawTitle || !rawCategory) return;

      const book = byTitle.get(normalizeTitleKey(rawTitle));
      const rowNumber = idx + 2;

      if (!book) {
        noMatchCount++;
        rowsHtml.push(`
          <tr class="import-row--invalid">
            <td></td>
            <td><strong>${escHtml(rawTitle)}</strong> <span class="field-hint">(no catalog match)</span></td>
            <td>—</td>
            <td>${escHtml(rawCategory)}</td>
            <td><span class="import-issue-tag">No match</span></td>
          </tr>`);
        return;
      }

      // A CSV with duplicate titles (e.g. a repeated row) should only affect that book once.
      if (seenBookIds.has(book.id)) return;
      seenBookIds.add(book.id);

      const currentCategory = (book.category || "").trim();
      if (currentCategory === rawCategory) {
        unchangedCount++;
        rowsHtml.push(`
          <tr>
            <td></td>
            <td>${escHtml(book.title)}</td>
            <td>${escHtml(currentCategory) || "—"}</td>
            <td>${escHtml(rawCategory)}</td>
            <td><span style="color:var(--text-muted);">Already set</span></td>
          </tr>`);
        return;
      }

      updateRows.push({ bookId: book.id, bookTitle: book.title, currentCategory, newCategory: rawCategory, rowNumber });
      rowsHtml.push(`
        <tr>
          <td><input type="checkbox" class="catimport-row-cb" checked data-book-id="${escHtml(book.id)}"></td>
          <td>${escHtml(book.title)}</td>
          <td>${escHtml(currentCategory) || "—"}</td>
          <td><strong style="color:var(--success);">${escHtml(rawCategory)}</strong></td>
          <td><span style="color:var(--success); font-weight:600;">Will update</span></td>
        </tr>`);
    });

    previewTbody.innerHTML = rowsHtml.join("") || `<tr><td colspan="5" style="text-align:center; padding:1.5rem;">No rows matched.</td></tr>`;

    selectAllCb.checked = updateRows.length > 0;
    selectAllCb.disabled = updateRows.length === 0;
    overlay.querySelectorAll(".catimport-row-cb").forEach((cb) =>
      cb.addEventListener("change", () => {
        selectAllCb.checked = Array.from(overlay.querySelectorAll(".catimport-row-cb")).every((c) => c.checked);
        updateSubmitState();
      })
    );
    selectAllCb.addEventListener("change", () => {
      overlay.querySelectorAll(".catimport-row-cb").forEach((cb) => { cb.checked = selectAllCb.checked; });
      updateSubmitState();
    });

    summaryBar.innerHTML = `
      <span class="import-summary-pill import-summary-pill--ready">${icon("check", { size: 13 })}<span>${updateRows.length} will update</span></span>
      ${unchangedCount > 0 ? `<span class="import-summary-pill import-summary-pill--merged">${icon("check", { size: 13 })}<span>${unchangedCount} already set</span></span>` : ""}
      ${noMatchCount > 0 ? `<span class="import-summary-pill import-summary-pill--skipped">${icon("alert", { size: 13 })}<span>${noMatchCount} no catalog match</span></span>` : ""}
    `;

    updateSubmitState();
  }

  function updateSubmitState() {
    const checkedCount = overlay.querySelectorAll(".catimport-row-cb:checked").length;
    submitBtn.disabled = checkedCount === 0;
  }

  submitBtn.addEventListener("click", async () => {
    const checkedIds = new Set(
      Array.from(overlay.querySelectorAll(".catimport-row-cb:checked")).map((cb) => cb.dataset.bookId)
    );
    const toApply = updateRows.filter((r) => checkedIds.has(r.bookId));
    if (toApply.length === 0) return;

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    reselectBtn.disabled = true;
    errorEl.hidden = true;
    progressWrap.hidden = false;

    const BATCH_SIZE = 400;
    let currentBatch = writeBatch(_db);
    let opCountInBatch = 0;
    let successCount = 0;
    const failed = [];

    for (let i = 0; i < toApply.length; i++) {
      const row = toApply[i];
      try {
        currentBatch.update(doc(_db, "books", row.bookId), {
          category: row.newCategory,
          updatedAt: serverTimestamp(),
        });
        opCountInBatch++;
        successCount++;
      } catch (err) {
        failed.push(row.bookTitle);
      }

      if (opCountInBatch >= BATCH_SIZE) {
        await currentBatch.commit();
        currentBatch = writeBatch(_db);
        opCountInBatch = 0;
      }

      const pct = Math.round(((i + 1) / toApply.length) * 100);
      progressFill.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      progressText.textContent = `Updating ${i + 1} of ${toApply.length}…`;
    }

    try {
      if (opCountInBatch > 0) await currentBatch.commit();
    } catch (err) {
      console.error(err);
      progressWrap.hidden = true;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      reselectBtn.disabled = false;
      showFormError(errorEl, "Some updates failed to save: " + err.message + ". Try again.");
      return;
    }

    let summaryMsg = `Updated category for ${successCount} book${successCount === 1 ? "" : "s"}.`;
    if (failed.length > 0) summaryMsg += ` Failed: ${failed.join(", ")}.`;
    showToast(summaryMsg, failed.length > 0 ? "error" : "success", 7000);

    setTimeout(() => closeModal(overlay), 500);
  });
}
