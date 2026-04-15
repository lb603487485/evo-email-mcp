# EVO Email MCP

A local MCP server that gives Claude access to multiple email accounts. Works with Claude Code and Claude Desktop.

Supports **Gmail** and **Outlook**. macOS only (tokens stored in macOS Keychain).

## Install

```bash
git clone <repo-url> evo-email-mcp
cd evo-email-mcp
npm install
npm run build
```

## Setup

### 1. Provider credentials (one-time per provider)

**Gmail:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project, enable **Gmail API** and **People API**
3. Create OAuth credentials (Desktop app)
4. Download JSON and save as `credentials/gmail.json`

**Outlook:**
1. Go to [portal.azure.com](https://portal.azure.com) > App registrations
2. Create an app, add **Mail.ReadWrite**, **Mail.Send**, **User.Read**, **People.Read** permissions
3. Add a Web redirect URI: `http://localhost:3001/oauth/callback`
4. Create a client secret
5. Save to `credentials/outlook.json`:
```json
{ "client_id": "your-app-client-id", "client_secret": "your-client-secret" }
```

### 2. Add an email account

```bash
npm run add-account
```

This opens a browser for OAuth, then saves the token to macOS Keychain. Run once per account.

| Flag | Description |
|------|-------------|
| `--provider <provider>` | `gmail` or `outlook` (interactive prompt if omitted) |
| `--nickname <name>` | Short alias for this account, e.g. `"work"` (prompted if omitted) |

```bash
# Examples:
npm run add-account -- --provider gmail --nickname work
npm run add-account -- --provider outlook --nickname "outlook work"
```

To remove an account:
```bash
npm run remove-account
npm run remove-account -- --nickname work
```

### 3. Register with Claude

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

**Claude Desktop** -- add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

## Configuration

Copy the example config to get started:

```bash
cp config.example.json config.json
```

Accounts are added automatically by `npm run add-account`. The other settings:

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `sendMode` | `"confirm"`, `"auto"`, `"blocked"` | `"confirm"` | `confirm` requires draft preview + approval before sending. `auto` sends immediately. `blocked` disables sending entirely. |
| `defaultMaxResults` | number | `20` | Max emails returned per search query per account. |

Config is hot-reloaded on every request -- no server restart needed.

## Available Tools

| Tool | Description |
|------|-------------|
| `email_search` | Search emails by query (Gmail query syntax) |
| `email_get` | Read full email content by ID |
| `email_draft` | Preview a draft before sending |
| `email_send` | Send an email (requires approval in confirm mode) |
| `email_list_labels` | List labels/folders for an account |
| `email_apply_label` | Apply a label to an email |
| `email_download_attachment` | Download an attachment by ID |
| `email_lookup_contact` | Find email address by person name |
| `email_list_accounts` | Show registered accounts |
| `email_set_config` | Change settings via Claude |

## Security

- OAuth tokens are stored in macOS Keychain, never in config files
- `config.json` contains no credentials and is gitignored
- Default send mode (`confirm`) requires explicit user approval before any email is sent

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode (auto-rebuild)
npm test               # Run unit tests
npm run smoke-test     # End-to-end smoke test
```

## Files You Care About

```
config.json            # Settings, gitignored (copy from config.example.json)
config.example.json    # Example config with defaults
credentials/gmail.json # Google OAuth app credentials (gitignored)
credentials/outlook.json # Azure app client ID (gitignored)
.mcp.json              # MCP server registration for Claude Code
```
