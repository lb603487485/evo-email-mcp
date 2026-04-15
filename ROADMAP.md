# Roadmap

## Completed (Phase 1 - Gmail)

- Gmail provider (search, read, send, labels, attachments)
- Multi-account support with nicknames
- OAuth token storage in macOS Keychain
- HTML emails with Gmail-native template
- Markdown support in email body (bold, italic, headings, bullets)
- Non-ASCII subject encoding (Chinese, Japanese, etc.)
- Primary inbox default with category filter
- Draft-before-send gate in confirm mode
- Contact lookup via Google People API with email history fallback
- Provider-specific HTML templates (Gmail, Outlook stub, IMAP stub)
- add-account CLI with flags and interactive mode

## In Progress (Phase 1.5 - Dogfooding)

- [ ] Register MCP with Claude Code globally
- [ ] Use as primary email tool for daily work
- [ ] Collect friction points and missing features
- [ ] Fix issues before building Phase 2

## Planned

### Phase 2: Multi-provider

- [ ] Outlook provider with Outlook HTML template
- [ ] IMAP provider with default HTML template
- [ ] Provider auto-detection from email domain

### Phase 2.5: Contacts

- [ ] Write access to Google Contacts (create/update)
- [ ] Auto-save new recipients as contacts

### Phase 3: Quality of life

- [ ] Custom email signatures per account
- [ ] Reply/forward support (thread awareness)
- [ ] Attachment sending (not just downloading)

## Design Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| macOS Keychain only | Cross-platform out of scope for v1 | 2026-04-13 |
| People API read-only | Write access useful but not core focus; add later | 2026-04-15 |
| Gmail HTML template as default | Match native Gmail format so emails look normal | 2026-04-15 |
| Provider-specific templates | Gmail/Outlook/IMAP each have different native formats | 2026-04-15 |
| Draft gate enforced server-side | Prevent sends without preview in confirm mode | 2026-04-15 |
| Primary inbox by default | Filter out promotions/social unless explicitly requested | 2026-04-15 |
| Contact lookup with email history fallback | Google Contacts often empty; email history is more reliable | 2026-04-15 |
