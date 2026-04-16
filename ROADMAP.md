# Roadmap

## Completed

### v1.0.0 — Gmail Provider
- Gmail provider (search, read, send, labels, attachments)
- Multi-account support with nicknames
- OAuth token storage in macOS Keychain
- HTML emails with auto-detection (plain text default)
- Non-ASCII subject encoding (Chinese, Japanese, etc.)
- Primary inbox default with category filter
- Draft-before-send gate in confirm mode
- Contact lookup via Google People API with email history fallback
- add-account / remove-account CLI

### v1.1.0 — Outlook + Permissions + Contacts Write
- Outlook provider (Microsoft Graph API, device code OAuth)
- Per-category permissions system (emailWrite, contactWrite, labelWrite × auto/confirm/blocked)
- Server-enforced permission middleware
- Contact create/update for Gmail (People API) and Outlook (Graph)
- Gmail contact update merges with existing field values
- Old sendMode config auto-migrated to permissions on first load

## Paused

### IMAP Provider
- [ ] Generic IMAP provider (works with any email provider)
- [ ] Provider auto-detection from email domain

### Calendar Read Access
- [ ] Google Calendar API read-only
- [ ] Microsoft Graph calendar read-only

### Quality of Life
- [ ] Reply/forward support (thread awareness)
- [ ] Attachment sending (not just downloading)
- [ ] Scheduled send (send at a specified date/time)

## Design Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| macOS Keychain only | Cross-platform out of scope for v1 | 2026-04-13 |
| Plain text default, no HTML templates | Agent decides formatting; no hardcoded templates | 2026-04-15 |
| Server-enforced permissions | Cannot be bypassed by any client | 2026-04-15 |
| No destructive operations | No delete for emails/drafts/contacts; guide to web UI | 2026-04-15 |
| Draft gate enforced server-side | Prevent sends without preview in confirm mode | 2026-04-15 |
| Primary inbox by default | Filter out promotions/social unless explicitly requested | 2026-04-15 |
| Contact lookup with email history fallback | Google Contacts often empty; email history is more reliable | 2026-04-15 |
