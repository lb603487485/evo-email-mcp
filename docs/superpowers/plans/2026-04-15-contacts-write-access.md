# Contacts Write Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `email_create_contact` and `email_update_contact` tools to the MCP server, supporting both Gmail (Google People API) and Outlook (Microsoft Graph).

**Architecture:** Extend the existing `contacts.ts` router pattern — add `createContact()` and `updateContact()` functions that dispatch to provider-specific implementations in `gmail.ts` and `outlook.ts`. Upgrade OAuth scopes for both providers from read-only to read-write.

**Tech Stack:** TypeScript, Google People API (`googleapis`), Microsoft Graph REST API, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/providers/contacts.ts` | Modify | Add `ContactFields` type, `createContact()` and `updateContact()` routers, provider-specific implementations |
| `src/providers/contacts.test.ts` | Modify | Add tests for create and update (both providers) |
| `src/tools.ts:1-132` | Modify | Add two new tool definitions to `TOOL_DEFINITIONS` array |
| `src/tools.ts:142-302` | Modify | Add two new cases to `handleTool` switch |
| `src/auth/oauth-gmail.ts:10-13` | Modify | Change `contacts.readonly` scope to `contacts` |
| `src/auth/oauth-outlook.ts:11` | Modify | Add `Contacts.ReadWrite` to SCOPES |
| `README.md:111-124` | Modify | Add two new tools to the tools table |

---

## Task 1: Upgrade OAuth Scopes

**Files:**
- Modify: `src/auth/oauth-gmail.ts:10-13`
- Modify: `src/auth/oauth-outlook.ts:11`

- [ ] **Step 1: Update Gmail scope**

In `src/auth/oauth-gmail.ts`, change the SCOPES array:

```typescript
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts',
];
```

- [ ] **Step 2: Update Outlook scope**

In `src/auth/oauth-outlook.ts`, change the SCOPES string:

```typescript
const SCOPES = 'Mail.ReadWrite Mail.Send User.Read People.Read Contacts.ReadWrite offline_access';
```

- [ ] **Step 3: Build to verify no errors**

Run: `npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/auth/oauth-gmail.ts src/auth/oauth-outlook.ts
git commit -m "feat: upgrade OAuth scopes for contact write access"
```

---

## Task 2: Add ContactFields Type and Create/Update Routers

**Files:**
- Modify: `src/providers/contacts.ts`

- [ ] **Step 1: Add ContactFields interface and router functions**

Add after the existing `Contact` interface (line 10) in `src/providers/contacts.ts`:

```typescript
export interface ContactFields {
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
}

export async function createContact(acc: AccountConfig, fields: ContactFields): Promise<void> {
  if (acc.provider === 'outlook') return outlookCreateContact(acc.email, fields);
  return gmailCreateContact(acc.email, fields);
}

