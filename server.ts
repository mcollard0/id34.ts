import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

// Enable JSON bodies
app.use(express.json({ limit: "5mb" }));

// Establish SQLite connection metadata
const DB_FILE = path.join(process.cwd(), "ideas.sqlite");
const BACKUP_DIR = path.join(process.cwd(), "backups");
const FALLBACK_DB_FILE = path.join(process.cwd(), "ideas_fallback_db.json");

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Global active database state controls
let useFallback = false;
let dbInstance: any = null;

// Persistent Fallback Database Schema
interface FallbackSchema {
  ideas: Record<string, {
    id: string;
    content: string;
    created_at: string;
    updated_at: string;
    deleted: number;
  }>;
  backups_registry: Array<{
    filename: string;
    timestamp: string;
    size: string;
    idea_count: number;
  }>;
}

let fallbackDb: FallbackSchema = {
  ideas: {},
  backups_registry: [],
};

// Pre-load Fallback Cache from JSON if available
if (fs.existsSync(FALLBACK_DB_FILE)) {
  try {
    const data = fs.readFileSync(FALLBACK_DB_FILE, "utf-8");
    fallbackDb = JSON.parse(data);
    if (!fallbackDb.ideas) fallbackDb.ideas = {};
    if (!fallbackDb.backups_registry) fallbackDb.backups_registry = [];
    console.log(`Preloaded ${Object.keys(fallbackDb.ideas).length} fallback records.`);
  } catch (err) {
    console.error("Failed to read fallback DB json file:", err);
  }
}

