# Church Library Tracker — Beginner Setup Guide

Welcome! This guide walks you through setting up the **Church Library Tracker** from scratch on Windows, even if you haven't used Firebase before.

---

## Prerequisites

- A modern browser (Chrome recommended)
- [VS Code](https://code.visualstudio.com/) installed
- [Node.js](https://nodejs.org/) installed (for `npx serve` and Firebase CLI)
- A Google account

---

## Step 1 — Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Give it a name like `rcf-library-tracker`
4. Disable Google Analytics (not needed) → Click **Create project**
5. Wait for it to be ready, then click **Continue**

---

## Step 2 — Add a Web App and Copy the Config

1. On your project's **Project Overview** page, click the **`</>`** (Web) icon to add a web app
2. Give it a nickname like `Library Tracker Web`
3. **Do NOT** tick "Also set up Firebase Hosting" right now
4. Click **Register app**
5. You'll see a `firebaseConfig` block like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. Open `js/firebase-config.js` in VS Code
7. Replace each `"YOUR_..."` placeholder with the real values from your console
8. **Save the file**

> ⚠️ These values are safe to commit to a public repo (they are restricted by Firestore Security Rules). Do NOT commit your Firebase Admin SDK service account key.

---

## Step 3 — Enable Authentication (Email/Password)

1. In the Firebase console left sidebar, click **Authentication**
2. Click **Get started**
3. Under **Sign-in method**, click **Email/Password**
4. Toggle **Enable** to ON
5. Click **Save**

---

## Step 4 — Create Cloud Firestore

1. In the sidebar, click **Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** (security rules will be added next)
4. For the region, choose **`europe-west1` (Belgium)** — it's the closest to Nigeria
5. Click **Enable**

---

## Step 5 — Create the First Librarian Account

This is a two-part process: create the user in Authentication, then add their UID to Firestore.

**Part A — Create the user:**
1. Go to **Authentication → Users**
2. Click **Add user**
3. Enter the librarian's email and a strong password
4. Click **Add user**
5. **Copy the UID** shown in the users table (it looks like `abc123def456...`)

**Part B — Add to the librarians collection:**
1. Go to **Firestore Database → Data**
2. Click **Start collection** (or **+ Add collection** if one already exists)
3. Collection ID: `librarians`
4. Document ID: **paste the UID you copied**
5. Add a field: `email` (type: string) = the librarian's email
6. Click **Save**

> 🔐 Only users whose UID exists in this `librarians` collection can log in. Anyone else who somehow gets the API key and tries to log in will be rejected by the app.

Repeat Part A and B for each additional librarian.

---

## Step 6 — Publish the Firestore Security Rules

**Option A — Firebase Console (easiest):**
1. Go to **Firestore Database → Rules**
2. Delete the existing rules
3. Copy the entire contents of `firestore.rules` from this project
4. Paste it into the editor
5. Click **Publish**

**Option B — Firebase CLI:**
```powershell
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

---

## Step 7 — Run Locally

> ⚠️ **Important:** ES modules (`type="module"` scripts) do **NOT** work when you open `index.html` directly from the file system (`file://`). You must serve the folder over HTTP.

**Option A — VS Code Live Server (recommended for beginners):**
1. Install the **Live Server** extension in VS Code
2. Right-click `index.html` in the Explorer panel
3. Click **Open with Live Server**
4. Your browser opens at `http://127.0.0.1:5500`

**Option B — npx serve:**
```powershell
npx serve .
```
Then open `http://localhost:3000` in your browser.

---

## Step 8 — Deploy to Firebase Hosting

```powershell
# Install Firebase CLI (once)
npm install -g firebase-tools

# Login to your Google account
firebase login

# Link this folder to your Firebase project
firebase use YOUR_FIREBASE_PROJECT_ID

# Deploy
firebase deploy --only hosting
```

Your app will be live at `https://YOUR_PROJECT_ID.web.app`

---

## Step 9 — Manual Testing Checklist

Work through each item after setup. Check off ✅ as you go.

### Authentication
- [ ] Open the app at `http://localhost:...` — you see the login screen
- [ ] Try a wrong password — you see a friendly error message
- [ ] Try an email that isn't in Firebase Auth — you see a "No account" error
- [ ] Try logging in with a real Firebase user whose UID is NOT in `librarians` — you see "not authorized"
- [ ] Log in with a valid librarian — you reach the app
- [ ] Refresh the page — you stay logged in
- [ ] Click Logout — you return to the login screen

### Books Tab
- [ ] Click the **Books** tab
- [ ] Click **Load 5 sample books** — 5 books appear
- [ ] Click **+ Add Book** — fill in a title and author and save — it appears in the list
- [ ] Click ✏️ on a book — edit the title — save — changes appear instantly
- [ ] Try reducing copies below the number currently out (should be blocked with an error)
- [ ] Click 🗑️ on a book with no active loans — confirm — it disappears
- [ ] Try deleting a book that has an active loan — you see an error toast

### New Loan
- [ ] Click **+ New Loan**
- [ ] Type a phone number in different formats (0703…, +2347…) — they all normalise
- [ ] Type an invalid phone — you see a validation error
- [ ] Type a phone of an existing borrower — the name auto-fills
- [ ] Select a book from the dropdown
- [ ] Set the due date before the borrowed date — save is blocked with an error
- [ ] Create a valid loan — success toast appears — loan appears in the list

### Loans List
- [ ] Loans show the correct status badge (Active / Overdue / Returned)
- [ ] Overdue loans appear at the top
- [ ] Pill filter counts match the list
- [ ] Click **Overdue** pill — only overdue loans shown
- [ ] Search by name — list filters live
- [ ] Search by phone in a different format — still matches

### Record Actions
- [ ] Click ✅ **Return** on an active loan — confirm — loan turns green
- [ ] Click 🔄 **Reopen** on a returned loan — it becomes active again
- [ ] Click 📅 **Extend** — enter a date in the past — blocked; enter future date — works
- [ ] Click ✏️ **Edit** on a loan — change name — save — updates everywhere
- [ ] Click 💬 **Remind** on an overdue loan — WhatsApp opens in a new tab with the correct message
- [ ] Click 📞 — your phone/device prompts a call
- [ ] Click 🗑️ **Delete** an active loan — confirm — it disappears; copy count increases

### Dashboard Cards
- [ ] Overdue card shows the correct count
- [ ] Click the Overdue card — filter switches to Overdue
- [ ] Due Soon card shows loans due in 0–2 days

### CSV Export
- [ ] Click **Export Spreadsheet (.csv)** — file downloads
- [ ] Open in Excel — UTF-8 BOM detected, columns look correct
- [ ] Filter to Overdue, export — only overdue rows in file
- [ ] Clear all loans, export — toast says nothing to export

---

## Step 10 — Troubleshooting

### `FirebaseError: Missing or insufficient permissions`
- Your Firestore rules are not published yet (follow Step 6)
- OR the logged-in user's UID is not in the `librarians` collection (follow Step 5B)

### Blank page or "Failed to load module"
- You opened `index.html` directly from the file system. Use Live Server or `npx serve` instead (Step 7)

### "This account is not authorized"
- The user exists in Firebase Auth but their UID is not a document in `librarians`. Add it manually in Firestore (Step 5B)

### Books or loans don't load (spinner forever)
- Check your browser console (F12) for the exact error
- Usually a missing Firestore region or rules that haven't been published yet

### Forgot password email not received
- Check spam folder
- Make sure the email matches exactly what's in Firebase Auth

### Phone normalisation not working
- Phone must be a 10-digit Nigerian mobile number after stripping the country code
- Valid prefixes after country code: 7, 8, or 9

---

## File Structure Reference

```
├── index.html            — Single-page app shell
├── css/
│   └── styles.css        — Full design system
├── js/
│   ├── firebase-config.js — YOUR Firebase keys go here
│   ├── app.js            — Startup, auth state, routing
│   ├── auth.js           — Login, logout, allowlist check
│   ├── books.js          — Books tab logic
│   ├── loans.js          — Loans tab, record actions, CSV
│   ├── ui.js             — Toast, modal, confirm dialog
│   └── utils.js          — Phone, dates, CSV builder, status logic
├── assets/
│   └── logo.png          — Replace with your church logo
├── firestore.rules       — Firestore security rules
├── firebase.json         — Firebase Hosting configuration
└── .firebaserc           — Firebase project ID placeholder
```

---

## Phase 2 Roadmap (future additions)

The data model is designed to support these without a rewrite:

- **Borrower accounts** — `borrowers/{phone}` already exists with `fullName` and `phone`
- **Per-book reading plans** — `totalPages` stored on books; `dueOn` on loans enables reading-pace calculation
- **Pomodoro timer** — can be added as a UI-only feature
- **Automatic reminders** — Cloud Functions can query overdue loans and send WhatsApp/SMS via Twilio

---

*Built for RCF FUNAAB Church Library — October 2026*


