# Contacts Write Access Design

**Date:** 2026-04-15
**Status:** Approved

## Overview

Add create and update operations to the contacts system. Two new MCP tools (`email_create_contact`, `email_update_contact`) alongside the existing read-only `email_lookup_contact`. No delete — destructive and no real use case for an email agent.

## New Tools

### email_create_contact

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account` | string | yes | Email or nickname — must target a specific account |
| `name` | string | yes | Contact display name |
| `email` | string | yes | Contact email address |
| `phone` | string | no | Phone number |
| `company` | string | no | Company name |
| `title` | string | no | Job title |

Returns: `{ success: true, message: "Contact created in {account}" }`

### email_update_contact

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account` | string | yes | Email or nickname |
| `email` | string | yes | Identifies which contact to update |
| `name` | string | no | New display name |
| `phone` | string | no | New phone number |
| `company` | string | no | New company name |
| `title` | string | no | New job title |

At least one optional field must be provided. Returns: `{ success: true, message: "Contact updated in {account}" }`

**Update lookup strategy:** Search contacts by email address using the provider's API, retrieve internal ID (Google `resourceName` / Graph contact `id`), then patch. If no contact found, return error suggesting `email_create_contact`.

## API Implementation

### Gmail (Google People API)

- **Create:** `people.createContact()` with `names`, `emailAddresses`, `phoneNumbers`, `organizations`
- **Update:** `people.searchContacts()` by email → get `resourceName` → `people.updateContact()` with `updatePersonFields` mask for only changed fields
- **Scope change:** `contacts.readonly` → `contacts` (read-write). Existing users must re-authenticate once.

### Outlook (Microsoft Graph)

- **Create:** `POST /me/contacts` with `givenName`, `emailAddresses`, `businessPhones`, `companyName`, `jobTitle`
- **Update:** `GET /me/contacts?$filter=emailAddresses/any(e:e/address eq '{email}')` → get contact `id` → `PATCH /me/contacts/{id}`
- **Scope change:** Add `Contacts.ReadWrite`. Existing users must re-authenticate once.

## Code Changes

### Files to modify

| File | Change |
|------|--------|
| `src/providers/contacts.ts` | Add `createContact()` and `updateContact()` router functions + provider-specific implementations |
| `src/providers/gmail.ts` | Add `gmailCreateContact()` and `gmailUpdateContact()` |
| `src/providers/outlook.ts` | Add `outlookCreateContact()` and `outlookUpdateContact()` |
| `src/tools.ts` | Register two new tool definitions |
| `src/server.ts` | Wire up two new tool handlers |
| `src/auth/oauth-gmail.ts` | Change scope from `contacts.readonly` to `contacts` |
| `src/providers/contacts.test.ts` | Add tests for create and update (both providers) |
| `README.md` | Add two new tools to the tools table |

### Files NOT touched

- `src/providers/interface.ts` — contacts stay separate from EmailProvider
- `src/types.ts` — no new shared types needed
- `config.json` — no config changes

### New type in contacts.ts

```typescript
interface ContactFields {
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
}
```

Used by both create and update. For create, `name` is required — enforced at the tool validation layer.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stale token (scope upgrade needed) | Return: "Re-run `evo-email-add-account` for {account} to grant contact write permissions" |
| Update: no contact found | Return: "No contact found with email {email}. Use email_create_contact instead." |
| Update: no fields provided | Reject before API call: "Provide at least one field to update" |
| Duplicate on create | Let the API handle it — both Google and Graph allow duplicates |

## Architecture Decision

Contacts remain in the separate `contacts.ts` module (not on the `EmailProvider` interface). Create/update follow the same router pattern as existing `lookupContact` — a top-level function dispatches to provider-specific implementations based on `acc.provider`.

## Out of Scope

- Delete contacts — destructive, no use case for email agent
- Contact groups / distribution lists
- Contact photos
- IMAP provider contacts (IMAP has no standard contacts API)
