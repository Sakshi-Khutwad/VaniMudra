/**
 * S3 Service for SignVision
 * Handles URL construction and word lookup from the sign language data JSON
 */

// Import the sign language data
import signLanguageData from "../data/sign_language_data.json";

// Types
export interface SignData {
  anchors: string[];
  category: string;
  s3_url: string;
  hamnosys?: string;
}

export interface SignLanguageDataMap {
  [word: string]: SignData;
}

export interface SearchResult {
  found: boolean;
  url: string | null;
  word: string;
  originalQuery: string;
  matchType: "exact" | "anchor" | "partial" | "none";
  suggestions?: string[];
}

// Cast imported data to proper type
const signData = signLanguageData as SignLanguageDataMap;

// S3 bucket configuration (fallback if not in JSON)
const S3_CONFIG = {
  bucket: "signvision-data-741452524968-bucket",
  region: "ap-south-1",
  basePath: "sigml-files",
};

/**
 * Normalize a word for lookup
 * - Convert to uppercase (JSON keys are uppercase)
 * - Replace spaces with underscores
 * - Trim whitespace
 */
export function normalizeWord(word: string): string {
  return word.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Normalize word for S3 URL path (lowercase, underscores)
 */
export function normalizeForS3(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Build S3 URL for a word (fallback if not in JSON)
 */
export function buildS3Url(word: string): string {
  const normalized = normalizeForS3(word);
  return `https://${S3_CONFIG.bucket}.s3.${S3_CONFIG.region}.amazonaws.com/${S3_CONFIG.basePath}/${normalized}.sigml`;
}

/**
 * Get all available words from the dataset
 */
export function getAllWords(): string[] {
  return Object.keys(signData);
}

/**
 * Get word count
 */
export function getWordCount(): number {
  return Object.keys(signData).length;
}

/**
 * Look up a word and get its SiGML URL
 */
export function lookupWord(query: string): SearchResult {
  const normalizedQuery = normalizeWord(query);
  const originalQuery = query.trim();

  // 1. Try exact match
  if (signData[normalizedQuery]) {
    const data = signData[normalizedQuery];
    if (data.s3_url && data.s3_url.length > 0) {
      return {
        found: true,
        url: data.s3_url,
        word: normalizedQuery,
        originalQuery,
        matchType: "exact",
      };
    }
  }

  // 2. Try anchor match (synonyms)
  for (const [word, data] of Object.entries(signData)) {
    if (data.anchors && data.anchors.includes(normalizedQuery)) {
      if (data.s3_url && data.s3_url.length > 0) {
        return {
          found: true,
          url: data.s3_url,
          word: word,
          originalQuery,
          matchType: "anchor",
        };
      }
    }
  }

  // 3. Try partial match
  const partialMatches: string[] = [];
  for (const word of Object.keys(signData)) {
    if (word.includes(normalizedQuery) || normalizedQuery.includes(word)) {
      const data = signData[word];
      if (data.s3_url && data.s3_url.length > 0) {
        partialMatches.push(word);
      }
    }
  }

  if (partialMatches.length > 0) {
    const bestMatch = partialMatches[0];
    return {
      found: true,
      url: signData[bestMatch].s3_url,
      word: bestMatch,
      originalQuery,
      matchType: "partial",
      suggestions: partialMatches.slice(1, 5),
    };
  }

  // 4. Not found - provide suggestions
  const suggestions = findSimilarWords(normalizedQuery, 5);

  return {
    found: false,
    url: null,
    word: normalizedQuery,
    originalQuery,
    matchType: "none",
    suggestions,
  };
}

/**
 * Find similar words using simple string distance
 */
export function findSimilarWords(query: string, limit: number = 5): string[] {
  const normalizedQuery = normalizeWord(query);
  const words = Object.keys(signData);

  // Score each word by similarity
  const scored = words
    .filter((word) => signData[word].s3_url && signData[word].s3_url.length > 0)
    .map((word) => ({
      word,
      score: calculateSimilarity(normalizedQuery, word),
    }))
    .filter((item) => item.score > 0.3) // Minimum similarity threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((item) => item.word);
}

/**
 * Calculate string similarity (Dice coefficient)
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length < 2 || str2.length < 2) return 0;

  const bigrams1 = new Set<string>();
  const bigrams2 = new Set<string>();

  for (let i = 0; i < str1.length - 1; i++) {
    bigrams1.add(str1.substring(i, i + 2));
  }
  for (let i = 0; i < str2.length - 1; i++) {
    bigrams2.add(str2.substring(i, i + 2));
  }

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  return (2 * intersection) / (bigrams1.size + bigrams2.size);
}

/**
 * Check if a SiGML URL is accessible via HEAD request
 */
export async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    console.warn("URL check failed:", error);
    return false;
  }
}

/**
 * Search words by category
 */
export function searchByCategory(category: string): string[] {
  return Object.entries(signData)
    .filter(([_, data]) => data.category === category && data.s3_url)
    .map(([word, _]) => word);
}

/**
 * Get all available categories
 */
export function getCategories(): string[] {
  const categories = new Set<string>();
  for (const data of Object.values(signData)) {
    if (data.category) {
      categories.add(data.category);
    }
  }
  return Array.from(categories).sort();
}

/**
 * Search words with autocomplete
 */
export function autocomplete(prefix: string, limit: number = 10): string[] {
  const normalizedPrefix = normalizeWord(prefix);

  if (!normalizedPrefix) return [];

  const matches: string[] = [];

  for (const word of Object.keys(signData)) {
    if (word.startsWith(normalizedPrefix)) {
      const data = signData[word];
      if (data.s3_url && data.s3_url.length > 0) {
        matches.push(word);
        if (matches.length >= limit) break;
      }
    }
  }

  return matches;
}
