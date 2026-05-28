export interface Idea {
  id: string;
  content: string;
  created_at: string; // ISO String
  updated_at: string; // ISO String
  deleted: number;    // 0 = active, 1 = tombstone for deleted
}

export interface SyncPayload {
  clientId: string;
  ideas: Idea[];
  lastSyncedAt: string;
}

export interface SyncResponse {
  success: boolean;
  ideas: Idea[];
  timestamp: string;
}

export interface CloudBackup {
  filename: string;
  timestamp: string;
  size: string;
  ideaCount: number;
}
