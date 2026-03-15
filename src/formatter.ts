import * as fs from 'fs';
import * as path from 'path';
import { ChatSession, ExportConfig } from './types';
import { contentHash } from './chatStorage';

// ─── Hash tracking for deduplication ─────────────────────────────────

const HASH_FILE = '.content-hashes.json';

function loadHashes(outputDir: string): Record<string, string> {
  const hashPath = path.join(outputDir, HASH_FILE);
  if (fs.existsSync(hashPath)) {
    try {
      return JSON.parse(fs.readFileSync(hashPath, 'utf-8'));
    } catch { /* corrupted, start fresh */ }
  }
  return {};
}

function saveHashes(outputDir: string, hashes: Record<string, string>): void {
  fs.writeFileSync(path.join(outputDir, HASH_FILE), JSON.stringify(hashes, null, 2), 'utf-8');
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Export chat sessions with content-hash deduplication.
 * Only writes files for sessions that have changed since last export.
 */
export function exportSessions(
  sessions: ChatSession[],
  config: ExportConfig
): { outputFiles: string[]; newCount: number; skippedCount: number } {
  fs.mkdirSync(config.outputDir, { recursive: true });

  const oldHashes = loadHashes(config.outputDir);
  const newHashes: Record<string, string> = {};
  const outputFiles: string[] = [];
  let newCount = 0;
  let skippedCount = 0;

  // Per-session markdown files (always, for individual browsing)
  for (const session of sessions) {
    const hash = contentHash(session);
    newHashes[session.id] = hash;

    if (oldHashes[session.id] === hash) {
      skippedCount++;
      continue;
    }

    newCount++;
    const filePath = exportSessionAsMarkdown(session, config);
    outputFiles.push(filePath);
  }

  // Combined files
  if (config.format === 'json' || config.format === 'both') {
    const jsonPath = exportAsJson(sessions, config);
    outputFiles.push(jsonPath);
  }

  if (config.format === 'markdown' || config.format === 'both') {
    const mdPath = exportAsCombinedMarkdown(sessions, config);
    outputFiles.push(mdPath);
  }

  saveHashes(config.outputDir, newHashes);

  return { outputFiles, newCount, skippedCount };
}

/**
 * Export a single session to its own Markdown file.
 */
export function exportSessionAsMarkdown(session: ChatSession, config: ExportConfig): string {
  fs.mkdirSync(config.outputDir, { recursive: true });

  const hash = contentHash(session);
  const sanitizedTitle = sanitizeFilename(session.title || session.id);
  const filename = `${formatDateForFilename(session.createdAt)}_${sanitizedTitle}_${hash}.md`;
  const filePath = path.join(config.outputDir, filename);

  const content = formatSessionMarkdown(session, config);
  fs.writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

// ─── JSON export ─────────────────────────────────────────────────────

function exportAsJson(sessions: ChatSession[], config: ExportConfig): string {
  const timestamp = formatDateForFilename(new Date().toISOString());
  const filePath = path.join(config.outputDir, `chat_history_${timestamp}.json`);

  const data = {
    exportedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    sessions: sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      model: s.model,
      workspace: s.workspacePath,
      messageCount: s.messages.length,
      messages: s.messages,
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

// ─── Combined markdown export ────────────────────────────────────────

function exportAsCombinedMarkdown(sessions: ChatSession[], config: ExportConfig): string {
  const timestamp = formatDateForFilename(new Date().toISOString());
  const filePath = path.join(config.outputDir, `chat_history_${timestamp}.md`);

  const parts: string[] = [
    `# Copilot Chat History (All Workspaces)`,
    ``,
    `> Exported on ${new Date().toLocaleString()}`,
    `> ${sessions.length} session(s) across all workspaces`,
    ``,
    `---`,
    ``,
  ];

  // Group by workspace
  const byWorkspace = new Map<string, ChatSession[]>();
  for (const s of sessions) {
    const ws = s.workspacePath || 'Unknown Workspace';
    if (!byWorkspace.has(ws)) { byWorkspace.set(ws, []); }
    byWorkspace.get(ws)!.push(s);
  }

  // Table of contents
  parts.push(`## Table of Contents\n`);
  let idx = 1;
  for (const [ws, wsSessions] of byWorkspace) {
    const wsName = path.basename(ws);
    parts.push(`### ${wsName}`);
    for (const s of wsSessions) {
      const date = new Date(s.createdAt).toLocaleDateString();
      const model = s.model ? ` [${s.model}]` : '';
      parts.push(`${idx}. [${s.title}](#session-${idx}) — ${date}${model} (${s.messages.length} messages)`);
      idx++;
    }
    parts.push('');
  }
  parts.push('---', '');

  // Session content
  idx = 1;
  for (const [, wsSessions] of byWorkspace) {
    for (const session of wsSessions) {
      parts.push(`<a id="session-${idx}"></a>\n`);
      parts.push(formatSessionMarkdown(session, config));
      parts.push('', '---', '');
      idx++;
    }
  }

  fs.writeFileSync(filePath, parts.join('\n'), 'utf-8');
  return filePath;
}

// ─── Session formatting ──────────────────────────────────────────────

function formatSessionMarkdown(session: ChatSession, config: ExportConfig): string {
  const lines: string[] = [];
  const date = new Date(session.createdAt).toLocaleString();

  lines.push(`## ${session.title}`);

  const meta: string[] = [`*Created: ${date}*`];
  if (session.model) { meta.push(`*Model: ${session.model}*`); }
  if (session.workspacePath) { meta.push(`*Workspace: ${path.basename(session.workspacePath)}*`); }
  lines.push(meta.join(' | '));
  lines.push('');

  for (const msg of session.messages) {
    const prefix = msg.role === 'user'
      ? '### 🧑 You'
      : msg.role === 'assistant'
        ? '### 🤖 Copilot'
        : '### ⚙️ System';

    if (config.includeTimestamps && msg.timestamp) {
      const ts = new Date(msg.timestamp).toLocaleTimeString();
      lines.push(`${prefix} *(${ts})*`);
    } else {
      lines.push(prefix);
    }
    lines.push('');

    // Thinking block (collapsible)
    if (config.includeThinking && msg.thinking) {
      lines.push('<details>');
      lines.push('<summary>💭 Thinking</summary>');
      lines.push('');
      lines.push(msg.thinking);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    // Tool calls
    if (config.includeToolCalls && msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        const status = tc.isComplete ? '✅' : '⏳';
        const desc = tc.pastTenseMessage || tc.invocationMessage;
        lines.push(`> ${status} ${desc}`);
      }
      lines.push('');
    }

    // Main content
    if (msg.content) {
      lines.push(msg.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function formatDateForFilename(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toISOString().slice(0, 19).replace(/[T:]/g, '-');
}
