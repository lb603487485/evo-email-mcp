# Permissions System Design

**Date:** 2026-04-15
**Status:** Approved

## Overview

Replace `sendMode` with a per-category permission system. Three write categories (`emailWrite`, `contactWrite`, `labelWrite`), each with three levels (`auto`, `confirm`, `blocked`). Server-enforced via middleware — no client parameters needed. Works with any LLM or MCP client.

## Config

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

`sendMode` is removed entirely. Migrated automatically on first load.

## Permission Levels

| Level | Behavior |
|-------|----------|
| `auto` | Execute immediately |
| `confirm` | First call returns preview, second identical call executes |
| `blocked` | Rejected with error message |

## Category Mapping

```typescript
const TOOL_CATEGORIES: Record<string, string> = {
  'email_draft':          'emailWrite',
  'email_send':           'emailWrite',
  'email_create_contact': 'contactWrite',
  'email_update_contact': 'contactWrite',
  'email_apply_label':    'labelWrite',
};
```

Read tools (`email_search`, `email_get`, `email_lookup_contact`, `email_list_labels`, `email_list_accounts`, `email_download_attachment`, `email_set_config`) have no category and always execute.

## Middleware

All tool calls pass through a permission check before reaching their handler:

```
handleTool(name, args)
  → category = TOOL_CATEGORIES[name]
  → if no category → execute (read tools)
  → level = config.permissions[category]
  → if blocked → return "This action is disabled"
  → if emailWrite → pass through (draft+send flow handles confirm internally)
  → if auto → execute
  → if confirm:
      → key = JSON.stringify({ name, args })
      → if pendingConfirmations.has(key) → delete, execute
      → else → store key, return preview message
```

### emailWrite Special Case

`emailWrite` does NOT use the generic confirm pattern. The draft+send flow is the confirm mechanism:

- **auto mode:** `email_draft` is skipped, `email_send` sends directly
- **confirm mode:** `email_draft` saves to Drafts + shows preview + stores draft ID. `email_send` requires matching draft ID.
- **blocked mode:** Both `email_draft` and `email_send` are rejected by the middleware.

The existing draft ID tracking (`approvedDrafts` Map) remains for email. The generic `pendingConfirmations` Map is only for `contactWrite` and `labelWrite`.

### Stale Confirmation Cleanup

Pending confirmations are in-memory and have a 10-minute TTL. Entries older than 10 minutes are cleaned up on each middleware call. Server restarts clear all pending state — user must re-confirm. Acceptable for an interactive flow.

## Preview Messages

### contactWrite — email_create_contact

```
========================================
      CONTACT PREVIEW
========================================

Action:  Create
Account: work (bo.d.lin.work@gmail.com)
Name:    Alice Smith
Email:   alice@example.com
Phone:   555-1234
Company: Acme
Title:   Engineer

========================================

Call email_create_contact again with the same parameters to confirm.
```

### contactWrite — email_update_contact

```
========================================
      CONTACT UPDATE PREVIEW
========================================

Action:  Update
Account: work (bo.d.lin.work@gmail.com)
Query:   alice@example.com
Changes: name → Alice Updated, phone → 555-5678

========================================

Call email_update_contact again with the same parameters to confirm.
```

### labelWrite — email_apply_label

```
Will add label "Important" to email abc123 in work account.
Call email_apply_label again with the same parameters to confirm.
```

## Migration from sendMode

When the server loads config and finds `sendMode` but no `permissions`:

1. Map `sendMode` value to `permissions.emailWrite` (confirm → confirm, auto → auto, blocked → blocked)
2. Set `permissions.contactWrite` to `"auto"` (default)
3. Set `permissions.labelWrite` to `"auto"` (default)
4. Remove `sendMode` from config
5. Save updated config

Existing users don't break. Migration happens once on first load.

## email_set_config Update

Update to support setting permissions:

```
email_set_config(key: "emailWrite", value: "auto")
email_set_config(key: "contactWrite", value: "confirm")
email_set_config(key: "labelWrite", value: "blocked")
```

Old `sendMode` key still accepted — mapped to `emailWrite` for backwards compatibility.

## Code Changes

| File | Change |
|------|--------|
| `src/tools.ts` | Add `TOOL_CATEGORIES`, `pendingConfirmations` Map, permission middleware, `generatePreview` function. Update `email_set_config` handler. Keep `approvedDrafts` for email draft+send flow. |
| `src/config.ts` | Replace `sendMode` with `permissions` in `AppConfig`. Add migration logic. Update defaults. |
| `src/providers/interface.ts` | Update `AppConfig` if defined here |
| `src/server.ts` | Update server instructions to mention permission levels |
| `README.md` | Replace sendMode docs with permissions table |

### Files NOT touched

- gmail.ts, outlook.ts — no provider changes
- contacts.ts — no changes
- factory.ts, keychain.ts, oauth files — no changes

## Out of Scope

- Per-account permissions (all accounts share the same permission levels)
- Per-tool permissions (only per-category)
- Client-side permission parameters (server-controlled only)
- UI for managing permissions (config.json + email_set_config only)
