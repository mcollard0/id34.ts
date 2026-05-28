# 💡 Encrypted Thoughts & Quick-Note Keeper

An elegant, secure, distraction-free environment for capturing thoughts, coding snippets, tasks, and ideas. Features localized data ownership, SQL-powered full-text indexing, and automatic real-time sync with Google Drive backup systems.

---

## ✨ Features Overview

- **🔒 Local Standalone Ownership**: Your thoughts are stored locally in a standalone, real-time-optimized SQLite3 database (`ideas.sqlite`) powered by transactions and SQL query integrity.
- **🔄 Smart 2-Way Synchronization**: Multi-device support! Instantly syncs local browser caches to the backend, preserving deletion tombstones and resolving edits conflict-free.
- **☁️ Cloud Backup & Automatic Restores**:
  - Connect with your Google Account to automatically upload checkpoint files directly to your personal Google Drive in a folder named `Id34`.
  - **Auto-Restore**: If you sign in on a new device (and have no ideas stored locally), the application will automatically query Google Drive, discover your latest encrypted snapshot, and reconstruct your database seamlessly!
  - **🛡️ Retention Policies & Purges**: Customize your snapshot footprint with a dynamic dropdown retention counter (1 to 99). Older historical snapshots exceeding this boundary are auto-pruned on creation, or can be pruned on demand using the custom **"Purge Backups"** console tool.
- **🔍 Full-Text Indexing (FTS5)**: Ultra-fast keyword and text searches optimized at SQLite module layers rather than running heavy javascript text-filtering algorithms in-browser.
- **📊 Concepts Cloud & Heatmap**: Analyzes keyword density in real-time, visualizing dominant categories and allowing you to filter your feed by tapping on trending tags.

---

## 🛠️ Security & Environments Setup

The system utilizes safe Google Single Sign-on integration for synchronization tasks, powered by standard credentials configuration variables should you choose to override them:

Modify variables securely inside your `.env` configuration file:

```env
# Google SSO Email Bypass whitelist (bypassed: all successful SSO logins accepted)
ALLOWED_USERS="mcollard@gmail.com"

# Google Gemini API key (kept secure, never exposed to user clients)
GEMINI_API_KEY="AIzaSy..."

# Firebase Client Override properties
VITE_FIREBASE_PROJECT_ID="gen-lang-client-..."
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="gen-lang-client-..."
VITE_FIREBASE_STORAGE_BUCKET="gen-lang-client-..."
```

---

## 🚀 Running Locally

### Prerequisites

- **NodeJS** v18+ or v22+
- **NPM** package manager

### Getting Started

1. **Install required dependencies**:
   ```bash
   npm install
   ```

2. **Boot the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the application in your browser.

3. **Build and package for production**:
   ```bash
   npm run build
   ```
   Compiles frontend bundle files and packages the backend server into a single fast, self-contained `dist/server.cjs` file executable via Node.
