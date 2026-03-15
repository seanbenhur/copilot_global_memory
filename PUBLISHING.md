# Publishing to the VS Code Marketplace

This guide covers everything needed to publish **Copilot Scribe** to the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/vscode).

---

## Prerequisites

- **Node.js** 18+ and **npm**
- A **Microsoft account** (personal or org)
- An **Azure DevOps organization** (free — needed only for the access token)

---

## 1. Create a Publisher

### 1.1 Create an Azure DevOps Personal Access Token (PAT)

1. Go to [https://dev.azure.com](https://dev.azure.com) and sign in with your Microsoft account.
2. If you don't have an organization, create one (it's free).
3. Click your profile icon (top-right) → **Personal access tokens**.
4. Click **+ New Token**:
   - **Name:** `vsce-publish` (or anything descriptive)
   - **Organization:** Select **All accessible organizations**
   - **Expiration:** Set as needed (max 1 year)
   - **Scopes:** Click **Custom defined**, then:
     - Find **Marketplace** → check **Manage**
5. Click **Create** and **copy the token immediately** — you won't see it again.

### 1.2 Create a Publisher on the Marketplace

1. Go to [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
2. Sign in with the same Microsoft account.
3. Click **Create publisher**.
4. Fill in:
   - **Publisher ID:** e.g., `your-name` (this goes in `package.json` → `"publisher"`)
   - **Display Name:** Your name or org name
5. Click **Create**.

### 1.3 Update `package.json`

Change the `publisher` field from `"local"` to your actual publisher ID:

```json
"publisher": "your-publisher-id",
```

---

## 2. Prepare the Extension for Publishing

### 2.1 Add Required Metadata

Ensure these fields are present in `package.json`:

```json
{
  "name": "copilot-scribe",
  "displayName": "Copilot Scribe",
  "description": "Save and export GitHub Copilot chat history to Markdown and JSON files",
  "version": "0.1.0",
  "publisher": "your-publisher-id",
  "license": "AGPL-3.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/copilot-scribe"
  },
  "icon": "icon.png",
  "galleryBanner": {
    "color": "#1e1e1e",
    "theme": "dark"
  }
}
```

| Field | Required? | Notes |
|-------|-----------|-------|
| `publisher` | **Yes** | Must match your Marketplace publisher ID |
| `name` | **Yes** | Unique extension identifier |
| `displayName` | **Yes** | Shown in the Marketplace |
| `description` | **Yes** | Short summary |
| `version` | **Yes** | Semver (e.g., `0.1.0`) |
| `license` | Recommended | e.g., `AGPL-3.0`, `Apache-2.0` |
| `repository` | Recommended | GitHub URL — enables source link on Marketplace |
| `icon` | Recommended | 128x128 or 256x256 PNG in the project root |

### 2.2 Add a LICENSE File

```bash
cd ~/copilot-scribe
# Example: AGPL-3.0 license
npx license agpl-3.0 > LICENSE
```

### 2.3 Add an Icon (Optional but Recommended)

Place a `icon.png` (128x128 or 256x256) in the project root. This appears as the extension icon in the Marketplace and VS Code.

### 2.4 Review `.vscodeignore`

Ensure unnecessary files aren't included in the package. Your `.vscodeignore` should have:

```
.vscode/**
src/**
node_modules/**
.gitignore
tsconfig.json
**/*.ts
```

This keeps the published package small (only `out/`, `package.json`, `README.md`, etc.).

---

## 3. Install vsce

`vsce` is the CLI tool for packaging and publishing VS Code extensions.

```bash
npm install -g @vscode/vsce
```

---

## 4. Package the Extension

Build and package into a `.vsix` file:

```bash
cd ~/copilot-scribe
npm run compile
vsce package --allow-missing-repository
```

This creates `copilot-scribe-0.1.0.vsix`. You can test it locally:

```bash
code --install-extension copilot-scribe-0.1.0.vsix
```

---

## 5. Publish to the Marketplace

### 5.1 Login with Your PAT

```bash
vsce login your-publisher-id
```

Paste the Personal Access Token from Step 1.1 when prompted.

### 5.2 Publish

```bash
vsce publish
```

That's it. The extension will be live on the Marketplace within a few minutes at:
```
https://marketplace.visualstudio.com/items?itemName=your-publisher-id.copilot-scribe
```

### 5.3 Publish a Specific Version (Optional)

To bump the version and publish in one step:

```bash
# Patch bump: 0.1.0 → 0.1.1
vsce publish patch

# Minor bump: 0.1.0 → 0.2.0
vsce publish minor

# Major bump: 0.1.0 → 1.0.0
vsce publish major
```

---

## 6. Update an Existing Published Extension

```bash
cd ~/copilot-scribe

# 1. Make your code changes
# 2. Compile
npm run compile

# 3. Bump version and publish
vsce publish patch
```

---

## 7. Unpublish (If Needed)

```bash
vsce unpublish your-publisher-id.copilot-scribe
```

---

## 8. CI/CD Publishing (GitHub Actions)

For automated publishing on git tags, add `.github/workflows/publish.yml`:

```yaml
name: Publish Extension

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run compile
      - run: npx @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}
```

Add your PAT as a GitHub repository secret named `VSCE_PAT`.

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `vsce login <publisher>` | Authenticate with your PAT |
| `vsce package` | Create `.vsix` file locally |
| `vsce publish` | Publish current version |
| `vsce publish patch` | Bump patch version and publish |
| `vsce unpublish <publisher.extension>` | Remove from Marketplace |
| `vsce ls` | List files that will be included in the package |

---

## Checklist Before Publishing

- [ ] `publisher` in `package.json` is set to your real publisher ID (not `"local"`)
- [ ] `README.md` is up to date with feature descriptions and screenshots
- [ ] `CHANGELOG.md` exists (optional but recommended)
- [ ] `LICENSE` file exists
- [ ] Extension compiles cleanly (`npm run compile`)
- [ ] Extension tested locally via F5 or symlink
- [ ] `.vscodeignore` excludes source files and `node_modules/`
- [ ] `icon.png` added (optional)
- [ ] Version number is appropriate for the release
