import React, { useState, useEffect } from "react";
import { Idea } from "../types";
import { validateIdeaText } from "../utils";
import { motion, AnimatePresence } from "motion/react";
import { X, Trash2, Edit2, Check, ArrowLeft, Lightbulb, Search, Save } from "lucide-react";

interface SearchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  ideas: Idea[];
  onUpdateIdea: (id: string, newContent: string) => Promise<boolean>;
  onDeleteIdea: (id: string) => Promise<boolean>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export const SearchDrawer: React.FC<SearchDrawerProps> = ({
  isOpen,
  onClose,
  title,
  ideas,
  onUpdateIdea,
  onDeleteIdea,
  searchQuery,
  onSearchQueryChange,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  // Clear editing states on close
  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setErrorText(null);
    }
  }, [isOpen]);

  const startEdit = (idea: Idea) => {
    setEditingId(idea.id);
    setEditValue(idea.content);
    setErrorText(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setErrorText(null);
  };

  const submitEdit = async (id: string) => {
    const error = validateIdeaText(editValue);
    if (error) {
      setErrorText(error);
      return;
    }

    const success = await onUpdateIdea(id, editValue);
    if (success) {
      setEditingId(null);
      setErrorText(null);
    } else {
      setErrorText("Database sync failed. Will retry when connected.");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Shadow overlay */}
          <motion.div
            id="search-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900 z-40 transition-opacity"
          />

          {/* Drawer Content Panel */}
          <motion.div
            id="search-drawer-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed inset-y-0 right-0 max-w-lg w-full bg-white shadow-2xl z-50 flex flex-col h-full border-l border-slate-100"
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2.5">
                <button
                  id="drawer-back-btn"
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 cursor-pointer hidden sm:inline-flex"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h3 className="font-sans text-base font-semibold text-slate-800 leading-tight">
                    {title}
                  </h3>
                  <p className="font-mono text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">
                    {ideas.length} results matching filter
                  </p>
                </div>
              </div>
              <button
                id="drawer-close-btn"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-slate-200 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Live Filter Search */}
            <div className="p-4 bg-slate-50/50 border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="drawer-search-input"
                  type="text"
                  placeholder="Refine search within this group..."
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white rounded-lg border border-slate-200 text-sm focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
                {searchQuery && (
                  <button
                    id="drawer-clear-search-btn"
                    onClick={() => onSearchQueryChange("")}
                    className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-sans cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Ideas List Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/20">
              {ideas.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400 px-6">
                  <Lightbulb className="w-10 h-10 stroke-1.25 text-slate-300 mb-3" />
                  <p className="font-sans text-sm font-medium">No active ideas found.</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">
                    Try adjusting your search criteria or write a new idea below.
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {ideas.map((idea) => {
                    const isEditing = editingId === idea.id;
                    const charCountLeft = 512 - editValue.length;

                    return (
                      <motion.div
                        key={idea.id}
                        id={`idea-row-${idea.id}`}
                        layout
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className={`p-4 rounded-xl border transition-all ${
                          isEditing
                            ? "bg-slate-50 border-indigo-200 shadow-xs"
                            : "bg-white border-slate-150 hover:border-slate-300 hover:shadow-xs"
                        }`}
                      >
                        {isEditing ? (
                          // Edit Mode Template
                          <div className="space-y-3">
                            <div>
                              <textarea
                                id={`edit-textarea-${idea.id}`}
                                rows={3}
                                maxLength={512}
                                value={editValue}
                                onChange={(e) => {
                                  setEditValue(e.target.value);
                                  setErrorText(null);
                                }}
                                className="w-full p-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-sans text-slate-800 resize-none leading-relaxed"
                              />
                              <div className="flex justify-between items-center mt-1 text-[11px]">
                                {errorText ? (
                                  <span className="text-red-500 font-medium">{errorText}</span>
                                ) : (
                                  <span className="text-slate-400">
                                    Capture ideas as single line summaries
                                  </span>
                                )}
                                <span
                                  className={`font-mono ${
                                    charCountLeft < 50
                                      ? "text-rose-500 font-semibold"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {charCountLeft} chars remaining
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-end space-x-2 pt-1">
                              <button
                                id={`cancel-edit-${idea.id}`}
                                onClick={cancelEdit}
                                className="px-3 py-1.5 text-xs font-sans text-slate-500 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                id={`save-edit-${idea.id}`}
                                onClick={() => submitEdit(idea.id)}
                                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold rounded-md shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>Save Changes</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          // Normal View Template
                          <div className="flex items-start justify-between space-x-3">
                            <div className="flex-1 space-y-1.5">
                              <p className="font-sans text-sm text-slate-800 leading-relaxed break-words whitespace-pre-wrap">
                                {idea.content}
                              </p>
                              <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
                                <span>
                                  Captured {new Date(idea.created_at).toLocaleDateString()}
                                </span>
                                {idea.updated_at !== idea.created_at && (
                                  <>
                                    <span className="text-slate-300">•</span>
                                    <span className="text-indigo-400 font-medium">Edited</span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Options */}
                            <div className="flex items-center space-x-1 shrink-0 self-start">
                              <button
                                id={`btn-edit-${idea.id}`}
                                onClick={() => startEdit(idea)}
                                title="Edit Idea"
                                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                id={`btn-delete-${idea.id}`}
                                onClick={() => onDeleteIdea(idea.id)}
                                title="Delete Idea"
                                className="p-1.5 rounded-full hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>

            {/* Micro disclaimer footer */}
            <div className="p-3 border-t border-slate-150 bg-slate-50 text-[10px] text-center text-slate-400 font-mono">
              SECURE SQLITE3 FULL TEXT INDEXING ENABLED
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
