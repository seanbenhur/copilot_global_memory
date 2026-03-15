# Copilot Scribe

A VS Code extension that exports your **global** GitHub Copilot chat history — across all workspaces — to Markdown and JSON files, and **automatically feeds relevant past chat context into new conversations**.

## Key Features

### Context Recall — `@history` Participant
Type `@history <your question>` in Copilot Chat to get answers informed by your past conversations. The extension searches your history, finds similar sessions, re-ranks them semantically using Copilot's LM, and injects the full context into the response.

### Automatic Tool — Agent Mode
In Agent mode, Copilot can automatically call the `copilotScribe_searchHistory` tool when it detects your question references past work ("how did I implement the retry logic...", "what was the fix for the CORS error..."). Zero effort required.

### Full-Featured Export
- **Global History** — Aggregates chat sessions from ALL workspaces, not just the current one
- **Zero Dependencies** — Pure Node.js stdlib (fs, path, crypto). No native modules.
- **Claude Thinking Blocks** — Extracts reasoning/thinking blocks as collapsible `<details>` sections
- **Tool Call Details** — Captures file reads, searches, edits, and other tool invocations
- **Content-Hash Deduplication** — Only re-exports sessions that have changed since last export
- **Dual Format** — Exports as Markdown (readable) and/or JSON (structured)
- **Auto-Save** — Periodically exports chat history on a configurable interval
- **Workspace Grouping** — Combined markdown groups sessions by their source workspace

## How It Works

```
User asks a question
        │
        ├── @history <question>           ← explicit
        │   └── historyParticipant.ts
        │
        └── Agent mode (automatic)         ← implicit
            └── historyTool.ts
                    │
                    ▼
            TF-IDF keyword search          ← similarity.ts
            (broad candidate retrieval)
                    │
                    ▼
            LM semantic re-ranking         ← lmReranker.ts
            (Copilot's gpt-4o-mini)
                    │
                    ▼
            Top sessions injected as
            context into LLM prompt
                    │
                    ▼
            Response with past knowledge
```

The FS watcher (`chatWatcher.ts`) automatically refreshes the TF-IDF index when new chat session files appear, so the index is always up to date.

## Installation

### From Source (Development)

```bash
cd ~/copilot-scribe
npm install
npm run compile

# Symlink into VS Code extensions
ln -sfn "$(pwd)" ~/.vscode/extensions/local.copilot-scribe-0.1.0

# Reload VS Code (Cmd+Shift+P → "Developer: Reload Window")
```

No native module rebuilding needed — zero runtime dependencies.

## Commands

Open the Command Palette (`Cmd+Shift+P`) and search for:

| Command | Description |
|---------|-------------|
| `Copilot Scribe: Export All Chat History` | Export all sessions from all workspaces |
| `Copilot Scribe: Export Latest Chat Session` | Export the most recent session |
| `Copilot Scribe: Toggle Auto-Save` | Enable/disable periodic auto-export |
| `Copilot Scribe: Open Output Directory` | Reveal the export folder in Finder |
| `Copilot Scribe: Refresh Chat History Index` | Force rebuild of the TF-IDF search index |

## Chat Participant

Type `@history` followed by your question in Copilot Chat:

```
@history how did I configure the redis cache connection?
@history what was the exact command to run the e2e tests?
@history show me the graphql resolver from yesterday
```

The participant:
1. Searches TF-IDF index for keyword matches (broad recall)
2. Re-ranks candidates using Copilot's LM for semantic accuracy
3. Fetches full conversation content from top matches
4. Injects it as context and generates a response referencing your past work

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `copilotScribe.outputDirectory` | `~/copilot-chat-exports/` | Where to save exported files |
| `copilotScribe.format` | `both` | `markdown`, `json`, or `both` |
| `copilotScribe.autoSaveIntervalMinutes` | `0` (disabled) | Auto-save interval in minutes |
| `copilotScribe.includeTimestamps` | `true` | Include message timestamps |
| `copilotScribe.includeThinking` | `true` | Include Claude thinking/reasoning blocks |
| `copilotScribe.includeToolCalls` | `true` | Include tool call details |
| `copilotScribe.enableSimilarChats` | `true` | Enable FS watcher for auto-index refresh |
| `copilotScribe.similarChatsMaxResults` | `5` | Max similar sessions to return |
| `copilotScribe.similarChatsMinScore` | `0.05` | Minimum TF-IDF score threshold |

## Output

### Per-Session Markdown Files

Each session also gets its own markdown file with a content hash in the filename:

```
copilot-chat-exports/
├── 2026-04-12-09-45-00_implement-oauth2-flow_f5e4d3c2b1a0.md
├── 2026-04-13-16-20-00_debug-memory-leak_q9r8s7t6u5v4.md
├── chat_history_2026-04-15-10-00-00.md    ← combined file
└── chat_history_2026-04-15-10-00-00.json  ← structured export
```

### Combined Markdown

The combined file groups sessions by workspace:

```markdown
# Copilot Chat History (All Workspaces)

## Table of Contents

### frontend-dashboard
1. Implement dark mode toggle — Apr 14 [copilot/gpt-4o] (15 messages)
2. Update dependencies — Apr 12 [copilot/claude-3.5-sonnet] (5 messages)

### backend-api
3. Fix race condition in webhooks — Apr 11 (22 messages)

---

## Implement dark mode toggle
*Created: 4/14/2026* | *Model: copilot/gpt-4o* | *Workspace: frontend-dashboard*

### 🧑 You
help me add a dark mode toggle button to the main header

### 🤖 Copilot

<details>
<summary>💭 Thinking</summary>

The user wants to add a dark mode toggle button. Let me check the header component and tailwind config...

</details>

> ✅ Searched for text `Header`, 2 results
> ✅ Reading src/components/Header.tsx, lines 1 to 85

Here is how you can implement the dark mode toggle...
```

### JSON

```json
{
  "exportedAt": "2026-04-15T...",
  "sessionCount": 56,
  "sessions": [
    {
      "id": "...",
      "title": "Implement dark mode toggle",
      "createdAt": "...",
      "model": "copilot/gpt-4o",
      "workspace": "/path/to/frontend-dashboard",
      "messages": [
        { "role": "user", "content": "..." },
        {
          "role": "assistant",
          "content": "...",
          "thinking": "The user wants...",
          "toolCalls": [
            { "invocationMessage": "Searching...", "pastTenseMessage": "Found 2 results", "isComplete": true }
          ]
        }
      ]
    }
  ]
}
```

## Chat Storage Locations

The extension scans all workspace storage directories:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Code/User/workspaceStorage/*/chatSessions/` |
| Linux | `~/.config/Code/User/workspaceStorage/*/chatSessions/` |
| Windows | `%APPDATA%\Code\User\workspaceStorage\*\chatSessions\` |

VS Code Insiders uses `Code - Insiders` in place of `Code`. Both are scanned automatically.

Each workspace hash directory contains a `workspace.json` that maps the hash to the original folder path.

## Troubleshooting

**"No chat history found in any workspace"**
- Make sure you've had at least one Copilot chat conversation
- Check that `chatSessions/` directories exist under your workspace storage

**Sessions are empty**
- The JSONL format uses incremental updates (kind=0 init, kind=1 set, kind=2 push)
- If the format changes in a future VS Code version, file an issue

## Privacy

This extension:
- Never makes network requests
- Never collects telemetry
- Reads only from VS Code's local workspace storage (read-only)
- Writes only to your configured output directory
- Has zero runtime dependencies

## License

AGPL-3.0
