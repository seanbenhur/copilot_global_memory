import * as vscode from 'vscode';
import { SessionIndex, SimilarityResult } from './similarity';
import { loadAllChatSessions } from './chatStorage';
import { ChatSession } from './types';
import { rerank } from './lmReranker';

// ─── Shared index singleton ─────────────────────────────────────────

let _index: SessionIndex | undefined;
let _sessions: ChatSession[] = [];

/**
 * Get or rebuild the TF-IDF index. Lazily built on first call, then cached.
 * Call `refreshIndex()` to force a rebuild.
 */
export function getIndex(): SessionIndex {
  if (!_index) {
    refreshIndex();
  }
  return _index!;
}

export function refreshIndex(): void {
  _sessions = loadAllChatSessions();
  _index = new SessionIndex();
  _index.buildIndex(_sessions);
}

export function getSessionById(id: string): ChatSession | undefined {
  return _sessions.find(s => s.id === id);
}

// ─── Format helpers ─────────────────────────────────────────────────

/**
 * Format matched sessions into a concise context block that can be
 * injected into an LLM conversation.
 */
export function formatSessionsAsContext(
  sessions: Array<{ id: string; title: string; score: number; workspacePath?: string }>,
  maxCharsPerSession = 3000,
): string {
  const parts: string[] = [];

  for (const match of sessions) {
    const session = getSessionById(match.id);
    if (!session) { continue; }

    let sessionText = `## Past Chat: "${session.title}"`;
    if (session.workspacePath) {
      sessionText += ` (workspace: ${session.workspacePath})`;
    }
    if (session.model) {
      sessionText += ` [model: ${session.model}]`;
    }
    sessionText += `\nDate: ${session.createdAt}\n\n`;

    for (const msg of session.messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content.length > maxCharsPerSession
        ? msg.content.slice(0, maxCharsPerSession) + '\n... (truncated)'
        : msg.content;
      sessionText += `**${role}:** ${content}\n\n`;
    }

    parts.push(sessionText);
  }

  return parts.join('\n---\n\n');
}

// ─── LM Tool: copilotScribe_searchHistory ────────────────────────

interface SearchHistoryInput {
  query: string;
  maxResults?: number;
}

/**
 * A Language Model Tool that Copilot can call automatically in Agent mode.
 * When invoked, it searches past chat sessions and returns relevant context.
 */
export class HistorySearchTool implements vscode.LanguageModelTool<SearchHistoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SearchHistoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { query, maxResults = 5 } = options.input;

    const config = vscode.workspace.getConfiguration('copilotScribe');
    const minScore = config.get<number>('similarChatsMinScore', 0.05);

    const index = getIndex();
    // Fetch extra candidates for re-ranking, then trim to maxResults after
    const tfidfResults = index.findSimilar(query, maxResults * 3, minScore);

    if (tfidfResults.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('No similar past chat sessions found.'),
      ]);
    }

    // Re-rank with LM for semantic accuracy (falls back to TF-IDF if unavailable)
    const reranked = await rerank(query, tfidfResults, _token);
    const topResults = reranked.slice(0, maxResults);

    const matches = topResults.map(r => ({
      id: r.session.id,
      title: r.session.title,
      score: r.lmScore / 10, // normalize 0-10 → 0-1
      workspacePath: r.session.workspacePath,
    }));

    const contextBlock = formatSessionsAsContext(matches);

    const preamble = `Found ${topResults.length} similar past chat session(s). Here is the relevant context from previous conversations:\n\n`;

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(preamble + contextBlock),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SearchHistoryInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Searching past chat history for: "${options.input.query.slice(0, 80)}"...`,
    };
  }
}
