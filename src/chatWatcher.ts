import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceStorageDirs } from './chatStorage';
import { refreshIndex } from './historyTool';

/**
 * Watches chatSessions/ directories for new files and auto-refreshes
 * the TF-IDF index so the LM tool and @history participant always
 * have up-to-date context.
 */
export class ChatWatcher implements vscode.Disposable {
  private watchers: fs.FSWatcher[] = [];
  private knownFiles = new Set<string>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Start watching all chatSessions/ dirs.
   */
  start(): void {
    this.scanExistingFiles();
    this.startWatching();
  }

  private scanExistingFiles(): void {
    const storageDirs = getWorkspaceStorageDirs();
    for (const storageDir of storageDirs) {
      try {
        const hashes = fs.readdirSync(storageDir, { withFileTypes: true });
        for (const entry of hashes) {
          if (!entry.isDirectory()) { continue; }
          const chatDir = path.join(storageDir, entry.name, 'chatSessions');
          if (!fs.existsSync(chatDir)) { continue; }
          const files = fs.readdirSync(chatDir);
          for (const f of files) {
            if (f.endsWith('.jsonl') || f.endsWith('.json')) {
              this.knownFiles.add(path.join(chatDir, f));
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  private startWatching(): void {
    const storageDirs = getWorkspaceStorageDirs();
    for (const storageDir of storageDirs) {
      try {
        const watcher = fs.watch(storageDir, { recursive: true }, (_eventType, filename) => {
          if (!filename) { return; }
          if (!filename.includes('chatSessions') || (!filename.endsWith('.jsonl') && !filename.endsWith('.json'))) {
            return;
          }

          const fullPath = path.join(storageDir, filename);
          if (this.knownFiles.has(fullPath)) { return; }

          this.knownFiles.add(fullPath);
          this.scheduleRefresh();
        });
        this.watchers.push(watcher);
      } catch {
        // Silently handle watch errors
      }
    }
  }

  /**
   * Debounced index refresh — waits 5s after the last new-file event
   * to let the session file populate before re-indexing.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      refreshIndex();
    }, 5000);
  }

  dispose(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
