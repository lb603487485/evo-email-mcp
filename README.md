# EVO Email MCP

A local MCP server that gives Claude access to your Gmail accounts.

## Install

```bash
git clone <repo-url> evo-email-mcp   # or copy the project folder
cd evo-email-mcp
npm install
npm run build
```

## Setup

### 1. Google Cloud Console (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project, enable **Gmail API** and **People API**
3. Create OAuth credentials (Desktop app)
4. Download JSON -> save as `credentials/gmail.json`

### 2. Add a Gmail Account

```bash
npm run add-account

# Or with flags:
npm run add-account -- --provider gmail --nickname work
```

Run this for each Gmail account you want to connect.

### 3. Register with Claude Code

The `.mcp.json` in this project auto-registers when you open Claude Code from this directory.

For global access from any directory, add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "email": {
      "command": "node",
      "args": ["/full/path/to/evo-email-mcp/dist/server.js"]
    }
  }
}
```

## Settings

Edit `config.json` in the project root. Changes take effect immediately.

- `sendMode`: `"confirm"` (default), `"auto"`, or `"blocked"`
- `defaultMaxResults`: `20` (default)
- `accounts`: registered accounts (managed by add-account)

## Available Tools (what Claude can do)

- `search_emails` - search by query, defaults to primary inbox
- `get_email` - read full email by ID
- `draft_email` - preview before sending
- `send_email` - send (requires approval in confirm mode)
- `list_labels` - list Gmail labels
- `apply_label` - add/remove labels
- `download_attachment` - save attachment locally
- `lookup_contact` - find email address by person name
- `list_accounts` - show registered accounts
- `set_config` - change settings via Claude

## Scripts

All scripts run from the project directory (`cd evo-email-mcp`):

```bash
npm run add-account    # Add a new Gmail account
npm run smoke-test     # Test Gmail connection
npm run build          # Rebuild after code changes
npm run dev            # Watch mode (auto-rebuild)
npm test               # Run unit tests
```

## Files You Care About

```
config.json            # Settings (safe to edit)
credentials/gmail.json # Google OAuth app credentials (gitignored)
.mcp.json              # MCP server registration for Claude Code
```