export async function updateContact(acc: AccountConfig, fields: ContactFields): Promise<void> {
  if (acc.provider === 'outlook') return outlookUpdateContact(acc.email, fields);
  return gmailUpdateContact(acc.email, fields);
}
```

- [ ] **Step 2: Add Gmail create implementation**

Add after the existing `gmailLookupContact` function:

```typescript
async function gmailCreateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const auth = await getGmailAuthClient(accountEmail);
  const people = google.people({ version: 'v1', auth });

  const requestBody: any = {
    names: [{ givenName: fields.name }],
    emailAddresses: [{ value: fields.email }],
  };
  if (fields.phone) requestBody.phoneNumbers = [{ value: fields.phone }];
  if (fields.company || fields.title) {
    requestBody.organizations = [{ name: fields.company, title: fields.title }];
  }

  await people.people.createContact({ requestBody });
}
```

- [ ] **Step 3: Add Gmail update implementation**

```typescript
async function gmailUpdateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const auth = await getGmailAuthClient(accountEmail);
  const people = google.people({ version: 'v1', auth });

  // Find contact by email
  const searchRes = await people.people.searchContacts({
    query: fields.email,
    readMask: 'names,emailAddresses',
    pageSize: 10,
  });

  let resourceName: string | undefined;
  for (const result of searchRes.data.results ?? []) {
    const emails = result.person?.emailAddresses ?? [];
    if (emails.some(e => e.value?.toLowerCase() === fields.email.toLowerCase())) {
      resourceName = result.person?.resourceName;
      break;
    }
  }

  if (!resourceName) {
    throw new Error(`No contact found with email ${fields.email}. Use email_create_contact instead.`);
  }

  // Get current contact to retrieve etag
  const current = await people.people.get({
    resourceName,
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
  });

  const updatePersonFields: string[] = [];
  const requestBody: any = { etag: current.data.etag };

  if (fields.name) {
    requestBody.names = [{ givenName: fields.name }];
    updatePersonFields.push('names');
  }
  if (fields.phone) {
    requestBody.phoneNumbers = [{ value: fields.phone }];
    updatePersonFields.push('phoneNumbers');
  }
  if (fields.company || fields.title) {
    requestBody.organizations = [{
      name: fields.company,
      title: fields.title,
    }];
    updatePersonFields.push('organizations');
  }

  await people.people.updateContact({
    resourceName,
    updatePersonFields: updatePersonFields.join(','),
    requestBody,
  });
}
```

- [ ] **Step 4: Add Outlook create implementation**

Add after the existing `outlookLookupContact` function:

```typescript
async function outlookCreateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const { accessToken } = await getOutlookAuthClient(accountEmail);

  const body: any = {
    givenName: fields.name,
    emailAddresses: [{ address: fields.email, name: fields.name ?? fields.email }],
  };
  if (fields.phone) body.businessPhones = [fields.phone];
  if (fields.company) body.companyName = fields.company;
  if (fields.title) body.jobTitle = fields.title;

  const res = await fetch('https://graph.microsoft.com/v1.0/me/contacts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Create contact failed: ${await res.text()}`);
}
```

- [ ] **Step 5: Add Outlook update implementation**

```typescript
async function outlookUpdateContact(accountEmail: string, fields: ContactFields): Promise<void> {
  const { accessToken } = await getOutlookAuthClient(accountEmail);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Find contact by email
  const searchRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/contacts?$filter=emailAddresses/any(e:e/address eq '${fields.email}')&$top=1`,
    { headers }
  );
  if (!searchRes.ok) throw new Error(`Contact search failed: ${await searchRes.text()}`);
  const searchData = await searchRes.json() as { value: Array<{ id: string }> };

  if (!searchData.value?.length) {
    throw new Error(`No contact found with email ${fields.email}. Use email_create_contact instead.`);
  }

  const contactId = searchData.value[0].id;
  const body: any = {};
  if (fields.name) body.givenName = fields.name;
  if (fields.phone) body.businessPhones = [fields.phone];
  if (fields.company) body.companyName = fields.company;
  if (fields.title) body.jobTitle = fields.title;

  const patchRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/contacts/${contactId}`,
    { method: 'PATCH', headers, body: JSON.stringify(body) }
  );
  if (!patchRes.ok) throw new Error(`Update contact failed: ${await patchRes.text()}`);
}
```

- [ ] **Step 6: Build to verify no errors**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 7: Commit**

```bash
git add src/providers/contacts.ts
git commit -m "feat: add createContact and updateContact for Gmail and Outlook"
```

---

## Task 3: Write Tests for Create and Update

**Files:**
- Modify: `src/providers/contacts.test.ts`

- [ ] **Step 1: Update the googleapis mock to support People API write operations**

Add to the existing `vi.mock('googleapis')` block — extend the mock to include `createContact`, `updateContact`, and `get`:

```typescript
vi.mock('googleapis', () => ({
  google: {
    people: vi.fn(() => ({
      people: {
        searchContacts: vi.fn().mockResolvedValue({ data: { results: [] } }),
        createContact: vi.fn().mockResolvedValue({}),
        updateContact: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ data: { etag: 'etag123' } }),
      },
    })),
    gmail: vi.fn(() => ({
      users: { messages: { list: vi.fn().mockResolvedValue({ data: { messages: [] } }) } },
    })),
  },
}));
```

- [ ] **Step 2: Import the new functions**

Update the import:

```typescript
import { lookupContact, createContact, updateContact } from './contacts';
```

- [ ] **Step 3: Add Gmail create contact test**

```typescript
describe('createContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls Gmail People API createContact for gmail accounts', async () => {
    await createContact({ email: 'work@gmail.com', provider: 'gmail' }, {
      email: 'alice@example.com',
      name: 'Alice Smith',
      phone: '555-1234',
      company: 'Acme',
      title: 'Engineer',
    });
    // No fetch call — gmail uses googleapis
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls Graph API POST /me/contacts for outlook accounts', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ id: 'new-contact-id' }));
    await createContact({ email: 'me@outlook.com', provider: 'outlook' }, {
      email: 'alice@example.com',
      name: 'Alice Smith',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/contacts',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

- [ ] **Step 4: Add update contact tests**

```typescript
describe('updateContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls Gmail People API searchContacts then updateContact for gmail accounts', async () => {
    // Mock searchContacts to find a contact
    const { google } = await import('googleapis');
    const peopleMock = google.people() as any;
    peopleMock.people.searchContacts.mockResolvedValueOnce({
      data: {
        results: [{
          person: {
            resourceName: 'people/123',
            emailAddresses: [{ value: 'alice@example.com' }],
          },
        }],
      },
    });

    await updateContact({ email: 'work@gmail.com', provider: 'gmail' }, {
      email: 'alice@example.com',
      name: 'Alice Updated',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls Graph API PATCH /me/contacts/{id} for outlook accounts', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOk({ value: [{ id: 'contact-123' }] })) // search
      .mockResolvedValueOnce(mockOk({})); // patch
    await updateContact({ email: 'me@outlook.com', provider: 'outlook' }, {
      email: 'alice@example.com',
      name: 'Alice Updated',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://graph.microsoft.com/v1.0/me/contacts/contact-123',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('throws when no contact found for outlook update', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ value: [] }));
    await expect(
      updateContact({ email: 'me@outlook.com', provider: 'outlook' }, {
        email: 'unknown@example.com',
        name: 'Nobody',
      })
    ).rejects.toThrow('No contact found with email unknown@example.com');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/providers/contacts.test.ts
git commit -m "test: add create and update contact tests for Gmail and Outlook"
```

---

## Task 4: Register Tools and Wire Up Handlers

**Files:**
- Modify: `src/tools.ts:7-132` (TOOL_DEFINITIONS array)
- Modify: `src/tools.ts:142-302` (handleTool switch)

- [ ] **Step 1: Add tool definitions**

Add these two entries to the `TOOL_DEFINITIONS` array in `src/tools.ts`, after `email_lookup_contact` (line 119):

```typescript
  {
    name: 'email_create_contact',
    description: 'Create a new contact in a specific account. IMPORTANT: account is required — ask the user which account if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account nickname or email (required)' },
        name: { type: 'string', description: 'Contact display name' },
        email: { type: 'string', description: 'Contact email address' },
        phone: { type: 'string', description: 'Phone number (optional)' },
        company: { type: 'string', description: 'Company name (optional)' },
        title: { type: 'string', description: 'Job title (optional)' },
      },
      required: ['account', 'name', 'email'],
    },
  },
  {
    name: 'email_update_contact',
    description: 'Update an existing contact identified by email address. Provide only the fields to change. IMPORTANT: account is required — ask the user which account if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account nickname or email (required)' },
        email: { type: 'string', description: 'Email address of the contact to update' },
        name: { type: 'string', description: 'New display name (optional)' },
        phone: { type: 'string', description: 'New phone number (optional)' },
        company: { type: 'string', description: 'New company name (optional)' },
        title: { type: 'string', description: 'New job title (optional)' },
      },
      required: ['account', 'email'],
    },
  },
```

- [ ] **Step 2: Update imports in tools.ts**

Change the contacts import at top of `src/tools.ts`:

```typescript
import { lookupContact, createContact, updateContact } from './providers/contacts';
```

- [ ] **Step 3: Add handler cases**

Add these cases to the `handleTool` switch in `src/tools.ts`, before the `email_set_config` case:

```typescript
    case 'email_create_contact': {
      const { account, ...fields } = args as {
        account: string; name: string; email: string;
        phone?: string; company?: string; title?: string;
      };
      const acc = getAccount(config, account);
      await createContact(acc, fields);
      return `Contact "${fields.name}" <${fields.email}> created in ${acc.email}.`;
    }

    case 'email_update_contact': {
      const { account, email, name, phone, company, title } = args as {
        account: string; email: string;
        name?: string; phone?: string; company?: string; title?: string;
      };
      if (!name && !phone && !company && !title) {
        return 'Provide at least one field to update (name, phone, company, or title).';
      }
      const acc = getAccount(config, account);
      await updateContact(acc, { email, name, phone, company, title });
      return `Contact <${email}> updated in ${acc.email}.`;
    }
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts
git commit -m "feat: register email_create_contact and email_update_contact tools"
```

---

## Task 5: Update README

**Files:**
- Modify: `README.md:111-124`

- [ ] **Step 1: Add new tools to the table**

In the Available Tools table in `README.md`, add two rows after `email_lookup_contact`:

```markdown
| `email_create_contact` | Create a new contact (name, email, phone, company, title) |
| `email_update_contact` | Update an existing contact by email address |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add create and update contact tools to README"
```

---

## Task 6: Build + Full Test Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (existing 36 + new contact tests).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Verify tool count**

Run: `grep -c "name: 'email_" src/tools.ts`
Expected: `12` (10 existing + 2 new).

---

## Task 7: Live Smoke Test

- [ ] **Step 1: Rebuild and restart Claude Code**

```bash
npm run build
```

Then restart Claude Code to pick up the new tools.

- [ ] **Step 2: Test create contact (Gmail)**

Ask Claude: "Create a contact named Test Contact with email test-contact@example.com in my work account"
Expected: Claude calls `email_create_contact`, contact is created.

- [ ] **Step 3: Test update contact (Gmail)**

Ask Claude: "Update the contact test-contact@example.com — change the name to Test Updated"
Expected: Claude calls `email_update_contact`, contact is updated.

- [ ] **Step 4: Test create contact (Outlook)**

Ask Claude: "Create a contact named Outlook Test with email outlook-test@example.com in my outlook work account"
Expected: Contact created in Outlook account.

- [ ] **Step 5: Test error case — update non-existent contact**

Ask Claude: "Update the contact nobody@nonexistent.com in my work account — change name to Nobody"
Expected: Error message suggesting `email_create_contact` instead.

- [ ] **Step 6: Final commit**

```bash
git commit -m "feat: contacts write access complete — create and update for Gmail and Outlook"
```

**Note:** After upgrading scopes, existing accounts need to re-authenticate. Run `evo-email-add-account` for each account to grant the new permissions.
