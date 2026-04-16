# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

v1.1.0 — published to npm, 44 unit tests passing, clean build.

## What This Is

A local TypeScript/Node.js MCP server that gives Claude access to multiple email accounts (Gmail + Outlook). Compatible with both Claude Code and Claude Desktop.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode (tsc --watch)
npm run test           # Run tests (vitest)
npm run add-account    # CLI: OAuth-authenticate a new account → saves token to macOS Keychain
npm run remove-account # CLI: Remove an account and its stored token
```

The server runs as a child process launched by Claude Code / Claude Desktop — there is no standalone `npm start`.

## Architecture

```
src/
├── server.ts          # MCP entry point — registers tools and starts the server
├── tools.ts           # MCP tool definitions exposed to Claude
├── config.ts          # Config loading + hot-reload (config.json)
├── factory.ts         # Provider factory — instantiates Gmail or Outlook based on account type
├── paths.ts           # Resolved paths for config and accounts files
├── auth/
│   ├── keychain.ts    # macOS Keychain read/write (one entry per account)
│   ├── oauth-gmail.ts # Google OAuth2 flow
│   └── oauth-outlook.ts # Microsoft OAuth2 flow (device code grant)
├── providers/
│   ├── interface.ts   # Provider interface — all providers implement this
│   ├── gmail.ts       # Gmail provider (Google APIs)
│   ├── outlook.ts     # Outlook provider (Microsoft Graph API)
│   ├── contacts.ts    # Contacts operations (Gmail People API + Outlook Graph)
│   └── mime.ts        # MIME message construction, auto-detects HTML
└── cli/
    ├── add-account.ts # OAuth onboarding CLI
    └── remove-account.ts # Account removal CLI
config.json            # Runtime settings (no credentials — hot-reloaded per request)
```

## Key Design Decisions

**Security:** OAuth tokens live exclusively in macOS Keychain, keyed as `evo-email-mcp/<email>`. `config.json` never contains credentials and is safe to commit.

**Permissions system** (`config.json` → `permissions`):
Each write category (`emailWrite`, `contactWrite`, `labelWrite`) has a level:
- `auto` — executes immediately
- `confirm` (default) — requires confirmation (call the same tool twice)
- `blocked` — action is disabled

Server-enforced middleware — cannot be bypassed by any client.

`config.json` is hot-reloaded on every request; no server restart needed when the file changes.

**Email formatting:** Plain text by default — no HTML templates. If the user requests formatting (bold, colors, etc.), the agent uses HTML tags directly in the body. `mime.ts` auto-detects HTML and sends as `multipart/alternative` with a plain text fallback. Tool descriptions enforce standard email format (greeting, body, sign-off) unless the user says otherwise.

**Multi-account scoping:** Tools accept an optional `account` parameter (email or nickname). Omitting it runs across all registered accounts with merged results.

**No destructive operations:** The server does not support deleting emails, drafts, or contacts. Users are guided to the web UI for deletion.

## MCP Tools (12 total, all prefixed `email_`)

Core: `email_search`, `email_get`, `email_draft`, `email_send`
Contacts: `email_lookup_contact`, `email_create_contact`, `email_update_contact`
Labels: `email_list_labels`, `email_apply_label`
Other: `email_download_attachment`, `email_list_accounts`, `email_set_config`

## Integration

After building, register the server in:

- **Claude Code** — `~/.claude/settings.json` under `mcpServers`
- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`

Both point to the compiled binary: `node /path/to/evo-email-mcp/dist/server.js`

## Platform Constraint

macOS only — cross-platform Keychain support (Windows/Linux) is explicitly out of scope.

---

## Coding Guidelines (Karpathy Principles)

Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
