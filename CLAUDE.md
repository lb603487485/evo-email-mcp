# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This project is in the **design phase** — no code has been written yet. The full spec lives at `docs/superpowers/specs/2026-04-13-evo-email-mcp-design.md`.

**Before writing any code, read the spec.** It is the authoritative source for architecture, tool signatures, send modes, security model, and out-of-scope decisions. Do not infer or invent — check the spec first.

## What This Is

A local TypeScript/Node.js MCP server that gives Claude access to multiple Gmail accounts simultaneously. Compatible with both Claude Code and Claude Desktop.

## Planned Commands

Once implemented, the development workflow will be:

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode (tsc --watch)
npm run add-account    # CLI: OAuth-authenticate a new Gmail account → saves token to macOS Keychain
```

The server runs as a child process launched by Claude Code / Claude Desktop — there is no standalone `npm start`.

## Architecture

```
src/
├── server.ts          # MCP entry point — registers tools and starts the server
├── tools.ts           # MCP tool definitions exposed to Claude
├── accounts.ts        # Account registry (list, add, remove, nickname resolution)
├── auth/
│   ├── oauth.ts       # Google OAuth2 flow
│   └── keychain.ts    # macOS Keychain read/write (one entry per account: evo-email-mcp:<email>)
└── gmail/
    ├── search.ts      # Search across one or all accounts, merge results
    ├── send.ts        # Send with draft-preview and send-mode enforcement
    ├── labels.ts      # Label management
    └── attachments.ts # Attachment download
scripts/
└── add-account.ts     # Standalone CLI for the OAuth onboarding flow
config.json            # Runtime settings (no credentials — hot-reloaded per request)
```

## Key Design Decisions

**Security:** OAuth tokens live exclusively in macOS Keychain, keyed as `evo-email-mcp:<email@gmail.com>`. `config.json` never contains credentials and is safe to commit.

**Send confirmation modes** (`config.json` → `sendMode`):
- `confirm` (default) — Claude calls `draft_email` first, user approves, then `send_email`
- `auto` — sends immediately
- `blocked` — read-only, sending disabled

`config.json` is hot-reloaded on every request; no server restart needed when the file changes.

**Email formatting:** Plain text by default — no HTML templates. If the user requests formatting (bold, colors, etc.), the agent uses HTML tags directly in the body. `mime.ts` auto-detects HTML and sends as `multipart/alternative` with a plain text fallback. Tool descriptions enforce standard email format (greeting, body, sign-off) unless the user says otherwise.

**Multi-account scoping:** Tools accept an optional `account` parameter (email or nickname). Omitting it runs across all registered accounts with merged results.

## MCP Tools

Core: `search_emails`, `send_email`, `get_email`, `draft_email`  
Secondary: `list_labels`, `apply_label`, `download_attachment`, `list_accounts`, `set_config`

## Integration

After building, register the server in:

- **Claude Code** — `~/.claude/settings.json` under `mcpServers`
- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`

Both point to the same compiled binary: `node /Users/evolin1/Desktop/AICoding/evo-email-mcp/dist/server.js`

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
