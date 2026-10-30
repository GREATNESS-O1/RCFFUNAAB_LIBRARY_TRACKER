# Friendly Redesign — Summary (Sections 1–8)

## Files changed
- `css/styles.css` — the bulk of the work: tokens, typography floors, touch targets, dashboard cards, header/nav, help sheet, contrast fixes.
- `index.html` — wording, the anti-flash light-default script, the Help button, "Sign out" label, header/logo markup.
- `js/ui.js` — `showToast`/`confirmDialog` already existed; added `openHelpSheet()`.
- `js/loans.js` — labels, toasts, confirm dialogs, Undo actions, phone links, loan card/row templates.
- `js/books.js` — labels, toasts, confirm dialogs, touch-target fixes, phone/title markup.
- `js/app.js` — `initTheme()` simplified to light-by-default, Help button wiring, logout toast wording.
- `js/utils.js` — "overdue" → "late" wording in the computed status text.
- `js/icons.js` — added a `chevron-right` icon used on the dashboard's "View" links.

## Before → after, by section

1. **Light is the default** — Removed all `prefers-color-scheme` system-dark hooks (three separate leftover spots, found across Sections 1 and 8). The app now opens light for every volunteer regardless of their phone's theme, until they tap the toggle themselves.
2. **One primary action per screen** — "New Loan" → **"Lend a book"**, shown once: as a toolbar button on desktop/tablet, as a single floating **+** button on phones (the toolbar copy hides below 900px so there's never two competing blue buttons).
3. **Plain-language wording** — "Currently Borrowed" → "Lent out now", "Overdue" → "Late", "Active" → "Out now", "Extend due date" → "Give more time", "Send reminder" → "Remind on WhatsApp", etc. Internal field names, status keys (`overdue`, `active`...), and Firestore structure are untouched.
4. **Readability & touch** — Every font size has a 13px floor; buttons/inputs sit at a 48px touch-target minimum on phones; focus rings use a visible outline instead of a faint shadow.
5. **Dashboard & lists** — Cards only turn red/amber when there's something to act on (zero stays neutral); the Late card gets a soft red wash with a "View" shortcut into the filtered list; borrower phone numbers are now live `tel:` links instead of plain text.
6. **Header & navigation** — Logo gets a small white circular backdrop (its own art has soft edges that needed definition against the white header); avatar menu reads "Sign out" instead of "Logout"; mobile keeps the bottom icon nav + floating action button, desktop keeps top tabs.
7. **Help & reassurance** — New "?" button opens a plain-language how-to sheet (Lend a book / Receive a return / Remind on WhatsApp / Download the list); "Mark returned" and "Give more time" now offer a 6-second **Undo**, joining the lend-a-book Undo that already existed; destructive confirms all read "Yes, delete" with a calm, pre-focused "Cancel".
8. **Verify** — Tested 360/768/1280px, light + dark, 150% zoom, and a large system font. Found and fixed: a dark-mode text-contrast bug on every accent-colored link/label (2.8:1 → ~5:1), a light-mode contrast edge case on faint text over tinted backgrounds, two dead `prefers-color-scheme` leftovers, one font size under the 13px floor, and a large-font layout overflow on the dashboard cards.

## Chose not to change
- The book **category-chip** color system (the 6 rotating pastel tag colors) — it predates this brief, is out of its stated scope (`css/styles.css`, `index.html`, `js/ui.js` + behavior-preserving wording), and already passes contrast in both themes, so it was left alone beyond removing its dead duplicate dark-mode CSS block.
- Catalog-management features (bulk cleanup tools, CSV import upgrades, shelf grid view) and the larger multi-collection ILS rework — both were explicitly shelved earlier in favor of finishing this brief first, and nothing here reopens them.
- No Firestore structure, field names, security rules, or data logic were touched anywhere in this pass — confirmed by keeping every status key, collection name, and document field exactly as they were; only user-facing labels and visuals changed.

## How to spot-check it yourself
- Open the app on a phone-width window: light theme by default, one blue "+" button, bottom nav reads "Lent out" / "Books".
- Tap the "?" in the header — the how-to sheet should open with 4 short, plain-language cards.
- Mark a loan as returned — a toast should appear with an "Undo" button.
- Switch to dark mode and check that phone numbers, "View" links, and tab labels are all clearly legible, not dim.
- Resize the window narrow/wide and zoom in — nothing should clip, overlap, or need horizontal scrolling except the data table's rightmost columns.
