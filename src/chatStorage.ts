import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ChatSession, ChatMessage, ToolCallInfo } from './types';

// ─── Workspace Storage Discovery ─────────────────────────────────────

/**
 * Get the base workspaceStorage directory for the current OS and VS Code variant.
 */
export function getWorkspaceStorageDirs(): string[] {
  const homeDir = os.homedir();
  const candidates: string[] = [];

  switch (process.platform) {
    case 'darwin':
      candidates.push(
        path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
        path.join(homeDir, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage')
      );
      break;
    case 'linux':
      candidates.push(
        path.join(homeDir, '.config', 'Code', 'User', 'workspaceStorage'),
        path.join(homeDir, '.config', 'Code - Insiders', 'User', 'workspaceStorage')
      );
      break;
    case 'win32': {
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      candidates.push(
        path.join(appData, 'Code', 'User', 'workspaceStorage'),
        path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage')
      );
      break;
    }
  }

  return candidates.filter(d => fs.existsSync(d));
}

/**
 * Read the workspace.json in a workspace hash directory to get the original folder path.
 */
function readWorkspacePath(wsHashDir: string): string | undefined {
  const wsJson = path.join(wsHashDir, 'workspace.json');
  if (!fs.existsSync(wsJson)) { return undefined; }
  try {
    const data = JSON.parse(fs.readFileSync(wsJson, 'utf-8'));
    const folder = data.folder || data.workspace || '';
    if (typeof folder === 'string' && folder.startsWith('file://')) {
      return decodeURIComponent(folder.replace('file://', ''));
    }
    return folder || undefined;
  } catch {
    return undefined;
  }
}

// ─── JSONL Incremental Format Parser ─────────────────────────────────

interface RawSession {
  sessionId: string;
  creationDate: number;
  customTitle?: string;
  model?: string;
  requests: RawRequest[];
}

interface RawRequest {
  requestId: string;
  timestamp: number;
  message?: { text: string; parts?: unknown[] };
  response: RawResponsePart[];
  result?: Record<string, unknown>;
}

interface RawResponsePart {
  kind?: string;
  value?: string;
  invocationMessage?: { value: string };
  pastTenseMessage?: { value: string };
  isComplete?: boolean;
  id?: string;
  generatedTitle?: string;
  [key: string]: unknown;
}

/**
 * Parse a JSONL chat session file into a RawSession using the incremental format.
 *
 * Format:
 *   kind=0: Full initial state
 *   kind=1: Set value at path (k=[...path])
 *   kind=2: Push value to array at path (k=[...path])
 */
function parseJsonlFile(filePath: string): RawSession | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length === 0) { return null; }

  let session: Record<string, unknown> | null = null;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const kind = obj.kind as number;

    if (kind === 0) {
      // Initial full state
      session = obj.v as Record<string, unknown>;
    } else if (kind === 1 && session) {
      // Set value at path
      const keyPath = obj.k as (string | number)[];
      const value = obj.v;
      setAtPath(session, keyPath, value);
    } else if (kind === 2 && session) {
      // Push value(s) to array at path
      const keyPath = obj.k as (string | number)[];
      const values = obj.v as unknown[];
      pushAtPath(session, keyPath, values);
    }
  }

  if (!session) { return null; }

  // Build typed structure
  const raw: RawSession = {
    sessionId: (session.sessionId as string) || path.basename(filePath, '.jsonl'),
    creationDate: (session.creationDate as number) || 0,
    customTitle: session.customTitle as string | undefined,
    model: extractModel(session),
    requests: [],
  };

  // Build requests array
  const requests = session.requests as Record<string, unknown>[] | undefined;
  if (Array.isArray(requests)) {
    for (const req of requests) {
      const rawReq: RawRequest = {
        requestId: (req.requestId as string) || '',
        timestamp: (req.timestamp as number) || 0,
        message: req.message as RawRequest['message'],
        response: Array.isArray(req.response) ? req.response as RawResponsePart[] : [],
        result: req.result as Record<string, unknown> | undefined,
      };
      raw.requests.push(rawReq);
    }
  }

  return raw;
}

/**
 * Parse a legacy JSON chat session file (older VS Code format).
 */
function parseJsonFile(filePath: string): RawSession | null {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      sessionId: data.sessionId || path.basename(filePath, '.json'),
      creationDate: data.creationDate || 0,
      customTitle: data.customTitle,
      model: extractModel(data),
      requests: Array.isArray(data.requests) ? data.requests.map((req: Record<string, unknown>) => ({
        requestId: (req.requestId as string) || '',
        timestamp: (req.timestamp as number) || 0,
        message: req.message as RawRequest['message'],
        response: Array.isArray(req.response) ? req.response as RawResponsePart[] : [],
        result: req.result as Record<string, unknown> | undefined,
      })) : [],
    };
  } catch {
    return null;
  }
}

function extractModel(session: Record<string, unknown>): string | undefined {
  const inputState = session.inputState as Record<string, unknown> | undefined;
  if (!inputState) { return undefined; }
  const selectedModel = inputState.selectedModel as Record<string, unknown> | undefined;
  if (!selectedModel) { return undefined; }
  return (selectedModel.identifier as string) || undefined;
}

// ─── Path manipulation helpers ───────────────────────────────────────

