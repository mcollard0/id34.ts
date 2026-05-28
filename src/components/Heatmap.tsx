import React from "react";
import { HeatmapWord } from "../utils";
import { motion } from "motion/react";
import { Sparkles, TrendingUp } from "lucide-react";

interface HeatmapProps {
  words: HeatmapWord[];
  onWordClick: (wordText: string) => void;
  selectedWord: string | null;
}

export const Heatmap: React.FC<HeatmapProps> = ({
  words,
  onWordClick,
  selectedWord,
}) => {
  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-5 text-slate-400 border border-slate-100">
          <Sparkles className="w-6 h-6 animate-pulse text-indigo-500" />
        </div>
        <h3 className="font-sans text-lg font-medium text-slate-800 mb-2">
          Your Mind Heatmap is Awaiting Ideas
        </h3>
        <p className="font-sans text-sm text-slate-500 max-w-md leading-relaxed">
          Type or dictate a single-line concept below to begin. Our real-time analyser will exclude common stopwords and begin constructing your visual trend cloud automatically.
        </p>
      </div>
    );
  }

  // Heat theme styles helper to render beautiful gradients and micro-scale sizes based on counts
  const getHeatStyles = (heat: number, isSelected: boolean) => {
    if (isSelected) {
      return "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300 ring-offset-1 scale-105 border-transparent";
    }

    switch (heat) {
      case 6: // Highest Volcanic
        return "bg-rose-50 border border-rose-200 text-rose-700 font-bold hover:bg-rose-100 shadow-xs hover:border-rose-300";
      case 5: // High Coral
        return "bg-orange-50 border border-orange-200 text-orange-700 font-semibold hover:bg-orange-100 hover:border-orange-300";
      case 4: // Warm Gold
        return "bg-amber-50 border border-amber-200 text-amber-700 font-medium hover:bg-amber-100 hover:border-amber-300";
      case 3: // Emerald Green
        return "bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-200";
      case 2: // Cyan/Sky
        return "bg-sky-50 border border-sky-100 text-sky-700 hover:bg-sky-100 hover:border-sky-200";
      case 1: // Slate (Base)
      default:
        return "bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100 hover:border-slate-300";
    }
  };

  const getHeatFontSize = (heat: number) => {
    switch (heat) {
      case 6: return "text-xl sm:text-2xl md:text-3xl px-4 py-2.5";
      case 5: return "text-lg sm:text-xl md:text-2xl px-3.5 py-2";
      case 4: return "text-base sm:text-lg md:text-xl px-3 py-1.5";
      case 3: return "text-sm sm:text-base px-2.5 py-1";
      case 2: return "text-xs sm:text-sm px-2.5 py-1";
      case 1:
      default: return "text-xs px-2 py-0.5";
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center space-x-2 mb-6 border-b border-slate-100 pb-3">
        <TrendingUp className="w-4 h-4 text-slate-500" />
        <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-slate-500">
          Interactive Mood & Concept Heatmap ({words.length} distinct trend words)
        </h2>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 py-4 max-w-4xl mx-auto">
        {words.map((word, index) => {
          const isSelected = selectedWord === word.text;
          const styles = getHeatStyles(word.heat, isSelected);
          const fontSize = getHeatFontSize(word.heat);

          return (
            <motion.button
              key={word.text}
              id={`heatmap-tag-${word.text}`}
              onClick={() => onWordClick(word.text)}
              whileHover={{ scale: 1.06, rotate: Math.random() > 0.5 ? 1 : -1 }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 20,
                delay: Math.min(index * 0.015, 0.4),
              }}
              className={`rounded-full shadow-2xs font-sans select-none cursor-pointer transition-colors duration-150 flex items-center space-x-1.5 ${styles} ${fontSize}`}
            >
              <span>{word.text}</span>
              <span className="opacity-60 text-[0.7em] font-mono font-normal">
                ({word.count})
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Colour Bar Legend */}
      <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-100 pt-5 text-xs text-slate-400">
        <div className="flex items-center space-x-1">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
          <span>Click any word above to view & filter matching ideas.</span>
        </div>
        <div className="flex items-center space-x-1 whitespace-nowrap">
          <span>Cold</span>
          <span className="w-4 h-1.5 rounded-xs bg-slate-100"></span>
          <span className="w-4 h-1.5 rounded-xs bg-sky-200"></span>
          <span className="w-4 h-1.5 rounded-xs bg-emerald-200"></span>
          <span className="w-4 h-1.5 rounded-xs bg-amber-200"></span>
          <span className="w-4 h-1.5 rounded-xs bg-orange-200"></span>
          <span className="w-4 h-1.5 rounded-xs bg-rose-300"></span>
          <span>Hot (Volcanic)</span>
        </div>
      </div>
    </div>
  );
};
