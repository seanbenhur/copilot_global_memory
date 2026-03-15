import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { loadAllChatSessions } from './chatStorage';
import { exportSessions, exportSessionAsMarkdown } from './formatter';
import { ExportConfig } from './types';
import { ChatWatcher } from './chatWatcher';
import { HistorySearchTool, refreshIndex } from './historyTool';
import { registerHistoryParticipant } from './historyParticipant';

let autoSaveTimer: ReturnType<typeof setInterval> | undefined;
let statusBarItem: vscode.StatusBarItem;
let chatWatcher: ChatWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'copilotChatSaver.exportAll';
  statusBarItem.text = '$(history) Chat Saver';
  statusBarItem.tooltip = 'Click to export Copilot chat history (all workspaces)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotChatSaver.exportAll', () => exportAllHistory()),
    vscode.commands.registerCommand('copilotChatSaver.exportLatest', () => exportLatestSession()),
    vscode.commands.registerCommand('copilotChatSaver.toggleAutoSave', () => toggleAutoSave()),
    vscode.commands.registerCommand('copilotChatSaver.openOutputDir', () => openOutputDir()),
    vscode.commands.registerCommand('copilotChatSaver.refreshIndex', () => {
      refreshIndex();
      vscode.window.showInformationMessage('Chat history index refreshed.');
    }),
  );

  // Register the LM tool — Copilot Agent mode can call this automatically
  context.subscriptions.push(
    vscode.lm.registerTool('copilotChatSaver_searchHistory', new HistorySearchTool()),
  );

  // Register the @history chat participant
  registerHistoryParticipant(context);

  // Build the initial TF-IDF index
  refreshIndex();

  // Start the FS watcher to auto-refresh the index when new sessions appear
  const enableSimilar = vscode.workspace.getConfiguration('copilotChatSaver')
    .get<boolean>('enableSimilarChats', true);
  if (enableSimilar) {
    chatWatcher = new ChatWatcher();
    chatWatcher.start();
    context.subscriptions.push(chatWatcher);
  }

  // Start auto-save if configured
  const interval = getAutoSaveInterval();
  if (interval > 0) {
    startAutoSave(interval);
  }

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('copilotChatSaver.autoSaveIntervalMinutes')) {
        const newInterval = getAutoSaveInterval();
        stopAutoSave();
        if (newInterval > 0) {
          startAutoSave(newInterval);
        }
      }
    })
  );

  vscode.window.showInformationMessage('Copilot Chat Saver is active — global history across all workspaces.');
}

export function deactivate() {
  stopAutoSave();
  chatWatcher?.dispose();
  chatWatcher = undefined;
}

// ─── Commands ────────────────────────────────────────────────────────

async function exportAllHistory() {
  try {
    statusBarItem.text = '$(sync~spin) Scanning...';

    const config = getExportConfig();
    const sessions = loadAllChatSessions();

    if (sessions.length === 0) {
      vscode.window.showWarningMessage('No chat history found in any workspace.');
      statusBarItem.text = '$(history) Chat Saver';
      return;
    }

    statusBarItem.text = `$(sync~spin) Exporting ${sessions.length}...`;
    const { outputFiles, newCount, skippedCount } = exportSessions(sessions, config);
    const now = new Date().toLocaleTimeString();
    statusBarItem.text = `$(check) ${newCount} saved ${now}`;

    const msg = `Exported ${sessions.length} session(s) from all workspaces (${newCount} new/changed, ${skippedCount} unchanged)`;
    const action = await vscode.window.showInformationMessage(
      msg,
      'Open Directory',
      'Open File'
    );

    if (action === 'Open Directory') {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(config.outputDir));
    } else if (action === 'Open File' && outputFiles.length > 0) {
      const mdFile = outputFiles.find(f => f.endsWith('.md')) || outputFiles[0];
      vscode.workspace.openTextDocument(mdFile).then(doc => {
        vscode.window.showTextDocument(doc);
      });
    }

    setTimeout(() => {
      statusBarItem.text = '$(history) Chat Saver';
    }, 10000);
  } catch (err) {
    statusBarItem.text = '$(error) Export Failed';
    vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    setTimeout(() => {
      statusBarItem.text = '$(history) Chat Saver';
    }, 5000);
  }
}

async function exportLatestSession() {
  try {
    const config = getExportConfig();
    const sessions = loadAllChatSessions();

    if (sessions.length === 0) {
      vscode.window.showWarningMessage('No chat sessions found.');
      return;
    }

    // Already sorted newest-first
    const latest = sessions[0];
    const filePath = exportSessionAsMarkdown(latest, config);
    const wsName = latest.workspacePath ? path.basename(latest.workspacePath) : 'unknown';

    const action = await vscode.window.showInformationMessage(
      `Exported latest session from "${wsName}": "${latest.title}"`,
      'Open File'
    );

    if (action === 'Open File') {
      const doc = await vscode.workspace.openTextDocument(filePath);
      vscode.window.showTextDocument(doc);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function toggleAutoSave() {
  if (autoSaveTimer) {
    stopAutoSave();
    vscode.window.showInformationMessage('Auto-save disabled.');
  } else {
    const input = await vscode.window.showInputBox({
      prompt: 'Auto-save interval in minutes',
      value: '30',
      validateInput: (v) => {
        const n = Number(v);
        return (!Number.isFinite(n) || n < 1) ? 'Enter a number >= 1' : null;
      },
    });
    if (input) {
      const minutes = Number(input);
      startAutoSave(minutes);
      vscode.workspace.getConfiguration('copilotChatSaver')
        .update('autoSaveIntervalMinutes', minutes, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Auto-save enabled: every ${minutes} minute(s).`);
    }
  }
}

function openOutputDir() {
  const config = getExportConfig();
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(config.outputDir));
}

// ─── Auto-save ───────────────────────────────────────────────────────

function startAutoSave(minutes: number) {
  stopAutoSave();
  const ms = minutes * 60 * 1000;
  autoSaveTimer = setInterval(() => {
    exportAllHistory();
  }, ms);
  statusBarItem.tooltip = `Chat Saver — auto-saving every ${minutes} min (all workspaces)`;
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = undefined;
    statusBarItem.tooltip = 'Click to export Copilot chat history (all workspaces)';
  }
}

// ─── Config helpers ──────────────────────────────────────────────────

function getExportConfig(): ExportConfig {
  const config = vscode.workspace.getConfiguration('copilotChatSaver');

  let outputDir = config.get<string>('outputDirectory', '');
  if (!outputDir) {
    outputDir = path.join(os.homedir(), 'copilot-chat-exports');
  }

  return {
    outputDir,
    format: config.get<'markdown' | 'json' | 'both'>('format', 'both'),
    includeTimestamps: config.get<boolean>('includeTimestamps', true),
    includeThinking: config.get<boolean>('includeThinking', true),
    includeToolCalls: config.get<boolean>('includeToolCalls', true),
  };
}

function getAutoSaveInterval(): number {
  return vscode.workspace.getConfiguration('copilotChatSaver')
    .get<number>('autoSaveIntervalMinutes', 0);
}
