# EVO Email MCP

A local MCP server that lets you manage email directly from Claude. Search, read, draft, and send across multiple Gmail and Outlook accounts without leaving the CLI.

Once set up, just talk to Claude naturally -- "check my work email for anything from Alice", "reply to that thread", "send a meeting summary to the team". Claude handles the rest.

### What you can do

- Search and read emails across multiple accounts
- Send emails with CC/BCC (with a draft preview step so nothing goes out without your approval)
- Look up contacts by name
- Manage labels and download attachments
- Switch between accounts by nickname ("send from my work account")

### What it takes to set up

You'll need to create OAuth credentials in Google Cloud Console and/or Azure Portal (one-time), then run `evo-email-add-account` for each email. After that, register the server with Claude Code or Claude Desktop and you're done. Takes about 10 minutes.

Supports **Gmail** and **Outlook**. macOS only (tokens stored in macOS Keychain).

## Install

```bash
npm install -g evo-email-mcp
```

All user data (config, credentials) is stored in `~/.evo-email-mcp/`.

## Setup

### 1. Provider credentials (one-time per provider)

**Gmail:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project, enable **Gmail API** and **People API**
3. Create OAuth credentials (Desktop app)
4. Download JSON and save as `~/.evo-email-mcp/credentials/gmail.json`

**Outlook:**
1. Go to [portal.azure.com](https://portal.azure.com) > App registrations
2. Create an app, add **Mail.ReadWrite**, **Mail.Send**, **User.Read**, **People.Read** permissions
3. Add a Web redirect URI: `http://localhost:3001/oauth/callback`
4. Create a client secret
5. Save to `~/.evo-email-mcp/credentials/outlook.json`:
```json
{ "client_id": "your-app-client-id", "client_secret": "your-client-secret" }
```

### 2. Add an email account

```bash
evo-email-add-account
```

This opens a browser for OAuth, then saves the token to macOS Keychain. Run once per account.

| Flag | Description |
|------|-------------|
| `--provider <provider>` | `gmail` or `outlook` (interactive prompt if omitted) |
| `--nickname <name>` | Short alias for this account, e.g. `"work"` (prompted if omitted) |

```bash
# Examples:
evo-email-add-account --provider gmail --nickname work
evo-email-add-account --provider outlook --nickname "outlook work"
```

To remove an account:
```bash
evo-email-remove-account
evo-email-remove-account --nickname work
```

### 3. Register with Claude

**Claude Code** -- add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "email": {
      "command": "evo-email-mcp"
    }
  }
}
```

**Claude Desktop** -- add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "email": {
      "command": "evo-email-mcp"
    }
  }
}
```

## Configuration

Config is auto-created at `~/.evo-email-mcp/config.json` on first run. Accounts are added automatically by `evo-email-add-account`. The other settings:

### Permissions

Each write category has a permission level: `"auto"` (execute immediately), `"confirm"` (requires confirmation), or `"blocked"` (disabled).

| Category | Controls | Default |
|----------|----------|---------|
| `emailWrite` | `email_draft`, `email_send` | `"confirm"` |
| `contactWrite` | `email_create_contact`, `email_update_contact` | `"auto"` |
| `labelWrite` | `email_apply_label` | `"auto"` |

In confirm mode:
- **emailWrite**: `email_draft` saves to your Drafts folder and shows a preview. Approve, then `email_send` sends it.
- **contactWrite / labelWrite**: The tool returns a preview. Call it again with the same parameters to confirm.

Example config:
```json
{
  "permissions": {
    "emailWrite": "confirm",
    "contactWrite": "auto",
    "labelWrite": "auto"
  },
  "defaultMaxResults": 20
}
```

Old `sendMode` configs are migrated automatically on first load.

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
| `email_create_contact` | Create a new contact (name, email, phone, company, title) |
| `email_update_contact` | Update an existing contact by email address |
| `email_list_accounts` | Show registered accounts |
| `email_set_config` | Change settings via Claude |

## Security

- OAuth tokens are stored in macOS Keychain, never in config files
- `config.json` contains no credentials
- Default send mode (`confirm`) requires explicit user approval before any email is sent

## Development

If working on the source code:

```bash
git clone https://github.com/lb603487485/evo-email-mcp.git
cd evo-email-mcp
npm install
npm run build
npm run add-account    # Uses ts-node, runs from source
npm run dev            # Watch mode
npm test               # Run unit tests
npm run smoke-test     # End-to-end smoke test
```

## Files

```
~/.evo-email-mcp/
├── config.json                # Settings (auto-created on first run)
├── credentials/
│   ├── gmail.json             # Google OAuth app credentials
│   └── outlook.json           # Azure app client ID + secret
```
