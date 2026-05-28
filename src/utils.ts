import { Idea } from "./types";

// Standard set of high-frequency english stopwords to exclude from the visual heatmap
export const STOP_WORDS = new Set([
  "the", "a", "an", "in", "to", "and", "of", "on", "for", "was", "with", "as", 
  "by", "at", "be", "this", "are", "from", "or", "i", "you", "he", "she", 
  "they", "we", "but", "his", "her", "their", "my", "your", "me", "them", 
  "us", "him", "its", "about", "who", "whom", "which", "what", "why", "how", 
  "when", "where", "there", "then", "so", "can", "will", "would", "could", 
  "should", "has", "have", "had", "do", "does", "did", "more", "some", "any", 
  "all", "only", "out", "up", "down", "into", "over", "than", "very", "just", 
  "no", "not", "other", "been", "were", "our", "is", "that", "it"
]);

/**
 * Extracts words from text content, filters out stopwords and non-alphabetic elements,
 * and compiles normalized lowercase tokens.
 */
export function extractCleanWords(content: string): string[] {
  if (!content) return [];
  // Clean punctuation, keep alphabetic word structures
  const clean = content.toLowerCase().replace(/[^a-z0-9'\s]/g, " ");
  return clean
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => {
      // Keep words larger than 1 letter and ensure they are not stop words
      return word.length > 1 && !STOP_WORDS.has(word) && /^[a-z0-9]/.test(word);
    });
}

/**
 * Calculates word counts and assigns heat value levels (1 - 6) for word heatmap visualization.
 */
export interface HeatmapWord {
  text: string;
  count: number;
  heat: number; // 1 to 6 scale
}

export function computeHeatmap(ideas: Idea[]): HeatmapWord[] {
  const frequencies: Record<string, number> = {};
  
  // Feed only active, non-deleted ideas
  ideas
    .filter((idea) => idea.deleted === 0)
    .forEach((idea) => {
      const words = extractCleanWords(idea.content);
      words.forEach((w) => {
        frequencies[w] = (frequencies[w] || 0) + 1;
      });
    });

  const rawList = Object.entries(frequencies).map(([text, count]) => ({
    text,
    count,
  }));

  if (rawList.length === 0) return [];

  // Sort by count descending to find boundaries
  rawList.sort((a, b) => b.count - a.count);

  const maxCount = rawList[0].count;
  const minCount = rawList[rawList.length - 1].count;
  const range = maxCount - minCount;

  // Distribute words to 1-6 heats logarithmically or linearly
  return rawList.map((item) => {
    let heat = 1;
    if (range > 0) {
      // Linear scale with log boost for beautiful visual distribution
      const ratio = (item.count - minCount) / range;
      heat = Math.min(6, Math.max(1, Math.round(1 + ratio * 5)));
    }
    return {
      ...item,
      heat,
    };
  });
}

/**
 * Validates single-line ideas. Must match restriction: <= 512 char size limit.
 */
export function validateIdeaText(text: string): string | null {
  if (!text.trim()) return "Idea content cannot be blank.";
  if (text.length > 512) return "Idea length exceeds strict 512-character constraint.";
  if (text.includes("\n")) return "Idea must be a single line without manual line breaks.";
  return null;
}
