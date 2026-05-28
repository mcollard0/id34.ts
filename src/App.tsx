import { useState, useEffect, useMemo, FormEvent } from "react";
import { Idea, CloudBackup } from "./types";
import { computeHeatmap, validateIdeaText, extractCleanWords } from "./utils";
import { Heatmap } from "./components/Heatmap";
import { SearchDrawer } from "./components/SearchDrawer";
import { BackupsModal } from "./components/BackupsModal";
import { googleSignIn, googleLogout, initAuth } from "./auth";
import { motion, AnimatePresence } from "motion/react";
import {
  Cloud,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  Plus,
  Moon,
  Database,
  Grid,
  Lightbulb,
  History,
  FileDown,
  ChevronRight,
  LogOut,
  Check,
} from "lucide-react";

export default function App() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [newIdeaText, setNewIdeaText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Idea[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  // Auth States
  const [user, setUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authErr, setAuthErr] = useState<string | null>(null);

  // Status and UI controls
  const [syncStatus, setSyncStatus] = useState<"init" | "synced" | "offline" | "syncing" | "error">("init");
  const [lastSyncTime, setLastSyncTime] = useState<string>("");
  const [showBackups, setShowBackups] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState("");
  const [drawerQuery, setDrawerQuery] = useState("");
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [inputValidationMsg, setInputValidationMsg] = useState<string | null>(null);

  // Quick ClientID generation to identify this device
  const clientId = useMemo(() => {
    let id = localStorage.getItem("ideas_client_id");
    if (!id) {
      id = "device_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("ideas_client_id", id);
    }
    return id;
  }, []);

  // SSO authorized account verification callback
  const runAuthCheck = async (email: string, token: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!res.ok) {
        throw new Error("Local authentication guard service error.");
      }
      const data = await res.json();
      if (data.allowed) {
        setGoogleToken(token);
        setAuthErr(null);
        return true;
      } else {
        setAuthErr(data.error || "Authentication verification check failed.");
        await googleLogout();
        setUser(null);
        setGoogleToken(null);
        return false;
      }
    } catch (e: any) {
      setAuthErr(e?.message || "Verification check failed.");
      await googleLogout();
      setUser(null);
      setGoogleToken(null);
      return false;
    }
  };

  // 1. Initial Load & Recovery
  useEffect(() => {
    // Look for offline cache first
    const offlineCache = localStorage.getItem("captured_ideas");
    if (offlineCache) {
      try {
        const loaded = JSON.parse(offlineCache) as Idea[];
        setIdeas(loaded);
      } catch (e) {
        console.warn("Failed to parse local cached ideas:", e);
      }
    }

    // Subscribe to Google OAuth login lifecycle
    const unsubscribe = initAuth(
      async (currentUser, token) => {
        setUser(currentUser);
        const isAllowed = await runAuthCheck(currentUser.email || "", token);
        if (isAllowed) {
          syncWithServer();
          fetchBackupList();
        }
        setAuthChecking(false);
      },
      () => {
        setUser(null);
        setGoogleToken(null);
        setAuthChecking(false);
      }
    );

    // Auto-sync when online status returns
    const handleOnline = () => {
      if (user && googleToken) syncWithServer();
    };
    window.addEventListener("online", handleOnline);

    return () => {
      unsubscribe();
      window.removeEventListener("online", handleOnline);
    };
  }, [user, googleToken]);

  // 2. Unload & Close Synchronization (Core backing requirement)
  useEffect(() => {
    const handleUnloadAndClose = () => {
      // Load current local ideas directly from storage to ensure we capture the absolute latest state
      const currentCache = localStorage.getItem("captured_ideas");
      if (currentCache) {
        const payload = JSON.stringify({ ideas: JSON.parse(currentCache) });
        // sendBeacon ensures target delivery to cloud SQLite backup server even if tab is terminated instantly
        navigator.sendBeacon("/api/sync", new Blob([payload], { type: "application/json" }));
      }
    };

    window.addEventListener("beforeunload", handleUnloadAndClose);
    window.addEventListener("pagehide", handleUnloadAndClose);

    return () => {
      window.removeEventListener("beforeunload", handleUnloadAndClose);
      window.removeEventListener("pagehide", handleUnloadAndClose);
    };
  }, []);

  // 3. Database backups list
  const fetchBackupList = async () => {
    try {
      const res = await fetch("/api/backups");
      if (res.ok) {
        const data = await res.json();
        setBackups(data);
      }
    } catch (e) {
      console.warn("Could not retrieve cloud backups roster:", e);
    }
  };

  // 4. Synchronizer Engine
  const syncWithServer = async (ideasToSync?: Idea[]) => {
    setSyncStatus("syncing");
    const activeList = ideasToSync || ideas;

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideas: activeList }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.ideas)) {
          // Record reconciled state locally
          setIdeas(data.ideas);
          localStorage.setItem("captured_ideas", JSON.stringify(data.ideas));
          setSyncStatus("synced");
          setLastSyncTime(new Date().toLocaleTimeString());
          return true;
        }
      }
      setSyncStatus("offline");
    } catch (error) {
      console.warn("Synchronizer shifted to offline operational mode:", error);
      setSyncStatus("offline");
    }
    return false;
  };

  // 5. Trigger Single manual/checkpoint backup in Google Cloud Files
  const handleTriggerCloudBackup = async (tokenInput?: string | null): Promise<boolean> => {
    const token = tokenInput || googleToken;
    try {
      // Force instant sync first to guarantee snapshot is 100% current
      await syncWithServer();
      
      const res = await fetch("/api/backup", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleAccessToken: token })
      });
      if (res.ok) {
        await fetchBackupList();
        return true;
      }
    } catch (e) {
      console.error("Failed to run binary backup:", e);
    }
    return false;
  };

  const handleSignIn = async () => {
    setAuthChecking(true);
    setAuthErr(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        await runAuthCheck(res.user.email || "", res.accessToken);
      }
    } catch (e: any) {
      setAuthErr(e?.message || "Sign in flow dismissed or errored.");
      setUser(null);
      setGoogleToken(null);
    } finally {
      setAuthChecking(false);
    }
  };

  const handleSignOut = async () => {
    setAuthChecking(true);
    try {
      await googleLogout();
      setUser(null);
      setGoogleToken(null);
      setAuthErr(null);
    } catch (e: any) {
      console.error("SSO Logout failed:", e);
    } finally {
      setAuthChecking(false);
    }
  };

  // 6. Capture Idea Button Handler
  const handleCaptureIdea = async (e?: FormEvent) => {
    if (e) e.preventDefault();

    const validationError = validateIdeaText(newIdeaText);
    if (validationError) {
      setInputValidationMsg(validationError);
      return;
    }

    const timestamp = new Date().toISOString();
    const newIdea: Idea = {
      id: "idea_" + Math.random().toString(36).substring(2, 15),
      content: newIdeaText.trim(),
      created_at: timestamp,
      updated_at: timestamp,
      deleted: 0,
    };

    // Prepend to current local ideas
    const updatedIdeas = [newIdea, ...ideas];
    setIdeas(updatedIdeas);
    setNewIdeaText("");
    setInputValidationMsg(null);

    // Persist and queue for sync
    localStorage.setItem("captured_ideas", JSON.stringify(updatedIdeas));
    await syncWithServer(updatedIdeas);
  };

  // 7. Edit / Delete Logic (Replicating Database Tombstone actions)
  const handleUpdateIdea = async (id: string, newContent: string): Promise<boolean> => {
    const timestamp = new Date().toISOString();
    const updated = ideas.map((idea) => {
      if (idea.id === id) {
        return { ...idea, content: newContent.trim(), updated_at: timestamp };
      }
      return idea;
    });

    setIdeas(updated);
    localStorage.setItem("captured_ideas", JSON.stringify(updated));
    return await syncWithServer(updated);
  };

  const handleDeleteIdea = async (id: string): Promise<boolean> => {
    // To delete while keeping offline-sync correct, we set soft-delete tombstone
    const timestamp = new Date().toISOString();
    const updated = ideas.map((idea) => {
      if (idea.id === id) {
        return { ...idea, deleted: 1, updated_at: timestamp };
      }
      return idea;
    });

    setIdeas(updated);
    localStorage.setItem("captured_ideas", JSON.stringify(updated));

    // Refilter active views
    const success = await syncWithServer(updated);
    
    // Close drawer if we just deleted the last item in active filters
    const currentDrawerSet = updated.filter(
      (idea) =>
        idea.deleted === 0 &&
        (!selectedWord || extractCleanWords(idea.content).includes(selectedWord))
    );
    if (currentDrawerSet.length === 0) {
      setShowDrawer(false);
    }
    
    return success;
  };

  // Compute Word Heatmap based on active non-deleted ideas
  const heatmapWords = useMemo(() => computeHeatmap(ideas), [ideas]);

  // Handle word selection on Heatmap
  const handleWordClick = (wordText: string) => {
    setSelectedWord(wordText);
    setDrawerTitle(`Ideas featuring "${wordText}"`);
    setDrawerQuery(""); // clear sub filter
    setShowDrawer(true);
  };

  // Filter ideas shown in the sliding drawer
  const drawerFilteredIdeas = useMemo(() => {
    let pool = ideas.filter((idea) => idea.deleted === 0);

    // Apply main selected heatmap word
    if (selectedWord) {
      pool = pool.filter((idea) => {
        const words = extractCleanWords(idea.content);
        return words.includes(selectedWord.toLowerCase());
      });
    }

    // Apply user's custom in-drawer text search filter
    if (drawerQuery.trim()) {
      const q = drawerQuery.toLowerCase();
      pool = pool.filter((idea) => idea.content.toLowerCase().includes(q));
    }

    return pool;
  }, [ideas, selectedWord, drawerQuery]);

  // Live Top Search Handler targeting the SQLite database matching
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const results = await response.json();
          setSearchResults(results);
        } else {
          // Offline fallback query search inside the local ideas map
          const q = searchQuery.toLowerCase();
          const offlineMatch = ideas.filter(
            (i) => i.deleted === 0 && i.content.toLowerCase().includes(q)
          );
          setSearchResults(offlineMatch);
        }
      } catch (e) {
        // Fallback
        const q = searchQuery.toLowerCase();
        const offlineMatch = ideas.filter(
          (i) => i.deleted === 0 && i.content.toLowerCase().includes(q)
        );
        setSearchResults(offlineMatch);
      }
    }, 280); // Debounce to spare API calls

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, ideas]);

  const activeIdeasCount = ideas.filter((i) => i.deleted === 0).length;

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center font-sans">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-xs text-slate-500 font-semibold tracking-wide uppercase">Securing Workspace...</p>
        </div>
      </div>
    );
  }

  if (!user || !googleToken) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-12 select-none">
        <div className="w-full max-w-md bg-white rounded-3xl p-8 border border-slate-150 shadow-2xl flex flex-col space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md animate-pulse">
              <Lightbulb className="w-6 h-6 text-indigo-50" />
            </div>
            <div>
              <h2 className="font-sans text-xl font-bold text-slate-800">
                Idea Backup
              </h2>
              <p className="font-sans text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
                SQLite3 + Offline Sync
              </p>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-xs mt-1">
              Personal, ultra-secure distraction-free capturing system equipped with SQLite Full Text Search and client-side offline storage.
            </p>
          </div>

          {authErr && (
            <div className="p-3.5 bg-rose-50 border border-rose-150 rounded-xl flex items-start space-x-2.5 text-xs text-rose-700 leading-relaxed font-sans animate-shake">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{authErr}</span>
            </div>
          )}

          <div className="flex flex-col space-y-3">
            <button
              id="google-sso-login-btn"
              onClick={handleSignIn}
              className="w-full flex items-center justify-center space-x-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-sans text-sm font-semibold rounded-2xl shadow-sm hover:shadow-md transition-all py-3.5 px-4 cursor-pointer"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span>Sign in with Google SSO</span>
            </button>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-150 flex flex-col space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              <Database className="w-3.5 h-3.5" />
              <span>Google Cloud Sync</span>
            </div>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Log in to sync your encrypted thoughts to a secure SQLite database and optional real-time Google Drive backups.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col antialiased">
      {/* 1. Header Navigation Rail */}
      <header className="fixed top-0 inset-x-0 h-16 bg-white border-b border-slate-150 z-30 px-4 sm:px-6 flex items-center justify-between shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <Lightbulb className="w-5 h-5 text-indigo-100" />
          </div>
          <div>
            <h1 className="font-sans text-sm font-bold text-slate-800 tracking-tight leading-none sm:text-base">
              Idea Backup
            </h1>
            <p className="font-sans text-[10px] text-slate-400 mt-0.5 font-medium">
              SQLite3 + Offline Sync
            </p>
          </div>
        </div>

        {/* Sync Controls & Info */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <div className="hidden lg:flex flex-col text-right pr-1">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              Account Sync
            </span>
            <span className="text-[11px] font-sans text-slate-500 font-medium truncate max-w-[140px]" title={user?.email}>
              {user?.email}
            </span>
          </div>

          <div className="hidden sm:flex flex-col text-right">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              Cloud Files Access
            </span>
            <span className="text-xs font-sans text-slate-600 font-medium">
              {syncStatus === "synced" && `Last backed up: ${lastSyncTime}`}
              {syncStatus === "syncing" && "Synchronizing..."}
              {syncStatus === "offline" && "Offline mode"}
              {syncStatus === "init" && "Connecting..."}
            </span>
          </div>

          {/* Sync Badge */}
          <div
            id="sync-status-badge"
            title={`Database Status: ${syncStatus.toUpperCase()}`}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full text-xs font-sans font-semibold border ${
              syncStatus === "synced"
                ? "bg-emerald-50 border-emerald-150 text-emerald-700"
                : syncStatus === "syncing"
                ? "bg-indigo-50 border-indigo-150 text-indigo-700 animate-pulse"
                : "bg-amber-50 border-amber-150 text-amber-700"
            }`}
          >
            {syncStatus === "synced" ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            ) : syncStatus === "syncing" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="capitalize">{syncStatus === "synced" ? "Synced" : syncStatus}</span>
          </div>

          <button
            id="open-backups-manager"
            onClick={() => setShowBackups(true)}
            title="Google Cloud Files Backups"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 font-sans font-semibold text-xs text-slate-700 rounded-lg hover:bg-slate-200 transition-colors pointer cursor-pointer"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Backups</span>
          </button>

          <button
            id="sso-logout-btn"
            onClick={handleSignOut}
            title="Log Out Session"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container viewport */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-24 pb-36 flex flex-col">
        {/* Top distraction-free retrieval search box */}
        <div className="w-full max-w-xl mx-auto mb-10">
          <div className="relative shadow-xs rounded-2xl bg-white border border-slate-150 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
            <Search className="w-5 h-5 text-slate-400 absolute left-4.5 top-4" />
            <input
              id="global-search-query-bar"
              type="text"
              placeholder="Search via SQLite3 Full Text Search (e.g. goals system)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedWord(null); // clean selected heatmap filter if searching broadly
              }}
              className="w-full pl-12 pr-4 py-3.5 bg-transparent border-none text-slate-800 placeholder-slate-400 text-sm focus:outline-hidden"
            />
            {searchQuery && (
              <button
                id="clear-query-bar-btn"
                onClick={() => setSearchQuery("")}
                className="absolute right-4 top-3.5 text-xs text-slate-400 font-sans hover:text-slate-600 font-medium cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* SQLite Real-time FTS Search Results Dropdown/Box if query typed */}
          {searchQuery && (
            <div className="mt-3 bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto p-2 space-y-1">
              <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                SQLite3 FTS matching elements ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <div className="px-3 py-4 text-xs font-sans text-slate-400 italic">
                  No matching ideas in SQLite database.
                </div>
              ) : (
                searchResults.map((idea) => (
                  <button
                     key={idea.id}
                     id={`fts-search-[${idea.id}]`}
                     onClick={() => {
                       // Retrieve matching group
                       setSelectedWord(null);
                       setDrawerTitle(`Search match: "${searchQuery}"`);
                       setDrawerQuery(searchQuery);
                       setShowDrawer(true);
                     }}
                     className="w-full text-left p-2.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between text-xs text-slate-700 font-sans cursor-pointer border border-transparent hover:border-slate-100"
                  >
                    <span className="truncate pr-4 flex-1">{idea.content}</span>
                    <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Central visual workspace container */}
        <div id="interactive-workspace" className="flex-1 flex flex-col justify-center">
          <div className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-150 shadow-xs">
            {/* Quick Metrics display bar */}
            {activeIdeasCount > 0 && (
              <div className="flex justify-end mb-4">
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-indigo-50 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-600">
                  <Database className="w-3 h-3" />
                  <span>{activeIdeasCount} Active Ideas Cached</span>
                </span>
              </div>
            )}

            {/* Heatmap Visual Tag Cloud */}
            <Heatmap
              words={heatmapWords}
              onWordClick={handleWordClick}
              selectedWord={selectedWord}
            />
          </div>
        </div>
      </main>

      {/* 2. Persistent bottom distraction-free entry box */}
      <footer className="fixed bottom-0 inset-x-0 bg-gradient-to-t from-slate-100 via-slate-50/95 to-transparent pt-10 pb-6 px-4 sm:px-6 z-20">
        <div className="max-w-xl mx-auto">
          <form
            id="idea-capture-form"
            onSubmit={handleCaptureIdea}
            className="flex items-center space-x-2 bg-white rounded-2xl p-2 border border-slate-150 shadow-xl focus-within:ring-2 focus-within:ring-indigo-500/10 focus-within:border-indigo-600 transition-all"
          >
            <input
              id="bottom-idea-input"
              type="text"
              maxLength={512}
              value={newIdeaText}
              onChange={(e) => {
                setNewIdeaText(e.target.value);
                setInputValidationMsg(null);
              }}
              placeholder="Inject a new idea... (up to 512 characters)"
              className="flex-1 px-4 py-3 bg-transparent border-none text-slate-800 placeholder-slate-400 text-sm focus:outline-hidden"
            />

            {/* Micro Character length Counter */}
            <div className="hidden sm:flex flex-col text-right pr-2">
              <span className="font-mono text-[10px] font-semibold text-slate-400 leading-none">
                {512 - newIdeaText.length}
              </span>
              <span className="text-[8px] uppercase font-mono tracking-wider text-slate-300">
                Left
              </span>
            </div>

            <button
              id="btn-idea-capture"
              type="submit"
              disabled={!newIdeaText.trim()}
              title="Capture Idea"
              className="p-3 bg-indigo-600 hover:bg-indigo-770 disabled:bg-slate-100 disabled:text-slate-300 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>

          {/* Entry validation notification bar if error */}
          {inputValidationMsg && (
            <motion.div
              id="capture-validation-alert"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 mx-2 bg-rose-50 border border-rose-150 rounded-lg p-2.5 text-[11px] font-medium font-sans text-rose-600 flex items-center space-x-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              <span>{inputValidationMsg}</span>
            </motion.div>
          )}
        </div>
      </footer>

      {/* Cloud Backups registry dialog popup */}
      <BackupsModal
        isOpen={showBackups}
        onClose={() => setShowBackups(false)}
        backups={backups}
        onTriggerBackup={handleTriggerCloudBackup}
        refreshBackups={fetchBackupList}
        isSyncing={syncStatus === "syncing"}
        googleAccessToken={googleToken}
      />

      {/* Ideas list matching clicked active term slide overlay drawer */}
      <SearchDrawer
        isOpen={showDrawer}
        onClose={() => {
          setShowDrawer(false);
          setSelectedWord(null);
          setDrawerQuery("");
        }}
        title={drawerTitle}
        ideas={drawerFilteredIdeas}
        onUpdateIdea={handleUpdateIdea}
        onDeleteIdea={handleDeleteIdea}
        searchQuery={drawerQuery}
        onSearchQueryChange={setDrawerQuery}
      />
    </div>
  );
}
