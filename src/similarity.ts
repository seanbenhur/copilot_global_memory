import { ChatSession } from './types';

// ─── TF-IDF Similarity Engine ────────────────────────────────────────

/** A pre-computed index entry for a session */
export interface IndexedSession {
  id: string;
  title: string;
  createdAt: string;
  model?: string;
  workspacePath?: string;
  /** Concatenated user message text for matching */
  userText: string;
  /** TF-IDF term frequency map */
  termFreqs: Map<string, number>;
  /** L2 norm of the TF vector (for cosine sim) */
  norm: number;
}

export interface SimilarityResult {
  session: IndexedSession;
  score: number;
}

/**
 * Lightweight TF-IDF index for finding similar chat sessions.
 * Works entirely in-memory with zero external dependencies.
 */
export class SessionIndex {
  private sessions: IndexedSession[] = [];
  /** Document frequency: how many sessions contain each term */
  private docFreqs = new Map<string, number>();

  /**
   * Build the index from a list of chat sessions.
   */
  buildIndex(sessions: ChatSession[]): void {
    this.sessions = [];
    this.docFreqs = new Map();

    // First pass: compute term frequencies per session
    for (const session of sessions) {
      const userText = session.messages
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' ');

      if (!userText.trim()) { continue; }

      const terms = tokenize(userText);
      const termFreqs = new Map<string, number>();

      for (const term of terms) {
        termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
      }

      // Track document frequencies
      for (const term of termFreqs.keys()) {
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      }

      this.sessions.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        model: session.model,
        workspacePath: session.workspacePath,
        userText,
        termFreqs,
        norm: 0, // computed after IDF weights are known
      });
    }

    // Second pass: compute norms using IDF weights
    const N = this.sessions.length;
    for (const entry of this.sessions) {
      let sumSq = 0;
      for (const [term, tf] of entry.termFreqs) {
        const idf = Math.log(1 + N / (this.docFreqs.get(term) || 1));
        const tfidf = tf * idf;
        sumSq += tfidf * tfidf;
      }
      entry.norm = Math.sqrt(sumSq);
    }
  }

  /**
   * Find sessions similar to a query string, ranked by TF-IDF cosine similarity.
   */
  findSimilar(query: string, topK: number = 5, minScore: number = 0.05): SimilarityResult[] {
    if (this.sessions.length === 0) { return []; }

    const queryTerms = tokenize(query);
    const queryTf = new Map<string, number>();
    for (const term of queryTerms) {
      queryTf.set(term, (queryTf.get(term) || 0) + 1);
    }

    // Compute query norm
    const N = this.sessions.length;
    let queryNormSq = 0;
    for (const [term, tf] of queryTf) {
      const idf = Math.log(1 + N / (this.docFreqs.get(term) || 1));
      queryNormSq += (tf * idf) ** 2;
    }
    const queryNorm = Math.sqrt(queryNormSq);

    if (queryNorm === 0) { return []; }

    // Score each session
    const results: SimilarityResult[] = [];

    for (const session of this.sessions) {
      if (session.norm === 0) { continue; }

      let dotProduct = 0;
      for (const [term, qTf] of queryTf) {
        const sTf = session.termFreqs.get(term);
        if (sTf === undefined) { continue; }
        const idf = Math.log(1 + N / (this.docFreqs.get(term) || 1));
        dotProduct += (qTf * idf) * (sTf * idf);
      }

      const score = dotProduct / (queryNorm * session.norm);
      if (score >= minScore) {
        results.push({ session, score });
      }
    }

    // Sort by score descending, return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  get size(): number {
    return this.sessions.length;
  }
}

// ─── Tokenization ────────────────────────────────────────────────────

/** Stop words to filter out */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'but',
  'not', 'or', 'and', 'if', 'then', 'else', 'when', 'up', 'out',
  'so', 'no', 'than', 'too', 'very', 'just', 'that', 'this', 'it',
  'its', 'my', 'me', 'i', 'you', 'your', 'we', 'they', 'them',
  'what', 'which', 'who', 'how', 'all', 'each', 'some', 'any',
]);

/**
 * Tokenize text into normalized terms.
 * Handles camelCase splitting, lowercasing, and stop word removal.
 */
function tokenize(text: string): string[] {
  // Split camelCase and snake_case
  const expanded = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ');

  return expanded
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}
