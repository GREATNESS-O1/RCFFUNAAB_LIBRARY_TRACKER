/**
 * utils.js
 * ─────────────────────────────────────────────────────────────────────
 * Pure utility functions: phone normalisation, date helpers,
 * CSV builder, loan-status logic, and friendly date formatting.
 * No Firebase imports here — keeps this file unit-testable.
 * ─────────────────────────────────────────────────────────────────────
 */

/* ═══════════════════════════════════════════════════════════
   PHONE NORMALISATION  (Nigerian mobile numbers)
   ═══════════════════════════════════════════════════════════
   Accepted inputs (with optional spaces / dashes):
     0703 123 4567   →  +2347031234567
     703 123 4567    →  +2347031234567
     +234 703 123 4567  →  +2347031234567
     234 703 123 4567   →  +2347031234567

   Rules:
   - Strip all spaces and dashes.
   - Strip leading +.
   - If starts with 234, strip it; remainder must be 10 digits.
   - If starts with 0, strip it; remainder must be 10 digits.
   - Remainder must start with 7, 8, or 9 (valid Nigerian mobile prefix).
   - Returns { ok: true, normalized: "+234XXXXXXXXXX" }
          or { ok: false, error: "Human-readable message" }
*/
export function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Phone number is required." };
  }

  // Remove spaces, dashes, and parentheses
  let s = raw.replace(/[\s\-()]/g, "");

  // Strip leading +
  if (s.startsWith("+")) s = s.slice(1);

  // Strip country code prefix 234
  if (s.startsWith("234")) s = s.slice(3);

  // Strip leading 0
  if (s.startsWith("0")) s = s.slice(1);

  // Must be exactly 10 digits now
  if (!/^\d{10}$/.test(s)) {
    return {
      ok: false,
      error:
        "Enter a valid 10-digit Nigerian mobile number (e.g. 0703 123 4567).",
    };
  }

  // Must start with 7, 8, or 9
  if (!/^[789]/.test(s)) {
    return {
      ok: false,
      error: "Nigerian mobile numbers must start with 7, 8, or 9.",
    };
  }

  return { ok: true, normalized: `+234${s}` };
}

/* ═══════════════════════════════════════════════════════════
   DATE HELPERS
   ═══════════════════════════════════════════════════════════ */

/**
 * Returns today's local date as "YYYY-MM-DD".
 * Uses local time — no UTC conversion — so it matches what the
 * librarian sees on their phone/computer calendar.
 */
export function todayString() {
  const d = new Date();
  return toDateString(d);
}

/** Converts a Date object to "YYYY-MM-DD" local string. */
export function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parses "YYYY-MM-DD" to a Date at LOCAL midnight.
 * We do NOT use new Date(str) directly because JS interprets
 * date-only ISO strings as UTC midnight, causing timezone issues.
 */
export function parseLocalDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Adds `days` calendar days to a "YYYY-MM-DD" string.
 * Returns a new "YYYY-MM-DD" string.
 */
export function addDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/**
 * Returns whole-day difference: target - base (can be negative).
 * Both strings are "YYYY-MM-DD".
 */
export function dayDiff(targetStr, baseStr) {
  const t = parseLocalDate(targetStr).getTime();
  const b = parseLocalDate(baseStr).getTime();
  return Math.round((t - b) / 86_400_000);
}

/**
 * Formats "YYYY-MM-DD" to a friendly string: "12 Oct 2026".
 */
