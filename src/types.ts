/** Shared type definitions for chat history data */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  /** Claude thinking/reasoning block content */
  thinking?: string;
  /** Tool calls made during this response turn */
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  /** Human-readable description of what the tool did */
  invocationMessage: string;
  /** Past-tense description of the result */
  pastTenseMessage?: string;
  isComplete: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  model?: string;
  messages: ChatMessage[];
  /** Which workspace this session belongs to */
  workspacePath?: string;
  workspaceHash?: string;
}

export interface ExportConfig {
  outputDir: string;
  format: 'markdown' | 'json' | 'both';
  includeTimestamps: boolean;
  includeThinking: boolean;
  includeToolCalls: boolean;
}