function saveFallbackDb() {
  try {
    fs.writeFileSync(FALLBACK_DB_FILE, JSON.stringify(fallbackDb, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to fallback DB json file:", err);
  }
}

// Load sqlite3 dynamically under async initialization block to prevent top-level await compile failures
let sqlite3: any = null;

function initializeSQLiteSchema() {
  dbInstance.serialize(() => {
    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS ideas (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);

    dbInstance.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ideas_fts USING fts5(
        id,
        content
      )
    `, (err: any) => {
      if (err) {
        console.warn("FTS5 table installation warning (it might already exist or is unsupported):", err);
      }
    });

    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS backups_registry (
        filename TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        size TEXT NOT NULL,
        idea_count INTEGER NOT NULL
      )
    `);

    console.log("SQLite3 schemas deployed.");
  });
}

// Unified query wrapper executing client commands transparently based on SQLite capability presence
export function allQuery(sql: string, params: any[]): Promise<any[]> {
  if (useFallback) {
    return runFallbackAll(sql, params);
  }
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (err: any, rows: any[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export function runQuery(sql: string, params: any[]): Promise<void> {
  if (useFallback) {
    return runFallbackRun(sql, params);
  }
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function rebuildFTSIndex(callback?: () => void) {
  if (useFallback) {
    if (callback) callback();
    return;
  }
  dbInstance.serialize(() => {
    dbInstance.run("DELETE FROM ideas_fts");
    dbInstance.run(
      `INSERT INTO ideas_fts (id, content) 
       SELECT id, content FROM ideas WHERE deleted = 0`,
      (err: any) => {
        if (err) {
          console.error("Failed to rebuild SQLite FTS indexes:", err);
        } else {
          console.log("FTS index rebuild successful.");
        }
        if (callback) callback();
      }
    );
  });
}

// Emulators for Fallback DB behavior
async function runFallbackAll(sql: string, params: any[]): Promise<any[]> {
  const norm = sql.trim().toLowerCase();

  // 1. SELECT COUNT
  if (norm.includes("select count(*) as count")) {
    const list = Object.values(fallbackDb.ideas).filter(idea => idea.deleted === 0);
    return [{ count: list.length }];
  }

  // 2. BACKUPS LIST
  if (norm.includes("select * from backups_registry")) {
    const list = [...fallbackDb.backups_registry];
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }

  // 3. GET IDEAS
  if (norm.includes("select * from ideas")) {
    const list = Object.values(fallbackDb.ideas);
    if (norm.includes("deleted = 0")) {
      return list.filter((idea) => idea.deleted === 0);
    }
    return list;
  }

  return [];
}

async function runFallbackRun(sql: string, params: any[]): Promise<void> {
  const norm = sql.trim().toLowerCase();

  // 1. INSERT IDEA
  if (norm.includes("insert into ideas") && norm.includes("values")) {
    const [id, content, created_at, updated_at, deleted] = params;
    fallbackDb.ideas[id] = { id, content, created_at, updated_at, deleted };
    saveFallbackDb();
    return;
  }

  // 2. UPDATE IDEA
  if (norm.includes("update ideas")) {
    const [content, created_at, updated_at, deleted, id] = params;
    // Overwrite safely
    fallbackDb.ideas[id] = { id, content, created_at, updated_at, deleted };
    saveFallbackDb();
    return;
  }

  // 3. INSERT BACKUP
  if (norm.includes("insert into backups_registry")) {
    const [filename, timestamp, size, idea_count] = params;
    fallbackDb.backups_registry.push({ filename, timestamp, size, idea_count });
    saveFallbackDb();
    return;
  }
}

// API: Health probe
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: useFallback ? "JSON_Fallback" : "SQLite3" });
});

// API: Sync and merge local ideas
app.post("/api/sync", async (req, res) => {
  try {
    const { ideas } = req.body;
    if (!Array.isArray(ideas)) {
      res.status(400).json({ error: "Invalid payload: ideas must be an array" });
      return;
    }

    console.log(`Sync request. Processing ${ideas.length} ideas.`);

    // Read all server records
    const serverIdeas = await allQuery("SELECT * FROM ideas", []);
    const serverMap = new Map<string, any>();
    serverIdeas.forEach((row) => serverMap.set(row.id, row));

    // Merge logic comparing timestamps
    for (const clientIdea of ideas) {
      const serverVersion = serverMap.get(clientIdea.id);

      if (!serverVersion) {
        // Record is fresh
        await runQuery(
          "INSERT INTO ideas (id, content, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?)",
          [
            clientIdea.id,
            clientIdea.content,
            clientIdea.created_at,
            clientIdea.updated_at,
            clientIdea.deleted,
          ]
        );
      } else {
        const clientTime = new Date(clientIdea.updated_at).getTime();
        const serverTime = new Date(serverVersion.updated_at).getTime();

        if (clientTime > serverTime) {
          // Client copy is newer
          await runQuery(
            "UPDATE ideas SET content = ?, created_at = ?, updated_at = ?, deleted = ? WHERE id = ?",
            [
              clientIdea.content,
              clientIdea.created_at,
              clientIdea.updated_at,
              clientIdea.deleted,
              clientIdea.id,
            ]
          );
        }
      }
    }

    // Index & Retrieve updated state
    rebuildFTSIndex(async () => {
      try {
        const rows = await allQuery("SELECT * FROM ideas WHERE deleted = 0", []);
        res.json({ success: true, ideas: rows, timestamp: new Date().toISOString() });
      } catch (err: any) {
        res.status(500).json({ error: "Post-sync retrieval failed" });
      }
    });
  } catch (error: any) {
    console.error("Reconciliation sync error:", error);
    res.status(500).json({ error: error?.message || "Sync subsystem error" });
  }
});

// API: Full Text Search using SQLite FTS5 matching or JSON substring fallback matching
app.get("/api/search", async (req, res) => {
  try {
    const queryStr = req.query.q ? String(req.query.q).trim() : "";

    if (useFallback) {
      const activeIdeas = Object.values(fallbackDb.ideas).filter((i) => i.deleted === 0);
      if (!queryStr) {
        res.json(activeIdeas);
        return;
      }
      const searchTerms = queryStr.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
      const filtered = activeIdeas.filter((idea) => {
        const contentLower = idea.content.toLowerCase();
        return searchTerms.every(term => contentLower.includes(term));
      });
      res.json(filtered);
      return;
    }

    // Standard SQLite3 path
    if (!queryStr) {
      const activeIdeas = await allQuery("SELECT * FROM ideas WHERE deleted = 0", []);
      res.json(activeIdeas);
      return;
    }

    console.log(`FTS SQLite matching for raw query: "${queryStr}"`);
    const cleanedSearchPhrase = queryStr.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
    
    let rows: any[] = [];
    if (cleanedSearchPhrase) {
      try {
        rows = await allQuery(
          `SELECT i.* FROM ideas i 
           JOIN ideas_fts f ON i.id = f.rowid 
           WHERE f.content MATCH ? AND i.deleted = 0`,
          [cleanedSearchPhrase]
        );
      } catch (ftsError) {
        console.warn("FTS MATCH errored, falling back to LIKE query:", ftsError);
        rows = [];
      }
    }

    // Fallback search to guarantee matches for substring keywords
    if (rows.length === 0) {
      rows = await allQuery(
        "SELECT * FROM ideas WHERE content LIKE ? AND deleted = 0",
        [`%${queryStr}%`]
      );
    }

    res.json(rows);
  } catch (error: any) {
    console.error("Search index retrieval failed:", error);
    res.status(500).json({ error: error?.message || "Search index retrieval failed" });
  }
});

// API: Get backups list
app.get("/api/backups", async (req, res) => {
  try {
    const registry = await allQuery("SELECT * FROM backups_registry ORDER BY timestamp DESC", []);
    res.json(registry);
  } catch (err: any) {
    console.error("Failed to list backups:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Search and restore the latest database backup from Google Drive folder "Id34"
app.post("/api/restore-latest-drive", async (req, res) => {
  try {
    const { googleAccessToken } = req.body;
    if (!googleAccessToken) {
      res.status(400).json({ success: false, error: "Access token is required to download backups from Google Drive." });
      return;
    }

    console.log("Starting Google Drive restore check...");

    // 1. Check if we already have ideas in the server's database.
    // If we do, we do NOT restore since the requirement specifies retrieving restore only on "no ideas in the database locally" (empty database).
    const activeCountRows = await allQuery("SELECT COUNT(*) as count FROM ideas WHERE deleted = 0", []);
    const count = activeCountRows[0]?.count || 0;
    
    if (count > 0) {
      res.json({
        success: false,
        restored: false,
        message: "Restore skipped. Local database is not empty."
      });
      return;
    }

    // 2. Search for the directory "Id34" on Google Drive
    const qStr = "name='Id34' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false";
    const searchFolderUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qStr)}`;
    
    const folderRes = await fetch(searchFolderUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!folderRes.ok) {
      const errText = await folderRes.text();
      res.status(502).json({ success: false, error: `Google Drive Folder search failed: ${errText}` });
      return;
    }

    const folderData: any = await folderRes.json();
    if (!folderData.files || folderData.files.length === 0) {
      res.json({
        success: true,
        restored: false,
        message: "No backup folder 'Id34' found in Google Drive."
      });
      return;
    }

    const folderId = folderData.files[0].id;

    // 3. Search for files in this folder, ordered by createdTime descending
    const ext = useFallback ? "json" : "sqlite";
    const fileQStr = `'${folderId}' in parents and name contains 'backup_cloud_' and name contains '.${ext}' and trashed=false`;
    const searchFileUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQStr)}&orderBy=createdTime%20desc&pageSize=1`;

    const fileRes = await fetch(searchFileUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!fileRes.ok) {
      const errText = await fileRes.text();
      res.status(502).json({ success: false, error: `Google Drive File search failed: ${errText}` });
      return;
    }

    const fileData: any = await fileRes.json();
    if (!fileData.files || fileData.files.length === 0) {
      res.json({
        success: true,
        restored: false,
        message: `No backup files ending in .${ext} found in Google Drive folder 'Id34'.`
      });
      return;
    }

    const targetFile = fileData.files[0];
    console.log(`Found latest backup in Drive: '${targetFile.name}' (${targetFile.id})`);

    // 4. Download backup file from Google Drive
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`;
    const downloadRes = await fetch(downloadUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      res.status(502).json({ success: false, error: `Google Drive file download failed: ${errText}` });
      return;
    }

    if (useFallback) {
      // JSON Mode
      const backupJson: any = await downloadRes.json();
      if (!backupJson || typeof backupJson !== "object" || !backupJson.ideas) {
        throw new Error("Invalid or corrupted JSON backup loaded from Drive.");
      }
      fallbackDb = {
        ideas: backupJson.ideas || {},
        backups_registry: backupJson.backups_registry || []
      };
      saveFallbackDb();
      console.log(`Successfully restored fallback database with ${Object.keys(fallbackDb.ideas).length} records from Google Drive.`);
    } else {
      // SQLite3 Mode
      const arrayBuffer = await downloadRes.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      if (fileBuffer.length === 0) {
        throw new Error("Empty binary SQLite3 backup file downloaded from Drive.");
      }

      // First close the existing SQLite connection safely
      if (dbInstance) {
        await new Promise<void>((resolve) => {
          dbInstance.close((err: any) => {
            if (err) {
              console.error("Error closing SQLite connection on restore:", err);
            }
            resolve();
          });
        });
      }

      // Overwrite the live SQLite DB file
      fs.writeFileSync(DB_FILE, fileBuffer);

      // Re-initialize and reconnect
      const sqlite3Verbose = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
      await new Promise<void>((resolve, reject) => {
        dbInstance = new sqlite3Verbose.Database(DB_FILE, (err: any) => {
          if (err) {
            reject(err);
          } else {
            console.log("Restored SQLite database reconnected successfully.");
            resolve();
          }
        });
      });

      // Ensure system schema is built
      initializeSQLiteSchema();

      // Regenerate FTS5 Indexes
      await new Promise<void>((resolve) => {
        rebuildFTSIndex(() => resolve());
      });
    }

    // 5. Gather ideas list to return
    const restoredIdeas = await allQuery("SELECT * FROM ideas WHERE deleted = 0", []);
    console.log(`Database sync restore completed successfully! Restored count: ${restoredIdeas.length}`);

    res.json({
      success: true,
      restored: true,
      message: `Successfully restored database from Google Drive backup '${targetFile.name}'!`,
      ideas: restoredIdeas
    });
  } catch (err: any) {
    console.error("Google Drive backup restore failed:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal restore failure" });
  }
});

// API: Verify Google SSO logged in user email and grant access
app.post("/api/auth-check", (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ allowed: false, error: "Missing email address for verification" });
      return;
    }
    
    // Whitelist check removed by user request - all successfully logged-in Google SSO users are allowed
    res.json({ allowed: true });
  } catch (error: any) {
    res.status(500).json({ allowed: false, error: error?.message || "Internal auth check failure" });
  }
});

// Google Drive Folder backup syncing helper 
async function uploadToGoogleDrive(accessToken: string, backupFilename: string, backupPath: string, isFallback: boolean): Promise<any> {
  // 1. Search for folder "Id34" at user's root directory in Drive
  const qStr = "name='Id34' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false";
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qStr)}`;
  
  const searchRes = await fetch(searchUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!searchRes.ok) {
    const errText = await searchRes.text();
    let helpfulTip = "Google Drive Search failed.";
    if (errText.includes("insufficientPermissions") || errText.includes("auth") || errText.includes("scope")) {
      helpfulTip += " [Action Required]: To grant Google Drive access, please log out (using the top-right exit icon) and then log back in. This will trigger Google's permission prompt asking you to allow files/folders sync access.";
    }
    throw new Error(`${helpfulTip} Details: ${errText}`);
  }
  
  const searchData: any = await searchRes.json();
  let folderId = "";
  
  if (searchData.files && searchData.files.length > 0) {
    folderId = searchData.files[0].id;
    console.log(`Located existing Google Drive Backup folder 'Id34' with ID: ${folderId}`);
  } else {
    // Create 'Id34' folder
    console.log("Could not find folder Id34 in Drive. Provisioning a new folder.");
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Id34",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"]
      })
    });
    
    if (!createRes.ok) {
      const errText = await createRes.text();
      let helpfulTip = "Google Drive folder 'Id34' creation failed.";
      if (errText.includes("insufficientPermissions") || errText.includes("auth") || errText.includes("scope")) {
        helpfulTip += " [Action Required]: Please log out and sign back in to grant Google Drive file access.";
      }
      throw new Error(`${helpfulTip} Details: ${errText}`);
    }
    
    const folderData: any = await createRes.json();
    folderId = folderData.id;
    console.log(`Created new Google Drive folder 'Id34' with ID: ${folderId}`);
  }
  
  // 2. Perform multipart upload of local backup file to the Google Drive folder "Id34"
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  
  const contentType = isFallback ? "application/json" : "application/x-sqlite3";
  const metadata = {
    name: backupFilename,
    mimeType: contentType,
    parents: [folderId]
  };
  
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(backupPath);
  } catch (err: any) {
    throw new Error(`Unable to read backup file at ${backupPath}: ${err.message}`);
  }
  
  const multipartBody = Buffer.concat([
    Buffer.from(delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + delimiter),
    Buffer.from(`Content-Type: ${contentType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
    Buffer.from(fileBuffer.toString("base64")),
    Buffer.from(closeDelim)
  ]);
  
  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(multipartBody.length)
    },
    body: multipartBody
  });
  
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    let helpfulTip = "Google Drive backup file upload failed.";
    if (errText.includes("insufficientPermissions") || errText.includes("auth") || errText.includes("scope")) {
      helpfulTip += " [Action Required]: Please log out and sign back in to authorize Google Drive files access.";
    }
    throw new Error(`${helpfulTip} Details: ${errText}`);
  }
  
  const uploadData: any = await uploadRes.json();
  console.log(`Backup successfully synced to Google Drive /Id34/: ${uploadData.name} ID: ${uploadData.id}`);
  return uploadData;
}

// Helper: Purge backups exceeding retention count
async function purgeOldBackups(keepCount: number, googleAccessToken?: string | null): Promise<{ purgedLocal: string[], purgedDriveCount: number, drivePurgeError: string | null }> {
  try {
    const limit = keepCount;
    console.log(`Pruning excess backups. Restricting to maximum of ${limit} latest backups.`);

    // 1. Fetch all local backup entries from registry, ordered by timestamp DESC
    const backups = await allQuery("SELECT * FROM backups_registry ORDER BY timestamp DESC", []);
    
    const purgedLocalFiles: string[] = [];
    if (backups.length > limit) {
      const itemsToPurge = backups.slice(limit);
      for (const item of itemsToPurge) {
        const filePath = path.join(BACKUP_DIR, item.filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (unlinkErr) {
            console.error(`Failed to delete local backup file ${item.filename}:`, unlinkErr);
          }
        }
        // Remove from DB registry
        await runQuery("DELETE FROM backups_registry WHERE filename = ?", [item.filename]);
        
        // Also if fallback is active
        if (useFallback) {
          fallbackDb.backups_registry = fallbackDb.backups_registry.filter((r) => r.filename !== item.filename);
          saveFallbackDb();
        }
        
        purgedLocalFiles.push(item.filename);
      }
    }

    // 2. Google Drive Backup Purge
    let purgedDriveFilesCount = 0;
    let drivePurgeError = null;

    if (googleAccessToken) {
      try {
        // Find Google Drive folder "Id34"
        const qStr = "name='Id34' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false";
        const searchFolderUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qStr)}`;
        const folderRes = await fetch(searchFolderUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${googleAccessToken}` }
        });

        if (folderRes.ok) {
          const folderData: any = await folderRes.json();
          if (folderData.files && folderData.files.length > 0) {
            const folderId = folderData.files[0].id;
            
            // Search files inside this folder, ordered by createdTime DESC
            const ext = useFallback ? "json" : "sqlite";
            const fileQStr = `'${folderId}' in parents and name contains 'backup_cloud_' and name contains '.${ext}' and trashed=false`;
            
            // Since ordering is by createdTime desc, we check our items
            const searchFileUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQStr)}&orderBy=createdTime%20desc&pageSize=100`;
            const fileRes = await fetch(searchFileUrl, {
              method: "GET",
              headers: { Authorization: `Bearer ${googleAccessToken}` }
            });

            if (fileRes.ok) {
              const fileData: any = await fileRes.json();
              const files = fileData.files || [];
              if (files.length > limit) {
                const driveToPurge = files.slice(limit);
                for (const driveFile of driveToPurge) {
                  // Delete file from Drive
                  const deleteUrl = `https://www.googleapis.com/drive/v3/files/${driveFile.id}`;
                  const deleteRes = await fetch(deleteUrl, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${googleAccessToken}` }
                  });
                  if (deleteRes.ok) {
                    purgedDriveFilesCount++;
                  } else {
                    console.error(`Failed to delete Drive file ${driveFile.name} (${driveFile.id})`);
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.error("Purging Google Drive backups failed:", err);
        drivePurgeError = err?.message || "Error communicating with Google Drive during purge";
      }
    }

    return {
      purgedLocal: purgedLocalFiles,
      purgedDriveCount: purgedDriveFilesCount,
      drivePurgeError
    };

  } catch (error: any) {
    console.error("Pruning process error:", error);
    return {
      purgedLocal: [],
      purgedDriveCount: 0,
      drivePurgeError: error?.message || "Pruning critical error"
    };
  }
}

// API: Clear old backups exceeding selected limit
app.post("/api/purge-backups", async (req, res) => {
  try {
    const { keepCount, googleAccessToken } = req.body;
    const limit = parseInt(keepCount, 10);
    if (isNaN(limit) || limit < 1 || limit > 99) {
      res.status(400).json({ success: false, error: "Invalid retention count (1-99 expected)." });
      return;
    }

    const purgeResult = await purgeOldBackups(limit, googleAccessToken);
    res.json({
      success: true,
      message: `Successfully purged excess backup snapshots! Kept the most recent ${limit} items.`,
      purgedLocalCount: purgeResult.purgedLocal.length,
      purgedDriveCount: purgeResult.purgedDriveCount,
      drivePurgeError: purgeResult.drivePurgeError
    });
  } catch (err: any) {
    console.error("Purge API router error:", err);
    res.status(500).json({ success: false, error: err?.message || "Internal server error on purge trigger" });
  }
});

// API: Binary or JSON snapshot cloud backup execution
app.post("/api/backup", async (req, res) => {
  try {
    const { googleAccessToken, keepCount } = req.body;
    const timestamp = new Date().toISOString();
    const safeTimestampString = timestamp.replace(/[:.]/g, "-");
    const activeFile = useFallback ? FALLBACK_DB_FILE : DB_FILE;
    const ext = useFallback ? "json" : "sqlite";
    
    const backupFilename = `backup_cloud_${safeTimestampString}.${ext}`;
    const backupPath = path.join(BACKUP_DIR, backupFilename);

    const activeCountRows = await allQuery("SELECT COUNT(*) as count FROM ideas WHERE deleted = 0", []);
    const count = activeCountRows[0]?.count || 0;

    if (!fs.existsSync(activeFile)) {
      res.json({
        success: true,
        message: "No ideas saved yet. Database currently unwritten/empty.",
        backup: {
          filename: `backup_waiting_active_data.${ext}`,
          timestamp,
          size: "0 B",
          ideaCount: 0,
        },
      });
      return;
    }

    // Copy live database file
    fs.copyFileSync(activeFile, backupPath);

    const stat = fs.statSync(backupPath);
    let sizeStr = `${stat.size} Bytes`;
    if (stat.size > 1024 * 1024) {
      sizeStr = `${(stat.size / (1024 * 1024)).toFixed(2)} MB`;
    } else if (stat.size > 1024) {
      sizeStr = `${(stat.size / 1024).toFixed(2)} KB`;
    }

    // Insert back up entry
    await runQuery(
      "INSERT INTO backups_registry (filename, timestamp, size, idea_count) VALUES (?, ?, ?, ?)",
      [backupFilename, timestamp, sizeStr, count]
    );

    // If Google Drive token is present, perform Google Drive backup sync into folder "/Id34/"
    let googleDriveBackupResult = null;
    let driveSyncError = null;
    if (googleAccessToken) {
      try {
        googleDriveBackupResult = await uploadToGoogleDrive(googleAccessToken, backupFilename, backupPath, useFallback);
      } catch (err: any) {
        console.error("Google Drive sync fails:", err);
        driveSyncError = err?.message || "Google Drive upload failed";
      }
    }

    // Auto-purge if keepCount is loaded
    let purgedInfo = null;
    if (keepCount) {
      const limit = parseInt(keepCount, 10);
      if (!isNaN(limit) && limit >= 1 && limit <= 99) {
        purgedInfo = await purgeOldBackups(limit, googleAccessToken);
      }
    }

    res.json({
      success: true,
      backup: {
        filename: backupFilename,
        timestamp,
        size: sizeStr,
        ideaCount: count,
      },
      driveSynced: !!googleDriveBackupResult,
      driveFileInfo: googleDriveBackupResult,
      driveSyncError,
      purgedInfo
    });
  } catch (err: any) {
    console.error("Cloud snapshot fail:", err);
    res.status(500).json({ error: err?.message || "Snapshot fails" });
  }
});

// Main Serve logic
async function serveApp() {
  // Load sqlite3 dynamically inside startup block to avoid top-level await constraints
  try {
    const sqliteModule = await import("sqlite3");
    sqlite3 = sqliteModule.default || sqliteModule;
    console.log("sqlite3 module retrieved successfully under async startup block.");
  } catch (err) {
    console.warn("sqlite3 native module loader failed. Initializing 100% resilient fallback DB:", err);
    useFallback = true;
  }

  // Try initializing SQLite if loader succeeded
  if (!useFallback && sqlite3) {
    try {
      const sqlite3Verbose = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
      dbInstance = new sqlite3Verbose.Database(DB_FILE, (err: any) => {
        if (err) {
          console.error("SQLite3 database connection failed. Reaching for JSON fallback:", err);
          useFallback = true;
        } else {
          console.log("Connected to SQLite3 Database successfully at", DB_FILE);
          initializeSQLiteSchema();
        }
      });
    } catch (err) {
      console.error("SQLite3 package initialization was interrupted. Reaching for JSON fallback:", err);
      useFallback = true;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully started on port ${PORT}. Active fallback = ${useFallback}`);
  });
}

serveApp();
