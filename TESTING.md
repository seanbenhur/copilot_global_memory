# Copilot Scribe — Local Testing Guide

## Prerequisites

- **VS Code** 1.90.0 or later
- **Node.js** 18+ and **npm**
- **GitHub Copilot Chat** extension installed and signed in (so you have existing chat history and access to LM models)

---

## 1. Setup

```bash
cd ~/copilot-scribe
npm install
npm run compile
```

Verify the build succeeded — you should see files in `out/`:

```bash
ls out/
# chatStorage.js  chatWatcher.js  extension.js  formatter.js
# historyParticipant.js  historyTool.js  lmReranker.js  similarity.js  types.js
```

---

## 2. Launch the Extension in Debug Mode

1. Open the `~/copilot-scribe` folder in VS Code.
2. Press **F5** (or **Run → Start Debugging**).
   - VS Code will open a new **Extension Development Host** window.
   - The extension activates automatically on startup (`onStartupFinished`).
3. You should see:
   - A **"$(history) Chat Saver"** item in the bottom-right status bar.
   - An info toast: _"Copilot Scribe is active — global history across all workspaces."_

> **Tip:** If no launch configuration exists, create `.vscode/launch.json`:
> ```json
> {
>   "version": "0.2.0",
>   "configurations": [
>     {
>       "name": "Run Extension",
>       "type": "extensionHost",
>       "request": "launch",
>       "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
>     }
>   ]
> }
> ```

---

## 3. Test Cases

### 3.1 Export All Chat History

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the Command Palette (`Cmd+Shift+P`) | Palette opens |
| 2 | Type **"Copilot Scribe: Export All"** and select it | Status bar shows spinning icon then "Exporting N..." |
| 3 | Wait for export to finish | Info toast: _"Exported N session(s) from all workspaces (X new/changed, Y unchanged)"_ with **Open Directory** / **Open File** buttons |
| 4 | Click **Open Directory** | Finder opens `~/copilot-chat-exports/` |
| 5 | Verify files | You should see `.md` and `.json` files (per-session + combined). Markdown files should contain chat messages grouped by workspace |

### 3.2 Export Latest Session

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run **"Copilot Scribe: Export Latest Chat Session"** | Info toast showing the latest session title and workspace name |
| 2 | Click **Open File** | Markdown file opens with the most recent chat session content |
| 3 | Verify content | Messages should show user/assistant roles, timestamps, and (if present) thinking blocks in `<details>` tags and tool calls with status icons |

### 3.3 Content Deduplication

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run **Export All** twice in a row | First run shows `N new/changed`; second run shows `0 new/changed, N unchanged` |
| 2 | Check `~/copilot-chat-exports/.content-hashes.json` | File exists and maps session IDs to SHA-256 hashes |

### 3.4 Toggle Auto-Save

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run **"Copilot Scribe: Toggle Auto-Save"** | Input box appears asking for interval in minutes |
| 2 | Enter `1` and press Enter | Toast: _"Auto-save enabled: every 1 minute(s)."_ Status bar tooltip updates |
| 3 | Wait ~60 seconds | Export runs automatically (status bar flashes) |
| 4 | Run **Toggle Auto-Save** again | Toast: _"Auto-save disabled."_ |

### 3.5 Open Output Directory

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run **"Copilot Scribe: Open Output Directory"** | Finder/Explorer opens `~/copilot-chat-exports/` (or your configured directory) |

### 3.6 `@history` Chat Participant — Context-Aware Q&A

This is the primary way to leverage past chat knowledge. The `@history` participant automatically searches your past sessions, finds relevant context, and feeds it into the LLM so Copilot answers with knowledge from your previous conversations.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open **Copilot Chat** panel in the Extension Dev Host | Chat panel opens |
| 2 | Type `@history how did I set up the deployment pipeline?` | Progress: "Searching past chat sessions...", then "Found N similar session(s), generating response..." |
| 3 | Wait for response | Copilot responds with an answer that **references your actual past chat content** — specific code, commands, or decisions from previous sessions |
| 4 | Check the references | At the bottom of the response, workspace paths of matched past sessions appear as references |
| 5 | Try `@history what was the fix for the auth token issue?` | Response includes context from past sessions about auth tokens, if any exist |
| 6 | Try `@history xyzzy random gibberish` | Response: _"No similar past chat sessions found for your query."_ |

**Key behavior:** The `@history` participant:
- Searches your TF-IDF index of ALL past sessions across ALL workspaces
- **Re-ranks** TF-IDF candidates using Copilot's LM (gpt-4o-mini) for semantic accuracy
- Injects the full conversation content from top-ranked past sessions as context
- Sends everything to the LLM so the response incorporates your past knowledge
- No manual searching or copying required — it's automatic once you mention `@history`
- Falls back to TF-IDF-only ordering if the LM re-ranker is unavailable

### 3.7 Automatic History Tool — Agent Mode (Zero Effort)

