import * as vscode from 'vscode';
import { getIndex, formatSessionsAsContext } from './historyTool';
import { rerank } from './lmReranker';

/**
 * Chat participant `@history` — lets users ask questions with automatic
 * context from similar past chat sessions injected into the prompt.
 *
 * Usage in Copilot Chat:
 *   @history how did I set up the deployment pipeline?
 *   @history what was the fix for the auth token issue?
 */
export function registerHistoryParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    'copilotScribe.history',
    historyHandler,
  );

  participant.iconPath = new vscode.ThemeIcon('history');
  context.subscriptions.push(participant);
}

const historyHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> => {
  const query = request.prompt;

  if (!query.trim()) {
    stream.markdown('Please provide a question or topic to search your chat history for.');
    return;
  }

  // 1. Search the index
  stream.progress('Searching past chat sessions...');

  const config = vscode.workspace.getConfiguration('copilotScribe');
  const maxResults = config.get<number>('similarChatsMaxResults', 5);
  const minScore = config.get<number>('similarChatsMinScore', 0.05);

  const index = getIndex();
  // Fetch extra candidates for LM re-ranking
  const tfidfResults = index.findSimilar(query, maxResults * 3, minScore);

  if (tfidfResults.length === 0) {
    stream.markdown('No similar past chat sessions found for your query. Try rephrasing or using different keywords.');
    return;
  }

  // 2. Re-rank with LM for semantic accuracy
  stream.progress(`Found ${tfidfResults.length} candidates, re-ranking for relevance...`);
  const reranked = await rerank(query, tfidfResults, token);
  const topResults = reranked.slice(0, maxResults);

  const matches = topResults.map(r => ({
    id: r.session.id,
    title: r.session.title,
    score: r.lmScore / 10,
    workspacePath: r.session.workspacePath,
  }));

  const pastContext = formatSessionsAsContext(matches);

  stream.progress(`Re-ranked to ${topResults.length} best match(es), generating response...`);

  // 3. Send the user's question + past context to the LM
  const systemPrompt = `You are a helpful assistant with access to the user's past Copilot chat history. Below is context from similar past conversations. Use this context to answer the user's current question. Reference specific past sessions when relevant.

--- PAST CHAT CONTEXT ---
${pastContext}
--- END PAST CONTEXT ---`;

  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt + '\n\nUser question: ' + query),
  ];

  const model = request.model;

  try {
    const response = await model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
  } catch (err) {
    stream.markdown(`Failed to generate response: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Show references to the matched sessions
  for (const match of matches) {
    const title = `Past chat: "${match.title}" (score: ${(match.score * 100).toFixed(0)}%)`;
    if (match.workspacePath) {
      stream.reference(vscode.Uri.file(match.workspacePath));
    }
  }
};
