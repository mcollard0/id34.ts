# System Architecture

This document describes the design, tech stack, data models, and synchronization flows of the **Encrypted Thoughts & Quick-Note Keeper** web application.

---

## 🚀 Tech Stack Overview

The application is built using a secure, performant, and reliable full-stack architecture:

- **Frontend framework**: [React 19](https://react.dev/) + [Vite 6](https://vite.dev/) (Client SPA bundle).
- **Backend framework**: [Express](https://expressjs.com/) (serving custom APIs and serving production static assets).
- **Primary Database Engine**: [SQLite3](https://www.sqlite.org/index.html) (Local standalone database with SQL transaction safety and built-in **FTS5** full-text search indexing).
- **Secondary Fallback Database Engine**: In-memory Object DB with auto-flushed atomic operations on `ideas_fallback_db.json`, automatically activated if the server's binary `sqlite3` driver is unavailable on the destination operating system.
- **Authentication Engine**: [Google OAuth / Firebase Authentication SDK](https://firebase.google.com/docs/auth) client-side authentication.
- **Micro-animations & Layouts**: [motion](https://github.com/motiondivision/motion) (`motion/react`) for fluid transitions.
- **Styling Guide**: [Tailwind CSS v4](https://tailwindcss.com/) utility classes with fluid layout components.
- **Icon Assets**: [Lucide React](https://lucide.dev/) inline vectors.

---

## 🗄️ Database Architecture

The backend implements a dual-mode storage engine. On startup, `server.ts` dynamically initializes a high-performance **SQLite3** database (`ideas.sqlite`) at the workspace root directory. If the binary module fails to compile, the system immediately downgrades to the JSON-file backup registry, preventing system crashes.

### 1. Unified SQLite Schema

#### Table: `ideas` (Idea Record storage)
| Column | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | High-entropy unique record identifier |
| `content` | `TEXT` | `NOT NULL` | The raw text of the encrypted ideas, lists, or headers |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 String representation of creation time |
| `updated_at` | `TEXT` | `NOT NULL` | ISO 8601 String representing last edit time |
| `deleted` | `INTEGER` | `DEFAULT 0` | Tombstone marker (`0` = Active, `1` = Deleted/Pending Trashing) |

#### Virtual FTS Table: `ideas_fts` (`FTS5` extension enabled)
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS ideas_fts USING fts5(
  id,
  content
);
```
Frees up server memory by executing blazing-fast text-matching indexes, providing near-instantaneous search experiences from the UI search queries.

#### Table: `backups_registry` (Logs of local SQLite snapshots pushed to disk)
| Column | Type | Attributes | Description|
| :--- | :--- | :--- | :--- |
| `filename` | `TEXT` | `PRIMARY KEY` | Encrypted filename matching `backup_xxxx.sqlite` |
| `timestamp` | `TEXT` | `NOT NULL` | ISO 8601 time the snapshot was completed |
| `size` | `TEXT` | `NOT NULL` | Readably formatted size string (e.g., `45.2 KB`) |
| `idea_count` | `INTEGER` | `NOT NULL` | Total active ideas captured inside this snapshot |

---

## 📲 API Routings & Server Controller

The backend server (`server.ts`) exposes several core API endpoints:

- **🔐 Auth & Verification**:
  - `POST /api/auth-check`: Validates successfully logged-in Google users. Whitelist checks are bypassed by user request, making the system globally available to authorized single-sign-on (SSO) consumers.
- **🔄 State Synchronization**:
  - `POST /api/ideas-sync`: Accepts local clients' cached records array and performs a safe **Two-Way Tombstoned Merge**. It updates out-of-date entries, flags deleted items safely, and returns the unified database state to avoid state drift.
- **📂 Drive Auto-Restores & Backups**:
  - `POST /api/restore-latest-drive`: Checks if the server's local SQLite store is empty. If it is empty, matches Google Drive folder name `Id34`, queries backups ordered descending, downloads the latest backup file, closes active DB file handles safely, clones the target file binary on disk, and runs `initializeSQLiteSchema` to dynamically reconnect.
  - `POST /api/backup`: Serializes local SQLite databases (or JSON fallback states) and stream uploads the payload to a designated file inside Google Drive folder `Id34` with `backup_cloud_[date].[sqlite/json]` filenames. Also auto-prunes snapshots exceeding retention constraints when `keepCount` is included in payload parameters.
  - `POST /api/purge-backups`: Evaluates current local files and Google Drive records inside the `Id34` namespace. Deletes all database snapshots exceeding the specified user dropdown threshold (1-99), keeping only the newest copies cleanly.
- **📂 Snapshot Operations**:
  - `GET /api/backups`: Lists existing SQLite snapshots.

---

## 🎨 Layout, Forms & UI Components

### 1. Top Search Drawer (`SearchDrawer.tsx`)
A slides-down interaction panel triggered easily from the search bar. This panel invokes full-text FTS matching on query triggers, indexing matches dynamically with standard highlight loops.

### 2. Interactive Heatmap Cloud (`Heatmap.tsx`)
Parses and strips syntax across all active ideas to extract prominent core keywords. Sshh-level occurrences are highlighted on an visual typography cloud. Tapping keywords scopes the main dashboard feed to instantly isolate matching content blocks.

### 3. Backup Management Panel (`BackupsModal.tsx`)
A transparent modal overlay allowing visual inspections of current cloud snapshots. Facilitates downloading cold DB files, manually firing drive backup triggers, and checking restore logs.

---

## 🔒 Confidential Credentials & API Override Guard

### The Security Incident
A credentials block in `firebase-applet-config.json` was previously exposed during initialization:
- **What secret was leaked?**: This was the **Firebase Client API Key Configuration** block (not the Google Gemini API Key, which remains securely encapsulated inside backend Node `process.env` controls).
- **Impact & Fix**: While standard Firebase Client Keys can safely be loaded in client application targets under Firestore security rules, exposing them hardcoded in project structures is poor practice.
- **The Solution Implementations**:
  1. Updated `src/auth.ts` to implement a dynamic fallback resolver `metaEnv`. It attempts to load keys from modern client environment configurations (`VITE_FIREBASE_API_KEY`, etc.) first.
  2. Registered all configuration parameters inside `.env.example`. Developers can feed these keys safely inside platform configuration portals without committing cleartext identifiers inside file histories.

---

## ⚠️ Multi-Tenant Shared Database Risk & Isolation Strategy

### 1. Current Architecture Behavior
- **Single Shared Database**: All invited/authenticated SSO users on the published deployment target currently read from, write to, and synchronize with the **exact same SQLite database file** (`ideas.sqlite` or `ideas_fallback_db.json`). 
- **No Data Partitioning**: There is no logical row-level partition or tenant segregation currently enforced. Any authenticated user's client-side synchronization will write entries directly into the global tables and fetch the unified set of records from other users.

### 2. Identified Risks
- **Data Leakage**: Since any user has access to load or synchronize, they will automatically sync and see ideas authored by other users on the shared deployment.
- **Overlap on Auto-Backups & auto-purges**: Backups are written to a single folder on Google Drive and managed under a single global retention limit. Users could inadvertently overwrite or delete each other's snapshots.

### 3. Mitigation & Future Multi-Tenant Roadmap (Proposed DB Naming)
To achieve full tenant isolation without introducing massive backend database clusters, the server should adopt an **Isolation-by-Filename** strategy:
- **Individual User/Group Database Files**: Instead of a global `ideas.sqlite`, the database filename should be derived from the user's validated SSO email address or group ID (e.g., `{email}.sqlite` or `{email}.json` fallback).
- **Dynamic DB Multi-Instance Connection Pool**: The backend would safely resolve the user's incoming sub-tenancy on every API request via their session/token, connect or mount the correct database file dynamically, deploy the schemas on a per-tenant layout, and commit transactions to that specific user sandbox only.
