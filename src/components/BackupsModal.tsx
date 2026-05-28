import React, { useState } from "react";
import { CloudBackup } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { X, Cloud, UploadCloud, RefreshCw, Layers, Database, AlertCircle, FileText, Check } from "lucide-react";

interface BackupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  backups: CloudBackup[];
  onTriggerBackup: (googleAccessToken?: string | null, keepCount?: number) => Promise<boolean>;
  onPurgeBackups: (keepCount: number) => Promise<{ success: boolean; message: string; purgedLocalCount: number; purgedDriveCount: number }>;
  refreshBackups: () => void;
  isSyncing: boolean;
  googleAccessToken?: string | null;
}

export const BackupsModal: React.FC<BackupsModalProps> = ({
  isOpen,
  onClose,
  backups,
  onTriggerBackup,
  onPurgeBackups,
  refreshBackups,
  isSyncing,
  googleAccessToken,
}) => {
  const [backingUp, setBackingUp] = useState(false);
  const [purging, setPurging] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const [keepCount, setKeepCount] = useState<number>(() => {
    return parseInt(localStorage.getItem("backups_keep_count") || "10", 10);
  });

  const handleKeepCountChange = (val: number) => {
    setKeepCount(val);
    localStorage.setItem("backups_keep_count", String(val));
    setBackupMessage(`Retention policy updated to keep maximum ${val} snapshots.`);
    setTimeout(() => setBackupMessage(null), 4000);
  };

  const handleCreateBackup = async () => {
    setBackingUp(true);
    setBackupMessage(null);
    try {
      const success = await onTriggerBackup(googleAccessToken, keepCount);
      if (success) {
        setBackupMessage(
          googleAccessToken
            ? `Sync succeeded: Backup uploaded. Enforcing limit (${keepCount}) auto-pruned excess copies!`
            : `SQLite3 snapshot saved locally. Enforcing limit (${keepCount}) auto-pruned excess copies!`
        );
        setTimeout(() => setBackupMessage(null), 6000);
      } else {
        setBackupMessage("Failed to write backup. Check connection or access permissions.");
      }
    } catch (e: any) {
      setBackupMessage(`Backup error: ${e?.message || e}`);
    } finally {
      setBackingUp(false);
    }
  };

  const handlePurgeClick = async () => {
    if (!confirm(`Are you sure you want to purge excess backups? This will delete all local snapshots and connected Google Drive files older than your selected limit (${keepCount}).`)) {
      return;
    }
    setPurging(true);
    setBackupMessage(null);
    try {
      const res = await onPurgeBackups(keepCount);
      if (res.success) {
        setBackupMessage(
          `Purge complete! Deleted ${res.purgedLocalCount} local file(s) and ${res.purgedDriveCount} Google Drive snapshot(s).`
        );
        refreshBackups();
      } else {
        setBackupMessage(`Purge error: ${res.message}`);
      }
    } catch (err: any) {
      setBackupMessage(`Purge failed: ${err?.message || err}`);
    } finally {
      setPurging(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Shadow overlay */}
          <motion.div
            id="backups-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 transition-all"
          />

          {/* Dialog Container */}
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
            <motion.div
              id="backups-modal-card"
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.35 }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]"
            >
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-indigo-700 to-indigo-900 px-6 py-5 text-white flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-white/10">
                    <Cloud className="w-5 h-5 text-indigo-200" />
                  </div>
                  <div>
                    <h3 className="font-sans text-base font-semibold">
                      Google Cloud Files Backup Manager
                    </h3>
                    <p className="text-[11px] text-indigo-200 font-sans mt-0.5">
                      Real-time SQLite database sync & recovery checkpoints
                    </p>
                  </div>
                </div>
                <button
                  id="modal-close-btn"
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status and Actions Panel */}
              <div className="p-5 border-b border-slate-150 bg-slate-50 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2 text-xs text-slate-600 font-sans">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                      <span className="font-semibold text-slate-800">
                        Sync Bridge Live
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 max-w-xs">
                      Automated synchronizer writes to cloud backups instantly on app load, unload & closure.
                    </p>
                  </div>
                  <button
                    id="trigger-snapshot-btn"
                    disabled={backingUp}
                    onClick={handleCreateBackup}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-750 disabled:bg-indigo-400 text-white rounded-xl text-xs font-semibold font-sans flex items-center justify-center space-x-2 shadow-sm transition-all shrink-0 cursor-pointer animate-pulse-slow"
                  >
                    {backingUp ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <UploadCloud className="w-4 h-4" />
                    )}
                    <span>{backingUp ? "Backing up..." : "Backup Snapshot"}</span>
                  </button>
                </div>

                {/* Google Drive Status Banner */}
                <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-sans ${
                  googleAccessToken 
                    ? "bg-emerald-50/70 border-emerald-100 text-emerald-800" 
                    : "bg-amber-50/70 border-amber-150 text-amber-800"
                }`}>
                  <div className="flex items-center space-x-2">
                    <div className={`p-1 rounded-md ${googleAccessToken ? "bg-emerald-500/15" : "bg-amber-500/15"}`}>
                      <Cloud className={`w-4 h-4 ${googleAccessToken ? "text-emerald-600" : "text-amber-600"}`} />
                    </div>
                    <div>
                      <p className="font-semibold">Google Drive Backup Status</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 font-sans leading-relaxed">
                        {googleAccessToken 
                          ? "SSO Linked to Drive. Uploading copies directly to Drive folder /Id34/."
                          : "Google Sign-In active but session token not linked to Drive yet."}
                      </p>
                    </div>
                  </div>
                  {googleAccessToken && (
                    <span className="flex items-center space-x-0.5 text-[10px] uppercase font-bold tracking-wider text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full">
                      <Check className="w-3 h-3 stroke-3" />
                      <span>Active</span>
                    </span>
                  )}
                </div>

                {/* Retention & Purging Controls block */}
                <div className="bg-white rounded-xl border border-slate-150 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <label className="text-xs font-semibold text-slate-700 font-sans block">
                        Backups Retention Policy
                      </label>
                      <span className="text-[10px] text-slate-400 font-sans">
                        Max number of snapshots to keep before discarding older copies.
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <select
                        id="bk-retention-dropdown"
                        value={keepCount}
                        onChange={(e) => handleKeepCountChange(parseInt(e.target.value, 10))}
                        className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 font-semibold font-sans outline-hidden cursor-pointer"
                      >
                        {Array.from({ length: 99 }, (_, j) => j + 1).map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[10px] text-slate-400 font-sans leading-relaxed max-w-[280px]">
                      Manually discard excess local & Google Drive snapshots exceeding your threshold.
                    </span>
                    <button
                      id="purge-backups-btn"
                      disabled={purging || isSyncing}
                      onClick={handlePurgeClick}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 disabled:bg-slate-100 text-rose-600 disabled:text-slate-400 border border-rose-200 disabled:border-slate-150 rounded-lg text-[11px] font-bold font-sans flex items-center space-x-1 cursor-pointer transition-all shrink-0"
                    >
                      {purging ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-rose-500" />
                      )}
                      <span>{purging ? "Purging..." : "Purge Backups"}</span>
                    </button>
                  </div>
                </div>

              </div>

              {/* Main List */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {backupMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-emerald-50 border border-emerald-150 rounded-lg text-emerald-800 text-xs font-sans flex items-center space-x-2"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    <span className="flex-1 font-medium">{backupMessage}</span>
                  </motion.div>
                )}

                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 font-sans flex items-center space-x-1.5">
                    <Database className="w-3.5 h-3.5" />
                    <span>Cloud Backups Registry ({backups.length})</span>
                  </span>
                  <button
                    id="refresh-backups-btn"
                    onClick={refreshBackups}
                    className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold font-sans flex items-center space-x-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {backups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                    <AlertCircle className="w-7 h-7 text-slate-400 stroke-1.5 mb-2" />
                    <p className="font-sans text-xs text-slate-600 font-medium">
                      No backups in Google Cloud Files folder yet.
                    </p>
                    <p className="font-sans text-[11px] text-slate-400 mt-0.5">
                      Click "Backup Snapshot" above to create your very first persistent copy.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {backups.map((bk, i) => (
                      <div
                        key={bk.filename}
                        className="p-3.5 rounded-xl border border-slate-150 bg-white hover:bg-slate-50 transition-colors flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1.5">
                            <FileText className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-mono text-xs text-slate-800 font-semibold truncate max-w-[200px] sm:max-w-xs">
                              {bk.filename}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
                            <span>
                              {new Date(bk.timestamp).toLocaleString()}
                            </span>
                            <span>•</span>
                            <span className="text-slate-600 font-semibold">{bk.ideaCount} ideas</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="inline-block px-2 py-1 text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 rounded-md">
                            {bk.size}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Informational Panel */}
              <div className="p-4 bg-slate-50 border-t border-slate-150 text-[10px] text-slate-400 text-center leading-relaxed font-sans">
                By maintaining standard SQLites, copies are 100% binary consistent. Ready for direct restoration on second device.
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};
