import * as vscode from 'vscode';
import { SimilarityResult } from './similarity';

export interface RerankedResult {
  session: SimilarityResult['session'];
  /** Original TF-IDF score */
  tfidfScore: number;
  /** LM-assigned relevance (0-10) */
  lmScore: number;
  /** Brief explanation from the LM */
  reason: string;
}

/**
 * Re-rank TF-IDF candidates using the VS Code Language Model API.
 * Falls back gracefully to original TF-IDF ranking if no model is available.
 */
export async function rerank(
  query: string,
  candidates: SimilarityResult[],
  token?: vscode.CancellationToken,
): Promise<RerankedResult[]> {
  if (candidates.length === 0) { return []; }

  // Try to get a language model
  const models = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    family: 'gpt-4o-mini',
  });

  if (models.length === 0) {
    // Fall back: return candidates with TF-IDF scores only
    return candidates.map(c => ({
      session: c.session,
      tfidfScore: c.score,
      lmScore: c.score * 10,
      reason: 'LM unavailable – ranked by keyword similarity',
    }));
  }

  const model = models[0];

  // Build a compact prompt with candidate summaries
  const candidateSummaries = candidates.map((c, i) => {
    // Truncate user text to keep prompt small
    const preview = c.session.userText.slice(0, 300).replace(/\n/g, ' ');
    return `[${i}] Title: "${c.session.title}" | Preview: "${preview}"`;
  }).join('\n');

  const systemPrompt = `You are a relevance judge. Given a user query and a list of past chat session summaries, rate each session's relevance to the query on a scale of 0-10 and give a very brief reason (5 words max).

Respond ONLY with valid JSON: an array of objects like [{"index": 0, "score": 7, "reason": "same topic"}]. No other text.`;

  const userPrompt = `Query: "${query.slice(0, 500)}"

Past sessions:
${candidateSummaries}`;

  try {
    const messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt + '\n\n' + userPrompt),
    ];

    const response = await model.sendRequest(messages, {}, token ?? new vscode.CancellationTokenSource().token);

    // Collect response text
    let responseText = '';
    for await (const chunk of response.text) {
      responseText += chunk;
    }

    // Parse JSON response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array in LM response');
    }

    const ratings: Array<{ index: number; score: number; reason: string }> = JSON.parse(jsonMatch[0]);

    // Merge LM scores with candidates
    const reranked: RerankedResult[] = candidates.map((c, i) => {
      const rating = ratings.find(r => r.index === i);
      return {
        session: c.session,
        tfidfScore: c.score,
        lmScore: rating?.score ?? c.score * 10,
        reason: rating?.reason ?? 'not rated',
      };
    });

    // Sort by LM score descending
    reranked.sort((a, b) => b.lmScore - a.lmScore);
    return reranked;
  } catch {
    // On any failure, fall back to TF-IDF order
    return candidates.map(c => ({
      session: c.session,
      tfidfScore: c.score,
      lmScore: c.score * 10,
      reason: 'LM re-rank failed – using keyword match',
    }));
  }
}
