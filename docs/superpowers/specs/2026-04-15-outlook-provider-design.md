# Outlook Provider — Design Spec
**Date:** 2026-04-15  
**Status:** Approved

---

## Overview

Phase 2 of the email MCP: add Outlook (Microsoft Graph API) as a second provider. The tool layer is unchanged — only a new auth module, a new provider adapter, and small updates to the factory and add-account script.

---

## Files Changed

| File | Change |
|------|--------|
| `credentials/outlook.json` | New (gitignored) — stores `client_id` + `client_secret` |
| `src/auth/oauth-outlook.ts` | New — raw OAuth2 flow, mirrors `oauth-gmail.ts` |
| `src/providers/outlook.ts` | New — Graph API adapter implementing `EmailProvider` |
| `src/factory.ts` | Wire up `OutlookProvider` in the switch statement |
| `scripts/add-account.ts` | Add outlook branch (mirrors gmail branch) |

---

## Credentials File

`credentials/outlook.json` — same pattern as `credentials/gmail.json`:

```json
{ "client_id": "<azure-application-id>", "client_secret": "<secret-value>" }
```

---

## OAuth2 Flow (`oauth-outlook.ts`)

Same structure as `oauth-gmail.ts`:

1. Load `credentials/outlook.json`
2. Build auth URL → `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
3. Open browser, spin up local HTTP server on `:3001` to catch redirect
4. Exchange code for tokens → `https://login.microsoftonline.com/common/oauth2/v2.0/token`
5. Fetch email via `GET https://graph.microsoft.com/v1.0/me`
6. Compute `expires_at = Date.now() + expires_in * 1000`, store alongside tokens in Keychain under `evo-email-mcp:outlook:<email>`
7. Export `getOutlookAuthClient(email)` — loads tokens from Keychain, refreshes via POST to token URL if `expires_at` is past, saves updated tokens back to Keychain

**Scopes:**

| Scope | Purpose |
|-------|---------|
| `Mail.ReadWrite` | Read, modify, delete messages |
| `Mail.Send` | Send emails |
| `User.Read` | Get email address after auth |
| `People.Read` | Contact lookup (primary source) |
| `offline_access` | Obtain refresh token |

---

## Graph API Adapter (`outlook.ts`)

Implements `EmailProvider`. Each method maps to a Graph endpoint:

| Method | Endpoint |
|--------|----------|
| `search(query)` | `GET /me/messages?$search="<q>"&$top=<n>` |
| `getEmail(id)` | `GET /me/messages/<id>` |
| `send(draft)` | `POST /me/sendMail` |
| `createDraft(draft)` | `POST /me/messages` (lands in Drafts folder) |
| `listLabels()` | `GET /me/mailFolders` |
| `applyLabel(id, label, action)` | `PATCH /me/messages/<id>` — moves to folder by ID |
| `downloadAttachment(emailId, attachmentId, savePath)` | `GET /me/messages/<emailId>/attachments/<attachmentId>` — content returned as base64 `contentBytes`, decoded and written to disk |

Token refresh: `getOutlookAuthClient` checks `expires_at` before every API call. If expired, POSTs to the token URL with `grant_type=refresh_token`, updates Keychain.

---

## Factory Update (`factory.ts`)

Replace the existing placeholder:

```typescript
case 'outlook':
  throw new Error('Provider not implemented: outlook (Phase 2)');
```

With:

```typescript
case 'outlook':
  return OutlookProvider.create(account.email);
```

---

## add-account Update (`scripts/add-account.ts`)

Replace the `process.exit(1)` fallback for outlook with a call to `runOutlookOAuthFlow()`, mirroring the gmail branch. Also fix the hardcoded `provider: 'gmail'` when writing to config — use the actual `provider` variable.

---

## Azure App Registration (Setup Steps)

One-time setup before running `npm run add-account -- --provider outlook`:

1. Go to **portal.azure.com** → Azure Active Directory → App registrations → **New registration**
2. Name: anything (e.g. `evo-email-mcp`)
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI: `http://localhost:3001/oauth/callback`
5. Click **Register** — copy the **Application (client) ID**
6. **Certificates & secrets** → New client secret → copy the value (shown once only)
7. **API permissions** → Add a permission → Microsoft Graph → Delegated → add: `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`
8. Save to `credentials/outlook.json`: `{ "client_id": "...", "client_secret": "..." }`

---

## Contact Lookup (`lookupContact`)

Same two-step pattern as Gmail:

1. **Primary:** `GET /me/people?$search="<query>"&$top=10` with `People.Read` scope — returns contacts ranked by relevance
2. **Fallback:** search email history via `GET /me/messages?$search="<query>"`, parse `from`/`to` headers — same logic as Gmail fallback (skip self, skip automated senders)

Lives in `src/providers/contacts.ts` alongside the existing Gmail implementation — add an `outlookLookupContact(email, query)` export. The `email_lookup_contact` tool in `tools.ts` already routes by provider via `getProvider()`, so no tool-layer changes needed beyond wiring up the new function.

---

## Out of Scope

- Contacts write access — deferred until all providers done
- IMAP provider — Phase 3