export function friendlyDate(dateStr) {
  if (!dateStr) return "—";
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ═══════════════════════════════════════════════════════════
   LOAN STATUS LOGIC
   ═══════════════════════════════════════════════════════════ */

/**
 * Computes loan status from loan data + today's date string.
 *
 * @param {Object} loan  - Firestore loan document data
 * @param {string} today - "YYYY-MM-DD" representing today
 * @returns {{ status: "returned"|"overdue"|"active", daysText: string }}
 */
export function computeLoanStatus(loan, today) {
  if (loan.returnedOn) {
    return {
      status: "returned",
      daysText: `Returned on ${friendlyDate(loan.returnedOn)}`,
    };
  }

  const diff = dayDiff(loan.dueOn, today); // positive = days left, negative = overdue

  if (diff < 0) {
    const n = Math.abs(diff);
    return {
      status: "overdue",
      daysText: n === 1 ? "1 day late" : `${n} days late`,
    };
  }

  if (diff === 0) {
    return { status: "active", daysText: "Due today" };
  }

  return {
    status: "active",
    daysText: diff === 1 ? "1 day left" : `${diff} days left`,
  };
}

/**
 * Sorts an array of loan objects (with .status, .dueOn, .returnedOn).
 * Order: Overdue (most overdue first) → Active (soonest due first)
 *        → Returned (most recently returned first).
 */
export function sortLoans(loans, today) {
  return [...loans].sort((a, b) => {
    const sa = computeLoanStatus(a, today);
    const sb = computeLoanStatus(b, today);

    const rank = { overdue: 0, active: 1, returned: 2 };
    if (rank[sa.status] !== rank[sb.status]) {
      return rank[sa.status] - rank[sb.status];
    }

    if (sa.status === "overdue") {
      // Most overdue = smallest dueOn
      return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;
    }
    if (sa.status === "active") {
      // Soonest due first
      return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;
    }
    // Returned — most recently returned first
    const ra = a.returnedOn || "";
    const rb = b.returnedOn || "";
    return rb < ra ? -1 : rb > ra ? 1 : 0;
  });
}

/* ═══════════════════════════════════════════════════════════
   PHONE SEARCH NORMALISATION
   ═══════════════════════════════════════════════════════════
   Strip +234 prefix, or leading 0, to bare 10 digits for fuzzy search.
*/
export function phoneSearchKey(phone) {
  let s = (phone || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("234")) s = s.slice(3);
  if (s.startsWith("0")) s = s.slice(1);
  return s;
}

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
   ═══════════════════════════════════════════════════════════ */

/**
 * Escapes a single CSV cell value.
 * - Wraps in quotes if it contains commas, quotes, or newlines.
 * - Doubles any internal quotes.
 * - Prefixes with ' if the value starts with =, +, -, or @ (injection guard).
 */
export function csvCell(value) {
  let s = value == null ? "" : String(value);
  // CSV injection guard
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  // Quote if necessary
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Builds a CSV string from an array of loan objects plus today's date.
 * Returns null if loans is empty.
 * @param {Array}  loans  - already filtered / sorted loan objects
 * @param {string} today  - "YYYY-MM-DD"
 * @returns {string|null}
 */
export function buildCSV(loans, today) {
  if (!loans || loans.length === 0) return null;

  const headers = [
    "Book",
    "Author",
    "Borrower",
    "Phone",
    "Borrowed On",
    "Due On",
    "Returned On",
    "Status",
    "Days Left / Overdue",
  ];

  const rows = loans.map((loan) => {
    const { status, daysText } = computeLoanStatus(loan, today);
    return [
      csvCell(loan.bookTitle),
      csvCell(loan.bookAuthor),
      csvCell(loan.borrowerName),
      csvCell(loan.borrowerPhone),
      csvCell(friendlyDate(loan.borrowedOn)),
      csvCell(friendlyDate(loan.dueOn)),
      csvCell(loan.returnedOn ? friendlyDate(loan.returnedOn) : ""),
      csvCell(status.charAt(0).toUpperCase() + status.slice(1)),
      csvCell(daysText),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}

/**
 * Triggers a browser download of a CSV string.
 * UTF-8 BOM is prepended so Excel opens it correctly.
 */
export function downloadCSV(csvString, filename) {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
   WHATSAPP REMINDER MESSAGES
   ═══════════════════════════════════════════════════════════ */

/**
 * Builds the WhatsApp URL for a loan reminder.
 * @param {Object} loan   - loan data
 * @param {string} today  - "YYYY-MM-DD"
 * @returns {string} WhatsApp URL
 */
export function buildWhatsAppURL(loan, today) {
  const { status } = computeLoanStatus(loan, today);
  const diff = dayDiff(loan.dueOn, today);
  const n = Math.abs(diff);
  const dueFormatted = friendlyDate(loan.dueOn);

  let message;
  if (status === "overdue") {
    message =
      `Hello ${loan.borrowerName}, '${loan.bookTitle}' was due on ${dueFormatted} ` +
      `and is now ${n === 1 ? "1 day" : `${n} days`} overdue. ` +
      `Please return it as soon as you can, or let us know if you need more time. Thank you!`;
  } else {
    message =
      `Hello ${loan.borrowerName}, this is a gentle reminder from the Church Library that ` +
      `'${loan.bookTitle}' is due on ${dueFormatted}. ` +
      `Please return it or let us know if you need more time. Thank you!`;
  }

  // Phone must be digits only (no + sign) for WhatsApp
  const digits = loan.borrowerPhone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/* ═══════════════════════════════════════════════════════════
   TEXT ESCAPING (XSS prevention)
   ═══════════════════════════════════════════════════════════ */

/** Escapes a string for safe insertion into HTML text content. */
export function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ═══════════════════════════════════════════════════════════
   CSV PARSER & COLUMN MAPPING (Handles RFC 4180 quotes & breaks)
   ═══════════════════════════════════════════════════════════ */

/**
 * Parses raw CSV text into an array of string arrays (rows of columns).
 * Handles:
 * - Leading UTF-8 BOM
 * - Quoted fields with escaped double quotes ("")
 * - Commas inside quoted fields
 * - Line breaks (\r, \n, \r\n) inside quoted fields
 * - Trims cell whitespace
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  if (!text) return [];

  // Strip UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" inside quotes becomes a single "
          currentCell += '"';
          i++;
        } else {
          // Ending quote
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (char === "\r") {
        // Handle \r or \r\n
        if (nextChar === "\n") i++;
        currentRow.push(currentCell.trim());
        // Only push row if not completely empty
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else if (char === "\n") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
  }

  // Push final cell and row
  currentRow.push(currentCell.trim());
  if (currentRow.some((c) => c !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Auto-detects columns from the header row with common aliases.
 * Aliases:
 * - Title: Title, Book, Book Title, Name
 * - Author: Author, Writer, Authors
 * - Pages: Pages, Page Count, No of Pages, Number of Pages
 * - Copies: Copies, Quantity, Qty, Number of Copies, Stock, Total Copies
 * @param {string[]} headers
 * @returns {{ titleIndex: number, authorIndex: number, pagesIndex: number, copiesIndex: number }}
 */
export function detectColumnMapping(headers) {
  const norm = headers.map((h) =>
    (h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
  );

  const titleAliases = ["title", "book", "booktitle", "name"];
  const authorAliases = ["author", "writer", "authors"];
  const pagesAliases = ["pages", "pagecount", "noofpages", "numberofpages", "page"];
  const copiesAliases = ["copies", "quantity", "qty", "numberofcopies", "stock", "totalcopies"];

  const findMatch = (aliases) => {
    return norm.findIndex((h) => aliases.includes(h));
  };

  return {
    titleIndex: findMatch(titleAliases),
    authorIndex: findMatch(authorAliases),
    pagesIndex: findMatch(pagesAliases),
    copiesIndex: findMatch(copiesAliases),
  };
}

/* ═══════════════════════════════════════════════════════════
   CATEGORY CHIP COLOR
   ═══════════════════════════════════════════════════════════ */

const CATEGORY_PALETTE_SIZE = 6;

/**
 * Derives a stable palette index (0..5) from a category name so the same
 * category always renders with the same chip color. Pure string hash —
 * the actual colors live in css/styles.css as `.cat-chip--0` .. `.cat-chip--5`.
 */
export function categoryColorIndex(category) {
  const str = (category || "").trim().toLowerCase();
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % CATEGORY_PALETTE_SIZE;
}