When using Copilot in **Agent mode** (the mode with tool access), the `copilotScribe_searchHistory` tool is registered and available. Copilot can call it **automatically** when it thinks past chat context would be helpful — no need to type `@history` or open any command palette.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch Copilot Chat to **Agent mode** (if supported in your version) | Agent mode active — Copilot can use tools |
| 2 | Ask: `"How did I fix the database connection issue last time?"` | Copilot recognizes this references past work and automatically calls the `copilotScribe_searchHistory` tool |
| 3 | Observe the tool invocation | In the chat, you should see a progress message: _"Searching past chat history for: ..."_ followed by LM re-ranking of candidates |
| 4 | Wait for response | Copilot responds with information from your past sessions, citing relevant conversations (results are semantically re-ranked for better accuracy) |
| 5 | Ask a completely new question with no past history | Copilot does NOT call the history tool (since it's not relevant) |

> **Note:** Whether Copilot automatically invokes the tool depends on the model's judgment. Phrases like "last time", "previously", "how did I", "what was" help signal that past context is needed. If auto-invocation doesn't trigger, fall back to `@history`.

### 3.8 Refresh Index

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run **"Copilot Scribe: Refresh Chat History Index"** (`Cmd+Shift+P`) | Toast: _"Chat history index refreshed."_ |
| 2 | Use `@history` with a recent topic | Results should include the very latest sessions |

> The index also auto-refreshes when the FS watcher detects new chat session files (with a 5-second debounce).

### 3.9 Thinking Blocks and Tool Calls (in Exports)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Export a session where Claude was used (with thinking enabled) | Markdown contains `<details><summary>🧠 Thinking</summary>` collapsible sections |
| 2 | Export a session that used tool calls (file edits, searches) | Markdown contains tool call entries with ✅ (complete) or ⏳ (in-progress) icons |
| 3 | Set `copilotScribe.includeThinking` to `false` | Re-export — thinking blocks should no longer appear |
| 4 | Set `copilotScribe.includeToolCalls` to `false` | Re-export — tool call details should no longer appear |

---

## 4. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Copilot Chat (User)                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Option A: @history <question>                                 │
│  ┌─────────────────────────────────────────────┐               │
│  │ historyParticipant.ts                       │               │
│  │  1. Receives user prompt                    │               │
│  │  2. Searches TF-IDF index (similarity.ts)   │               │
│  │  3. Re-ranks candidates via LM (lmReranker) │               │
│  │  4. Fetches full past session content       │               │
│  │  5. Injects as context into LM prompt       │               │
│  │  6. Streams response back to chat           │               │
│  └─────────────────────────────────────────────┘               │
│                                                                │
│  Option B: Agent mode (automatic)                              │
│  ┌─────────────────────────────────────────────┐               │
│  │ historyTool.ts (LM Tool)                   │               │
│  │  - Copilot calls searchHistory tool         │               │
│  │  - TF-IDF broad recall → LM re-rank        │               │
│  │  - Returns past chat context as text        │               │
│  │  - Copilot incorporates in its response     │               │
│  └─────────────────────────────────────────────┘               │
│                                                                │
│  ┌─────────────────────────────────────────────┐               │
│  │ lmReranker.ts (Semantic Re-ranker)          │               │
│  │  - Uses Copilot's gpt-4o-mini               │               │
│  │  - Scores TF-IDF candidates 0–10            │               │
│  │  - Falls back to TF-IDF order if no model   │               │
│  └─────────────────────────────────────────────┘               │
│                                                                │
│  Index Management                                              │
│  ┌─────────────────────────────────────────────┐               │
│  │ chatWatcher.ts (FS Watcher)                 │               │
│  │  - Watches chatSessions/ dirs               │               │
│  │  - Auto-refreshes TF-IDF index on new files │               │
│  └─────────────────────────────────────────────┘               │
│                                                                │
│  ┌─────────────────────────────────────────────┐               │
│  │ similarity.ts (TF-IDF Engine)               │               │
│  │  - Tokenizes sessions                       │               │
│  │  - Cosine similarity ranking                │               │
│  └─────────────────────────────────────────────┘               │
│                                                                │
│  ┌─────────────────────────────────────────────┐               │
│  │ chatStorage.ts (Session Reader)             │               │
│  │  - Parses JSONL from ALL workspace dirs     │               │
│  │  - Extracts messages, thinking, tool calls  │               │
│  └─────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. Settings Reference

All settings are under `copilotScribe.*` in VS Code Settings (`Cmd+,`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `outputDirectory` | string | `~/copilot-chat-exports/` | Where exported files are saved |
| `format` | `markdown` / `json` / `both` | `both` | Export format |
| `autoSaveIntervalMinutes` | number | `0` (disabled) | Auto-export interval |
| `includeTimestamps` | boolean | `true` | Show timestamps on messages |
| `includeThinking` | boolean | `true` | Include Claude thinking blocks |
| `includeToolCalls` | boolean | `true` | Include tool call details |
| `enableSimilarChats` | boolean | `true` | Enable FS watcher for auto-index refresh |
| `similarChatsMaxResults` | number | `5` | Max similar sessions to return |
| `similarChatsMinScore` | number | `0.05` | Minimum TF-IDF score threshold |

---

## 6. Troubleshooting

| Problem | Solution |
|---------|----------|
| "No chat history found" | Ensure you have Copilot Chat sessions. Check that `~/Library/Application Support/Code/User/workspaceStorage/*/chatSessions/` directories exist and contain `.jsonl` files |
| Extension doesn't activate | Check the **Output** panel → select **Extension Host** from the dropdown → look for errors |
| `@history` returns "No similar past chat sessions found" | Run **Refresh Chat History Index** first. Your past sessions may use different terms than your query — try rephrasing |
| Agent mode doesn't auto-call the history tool | Not all models auto-invoke tools. Use `@history` explicitly as a reliable fallback |
| `@history` LM response fails | Copilot model must be accessible. Ensure GitHub Copilot is signed in and active |
| Index not updating with new chats | Verify `enableSimilarChats` is `true`. The watcher auto-refreshes 5s after a new file. You can also run **Refresh Chat History Index** manually |
| Build errors after editing | Run `npm run compile` and check for TypeScript errors |

---

## 6. Live Reload During Development

For rapid iteration, use watch mode:

```bash
npm run watch
```

Then press **F5** to launch. After editing TypeScript files, the watcher recompiles automatically. Press `Cmd+Shift+F5` in the Extension Dev Host to restart and pick up changes.