function setAtPath(obj: Record<string, unknown>, keyPath: (string | number)[], value: unknown): void {
  let current: unknown = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (current === null || current === undefined || typeof current !== 'object') { return; }
    if (Array.isArray(current)) {
      current = current[key as number];
    } else {
      current = (current as Record<string, unknown>)[key as string];
    }
  }

  const lastKey = keyPath[keyPath.length - 1];
  if (current === null || current === undefined || typeof current !== 'object') { return; }

  if (Array.isArray(current)) {
    current[lastKey as number] = value;
  } else {
    (current as Record<string, unknown>)[lastKey as string] = value;
  }
}

function pushAtPath(obj: Record<string, unknown>, keyPath: (string | number)[], values: unknown[]): void {
  let current: unknown = obj;
  for (const key of keyPath) {
    if (current === null || current === undefined || typeof current !== 'object') { return; }
    if (Array.isArray(current)) {
      current = current[key as number];
    } else {
      current = (current as Record<string, unknown>)[key as string];
    }
  }

  if (Array.isArray(current) && Array.isArray(values)) {
    current.push(...values);
  }
}

// ─── RawSession → ChatSession conversion ─────────────────────────────

function rawToSession(raw: RawSession, workspacePath?: string, workspaceHash?: string): ChatSession | null {
  const messages: ChatMessage[] = [];

  for (const req of raw.requests) {
    // User message
    const userText = req.message?.text;
    if (userText) {
      messages.push({
        role: 'user',
        content: userText,
        timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined,
      });
    }

    // Assistant response — collect text, thinking blocks, and tool calls
    let responseText = '';
    let thinkingText = '';
    const toolCalls: ToolCallInfo[] = [];

    for (const part of req.response) {
      if (!part || typeof part !== 'object') { continue; }

      if (part.kind === 'thinking') {
        // Claude thinking/reasoning block
        if (typeof part.value === 'string') {
          thinkingText += (thinkingText ? '\n\n' : '') + part.value;
        }
      } else if (part.kind === 'toolInvocationSerialized') {
        // Tool call
        const invMsg = (part.invocationMessage as Record<string, unknown>)?.value;
        const pastMsg = (part.pastTenseMessage as Record<string, unknown>)?.value;
        toolCalls.push({
          invocationMessage: typeof invMsg === 'string' ? invMsg : 'Tool call',
          pastTenseMessage: typeof pastMsg === 'string' ? pastMsg : undefined,
          isComplete: part.isComplete === true,
        });
      } else if (!part.kind || part.kind === 'markdownContent') {
        // Plain text response part
        if (typeof part.value === 'string') {
          responseText += part.value;
        }
      }
    }

    if (responseText || thinkingText || toolCalls.length > 0) {
      const msg: ChatMessage = {
        role: 'assistant',
        content: responseText,
        timestamp: req.result
          ? extractCompletedTimestamp(req.result)
          : undefined,
      };
      if (thinkingText) { msg.thinking = thinkingText; }
      if (toolCalls.length > 0) { msg.toolCalls = toolCalls; }
      messages.push(msg);
    }
  }

  if (messages.length === 0) { return null; }

  // Derive title
  let title = raw.customTitle || '';
  if (!title) {
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) {
      title = firstUser.content.slice(0, 80);
      if (firstUser.content.length > 80) { title += '...'; }
    }
  }

  return {
    id: raw.sessionId,
    title,
    createdAt: raw.creationDate ? new Date(raw.creationDate).toISOString() : new Date().toISOString(),
    model: raw.model,
    messages,
    workspacePath,
    workspaceHash,
  };
}

function extractCompletedTimestamp(result: Record<string, unknown>): string | undefined {
  const completedAt = result.completedAt as number | undefined;
  if (completedAt) { return new Date(completedAt).toISOString(); }
  const timings = result.timings as Record<string, unknown> | undefined;
  if (timings?.totalElapsed) { return undefined; }
  return undefined;
}

// ─── Content hashing for deduplication ───────────────────────────────

/**
 * Generate a content hash for a session to detect changes.
 */
export function contentHash(session: ChatSession): string {
  const content = session.messages
    .map(m => `${m.role}:${m.content}`)
    .join('\n');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Scan ALL workspace storage directories globally and parse every chat session file.
 * Returns chat sessions from all workspaces, sorted newest-first.
 */
export function loadAllChatSessions(): ChatSession[] {
  const storageDirs = getWorkspaceStorageDirs();
  const sessions: ChatSession[] = [];

  for (const storageDir of storageDirs) {
    let wsHashes: string[];
    try {
      wsHashes = fs.readdirSync(storageDir);
    } catch {
      continue;
    }

    for (const wsHash of wsHashes) {
      const wsDir = path.join(storageDir, wsHash);
      const chatDir = path.join(wsDir, 'chatSessions');

      if (!fs.existsSync(chatDir) || !fs.statSync(chatDir).isDirectory()) {
        continue;
      }

      const workspacePath = readWorkspacePath(wsDir);

      let files: string[];
      try {
        files = fs.readdirSync(chatDir);
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = path.join(chatDir, file);

        let raw: RawSession | null = null;
        if (file.endsWith('.jsonl')) {
          raw = parseJsonlFile(filePath);
        } else if (file.endsWith('.json')) {
          raw = parseJsonFile(filePath);
        }

        if (!raw) { continue; }

        const session = rawToSession(raw, workspacePath, wsHash);
        if (session && session.messages.length > 0) {
          sessions.push(session);
        }
      }
    }
  }

  // Sort newest first
  sessions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return sessions;
}
