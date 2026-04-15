# Outlook Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Outlook as a second email provider via Microsoft Graph API, with full feature parity to Gmail (search, send, draft, labels, attachments, contact lookup).

**Architecture:** Raw OAuth2 flow (no MSAL) mirroring oauth-gmail.ts. OutlookProvider implements EmailProvider interface — tools.ts and factory.ts need no logic changes. Contact lookup is added to contacts.ts as an Outlook-aware branch alongside Gmail.

**Tech Stack:** Node.js native `fetch` (Node 18+), Microsoft Graph API v1.0, existing keychain/config infrastructure.

---

## File Map

| File | Change |
|------|--------|
| `src/auth/oauth-outlook.ts` | **New** — OAuth2 flow: browser auth, token exchange, refresh |
| `src/auth/oauth-outlook.test.ts` | **New** — tests for `getOutlookAuthClient` token refresh logic |
| `src/providers/outlook.ts` | **New** — Graph API adapter implementing `EmailProvider` |
| `src/providers/outlook.test.ts` | **New** — unit tests for OutlookProvider methods |
| `src/providers/contacts.ts` | **Modify** — add `outlookLookupContact`, make `lookupContact` provider-aware |
| `src/factory.ts` | **Modify** — wire up OutlookProvider (3-line change) |
| `src/factory.test.ts` | **Modify** — change outlook test from "throws" to "returns provider" |
| `scripts/add-account.ts` | **Modify** — add outlook branch, fix hardcoded `provider: 'gmail'` |
| `src/tools.ts` | **Modify** — pass `acc` (AccountConfig) instead of `acc.email` to `lookupContact` |

No new npm dependencies. `fetch` is a Node 18+ global; `@types/node@^20` (already installed) provides its types.

---

### Task 1: `src/auth/oauth-outlook.ts`

**Files:**
- Create: `src/auth/oauth-outlook.ts`
- Create: `src/auth/oauth-outlook.test.ts`

- [ ] **Step 1: Write failing tests for `getOutlookAuthClient`**

Create `src/auth/oauth-outlook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(
    JSON.stringify({ client_id: 'test-client', client_secret: 'test-secret' })
  ),
  writeFileSync: vi.fn(),
}));

vi.mock('./keychain', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { getToken, setToken } from './keychain';
import { getOutlookAuthClient } from './oauth-outlook';

const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockSetToken = setToken as ReturnType<typeof vi.fn>;

describe('getOutlookAuthClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no credentials in keychain', async () => {
    mockGetToken.mockResolvedValue(null);
    await expect(getOutlookAuthClient('me@outlook.com')).rejects.toThrow(
      'No Outlook credentials for me@outlook.com'
    );
  });

  it('returns stored access token when not expired', async () => {
    mockGetToken.mockResolvedValue({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600_000,
    });
    const client = await getOutlookAuthClient('me@outlook.com');
    expect(client.accessToken).toBe('valid-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes token when expired and saves updated tokens', async () => {
    mockGetToken.mockResolvedValue({
      access_token: 'old-token',
      refresh_token: 'my-refresh-token',
      expires_at: Date.now() - 1000,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    });
    const client = await getOutlookAuthClient('me@outlook.com');
    expect(client.accessToken).toBe('new-token');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('oauth2/v2.0/token'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockSetToken).toHaveBeenCalledWith(
      'outlook',
      'me@outlook.com',
      expect.objectContaining({ access_token: 'new-token', refresh_token: 'new-refresh-token' })
    );
  });

  it('keeps old refresh token if new response omits it', async () => {
    mockGetToken.mockResolvedValue({
      access_token: 'old-token',
      refresh_token: 'original-refresh',
      expires_at: Date.now() - 1000,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        access_token: 'new-token',
        expires_in: 3600,
        // no refresh_token in response
      }),
    });
    await getOutlookAuthClient('me@outlook.com');
    expect(mockSetToken).toHaveBeenCalledWith(
      'outlook',
      'me@outlook.com',
      expect.objectContaining({ refresh_token: 'original-refresh' })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/evolin1/Desktop/AICoding/evo-email-mcp && npm test -- src/auth/oauth-outlook.test.ts
```

Expected: FAIL with "Cannot find module './oauth-outlook'"

- [ ] **Step 3: Implement `src/auth/oauth-outlook.ts`**

```typescript
import { readFileSync } from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { getToken, setToken } from './keychain';

const REDIRECT_URI = 'http://localhost:3001/oauth/callback';
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES = 'Mail.ReadWrite Mail.Send User.Read People.Read offline_access';

interface OutlookCredentialsFile {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function loadCredentials(): { clientId: string; clientSecret: string } {
  const credPath = path.join(__dirname, '../../credentials/outlook.json');
  const file = JSON.parse(readFileSync(credPath, 'utf-8')) as OutlookCredentialsFile;
  return { clientId: file.client_id, clientSecret: file.client_secret };
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function runOutlookOAuthFlow(): Promise<string> {
  const { clientId, clientSecret } = loadCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_mode: 'query',
  });

  console.log('\nOpening browser for Microsoft authorization...');
  await open(`${AUTH_URL}?${params.toString()}`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3001');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization complete. You can close this tab.</h1>');
      server.close();
      const error = url.searchParams.get('error');
      const c = url.searchParams.get('code');
      if (error) reject(new Error(`OAuth error: ${error}`));
      else if (c) resolve(c);
      else reject(new Error('No authorization code received'));
    });
    server.listen(3001);
    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('OAuth flow timed out')); }, 120_000);
  });

  const tokens = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Failed to fetch profile: ${await profileRes.text()}`);
  const profile = await profileRes.json() as { mail?: string; userPrincipalName?: string };
  const email = (profile.mail ?? profile.userPrincipalName)!;

  await setToken('outlook', email, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  });

  console.log(`\nAuthorized: ${email}`);
  return email;
}

export async function getOutlookAuthClient(email: string): Promise<{ accessToken: string }> {
  const { clientId, clientSecret } = loadCredentials();
  const stored = await getToken('outlook', email);
  if (!stored) throw new Error(`No Outlook credentials for ${email}. Run: npm run add-account`);

  const { access_token, refresh_token, expires_at } = stored as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  if (Date.now() >= expires_at - 60_000) {
    const tokens = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token,
      grant_type: 'refresh_token',
    });
    const updated = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    };
    await setToken('outlook', email, updated);
    return { accessToken: tokens.access_token };
  }

  return { accessToken: access_token };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/auth/oauth-outlook.test.ts
```

Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/auth/oauth-outlook.ts src/auth/oauth-outlook.test.ts
git commit -m "feat: add Outlook OAuth2 flow with token refresh"
```

---

### Task 2: `src/providers/outlook.ts`

**Files:**
- Create: `src/providers/outlook.ts`
- Create: `src/providers/outlook.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/providers/outlook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/oauth-outlook', () => ({
  getOutlookAuthClient: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OutlookProvider } from './outlook';

function mockOk(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('OutlookProvider.search', () => {
  let provider: OutlookProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await OutlookProvider.create('me@outlook.com');
  });

  it('returns empty array when no messages', async () => {
    mockFetch.mockResolvedValue(mockOk({ value: [] }));
    expect(await provider.search({ q: 'from:nobody' })).toEqual([]);
  });

  it('passes encoded query and $top to Graph API', async () => {
    mockFetch.mockResolvedValue(mockOk({ value: [] }));
    await provider.search({ q: 'is:unread', maxResults: 5 });
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('is%3Aunread');
    expect(url).toContain('$top=5');
  });

  it('maps Graph message fields to Email interface', async () => {
    mockFetch.mockResolvedValue(mockOk({
      value: [{
        id: 'msg1',
        conversationId: 'thread1',
        from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
        toRecipients: [{ emailAddress: { name: 'Me', address: 'me@outlook.com' } }],
        subject: 'Hello',
        body: { contentType: 'Text', content: 'Hi there' },
        receivedDateTime: '2026-04-15T10:00:00Z',
        categories: ['Work'],
        hasAttachments: false,
      }],
    }));
    const emails = await provider.search({ q: 'from:alice' });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      id: 'msg1',
      threadId: 'thread1',
      account: 'me@outlook.com',
      provider: 'outlook',
      from: { name: 'Alice', email: 'alice@example.com' },
      subject: 'Hello',
      body: 'Hi there',
      labels: ['Work'],
    });
  });
});

describe('OutlookProvider.send', () => {
  let provider: OutlookProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await OutlookProvider.create('me@outlook.com');
  });

  it('calls /me/sendMail with correct JSON body', async () => {
    mockFetch.mockResolvedValue(mockOk(null, 202));
    await provider.send({ from: 'me@outlook.com', to: 'alice@example.com', subject: 'Hi', body: 'Hello' });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/sendMail');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.message.subject).toBe('Hi');
    expect(body.message.toRecipients[0].emailAddress.address).toBe('alice@example.com');
    expect(body.message.body.contentType).toBe('Text');
  });

  it('accepts array of recipients', async () => {
    mockFetch.mockResolvedValue(mockOk(null, 202));
    await provider.send({ from: 'me@outlook.com', to: ['a@x.com', 'b@x.com'], subject: 'Hi', body: 'Hello' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message.toRecipients).toHaveLength(2);
  });

  it('sends HTML body with contentType HTML', async () => {
    mockFetch.mockResolvedValue(mockOk(null, 202));
    await provider.send({ from: 'me@outlook.com', to: 'b@x.com', subject: 'Hi', body: '<b>Hello</b>' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message.body.contentType).toBe('HTML');
  });
});

describe('OutlookProvider.listLabels', () => {
  let provider: OutlookProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await OutlookProvider.create('me@outlook.com');
  });

  it('returns mail folders as labels', async () => {
    mockFetch.mockResolvedValue(mockOk({
      value: [
        { id: 'AAMk...inbox', displayName: 'Inbox' },
        { id: 'AAMk...sent', displayName: 'Sent Items' },
      ],
    }));
    const labels = await provider.listLabels();
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({ id: 'AAMk...inbox', name: 'Inbox' });
  });
});

describe('OutlookProvider.applyLabel', () => {
  let provider: OutlookProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await OutlookProvider.create('me@outlook.com');
  });

  it('moves to folder on add', async () => {
    mockFetch.mockResolvedValue(mockOk({}, 200));
    await provider.applyLabel('msg1', 'folder-id-123', 'add');
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/messages/msg1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ parentFolderId: 'folder-id-123' });
  });

  it('moves to inbox on remove', async () => {
    mockFetch.mockResolvedValue(mockOk({}, 200));
    await provider.applyLabel('msg1', 'folder-id-123', 'remove');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ parentFolderId: 'inbox' });
  });
});

describe('OutlookProvider.downloadAttachment', () => {
  let provider: OutlookProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await OutlookProvider.create('me@outlook.com');
  });

  it('decodes base64 contentBytes and writes to disk', async () => {
    const writeFileSyncMock = vi.fn();
    vi.mock('fs', () => ({ writeFileSync: writeFileSyncMock }));

    mockFetch.mockResolvedValue(mockOk({
      id: 'att1',
      name: 'file.txt',
      contentType: 'text/plain',
      size: 5,
      contentBytes: Buffer.from('hello').toString('base64'),
    }));

    await provider.downloadAttachment('msg1', 'att1', '/tmp/file.txt');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/me/messages/msg1/attachments/att1'),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/providers/outlook.test.ts
```

Expected: FAIL with "Cannot find module './outlook'"

- [ ] **Step 3: Implement `src/providers/outlook.ts`**

```typescript
import { writeFileSync } from 'fs';
import { getOutlookAuthClient } from '../auth/oauth-outlook';
import { Email, EmailProvider, SearchQuery, Draft, Label } from './interface';

type GraphEmailAddress = { emailAddress: { name?: string; address: string } };

interface GraphMessage {
  id: string;
  conversationId: string;
  from: GraphEmailAddress;
  toRecipients: GraphEmailAddress[];
  subject: string;
  body: { contentType: string; content: string };
  receivedDateTime: string;
  categories: string[];
  hasAttachments: boolean;
  attachments?: GraphAttachment[];
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes?: string;
}

export class OutlookProvider implements EmailProvider {
  private accessToken: string;
  private email: string;

  private constructor(accessToken: string, email: string) {
    this.accessToken = accessToken;
    this.email = email;
  }

  static async create(email: string): Promise<OutlookProvider> {
    const { accessToken } = await getOutlookAuthClient(email);
    return new OutlookProvider(accessToken, email);
  }

  private async graphGet<T>(path: string): Promise<T> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async graphPost(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  }

  private async graphPatch(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  }

  async search(query: SearchQuery): Promise<Email[]> {
    const top = query.maxResults ?? 20;
    const data = await this.graphGet<{ value: GraphMessage[] }>(
      `/me/messages?$search="${encodeURIComponent(query.q)}"&$top=${top}`
    );
    return (data.value ?? []).map(m => this.parseMessage(m));
  }

  async getEmail(id: string): Promise<Email> {
    const msg = await this.graphGet<GraphMessage>(`/me/messages/${id}?$expand=attachments`);
    return this.parseMessage(msg);
  }

  async send(draft: Draft): Promise<void> {
    const to = Array.isArray(draft.to) ? draft.to : [draft.to];
    await this.graphPost('/me/sendMail', {
      message: {
        subject: draft.subject,
        body: { contentType: isHtml(draft.body) ? 'HTML' : 'Text', content: draft.body },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })),
      },
    });
  }

  async createDraft(draft: Draft): Promise<Draft> {
    const to = Array.isArray(draft.to) ? draft.to : [draft.to];
    await this.graphPost('/me/messages', {
      subject: draft.subject,
      body: { contentType: isHtml(draft.body) ? 'HTML' : 'Text', content: draft.body },
      toRecipients: to.map(a => ({ emailAddress: { address: a } })),
    });
    return draft;
  }

  async listLabels(): Promise<Label[]> {
    const data = await this.graphGet<{ value: Array<{ id: string; displayName: string }> }>('/me/mailFolders');
    return (data.value ?? []).map(f => ({ id: f.id, name: f.displayName }));
  }

  async applyLabel(id: string, label: string, action: 'add' | 'remove'): Promise<void> {
    await this.graphPatch(`/me/messages/${id}`, {
      parentFolderId: action === 'add' ? label : 'inbox',
    });
  }

  async downloadAttachment(emailId: string, attachmentId: string, savePath: string): Promise<void> {
    const attachment = await this.graphGet<GraphAttachment>(
      `/me/messages/${emailId}/attachments/${attachmentId}`
    );
    if (!attachment.contentBytes) throw new Error('Attachment has no content');
    writeFileSync(savePath, Buffer.from(attachment.contentBytes, 'base64'));
  }

  private parseMessage(msg: GraphMessage): Email {
    return {
      id: msg.id,
      threadId: msg.conversationId,
      account: this.email,
      provider: 'outlook',
      from: {
        name: msg.from?.emailAddress?.name,
        email: msg.from?.emailAddress?.address ?? '',
      },
      to: (msg.toRecipients ?? []).map(r => ({
        name: r.emailAddress?.name,
        email: r.emailAddress?.address ?? '',
      })),
      subject: msg.subject ?? '',
      body: msg.body?.content ?? '',
      date: new Date(msg.receivedDateTime),
      labels: msg.categories ?? [],
      attachments: (msg.attachments ?? []).map(a => ({
        id: a.id,
        filename: a.name,
        mimeType: a.contentType,
        size: a.size,
      })),
    };
  }
}

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/providers/outlook.test.ts
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/providers/outlook.ts src/providers/outlook.test.ts
git commit -m "feat: add OutlookProvider implementing EmailProvider via Graph API"
```

---

### Task 3: Contact lookup for Outlook

**Files:**
- Modify: `src/providers/contacts.ts`
- Modify: `src/tools.ts` (1-line change)

- [ ] **Step 1: Write failing tests**

Add to the existing `contacts.ts` test file (or create `src/providers/contacts.test.ts` if it doesn't exist yet):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/oauth-gmail', () => ({
  getGmailAuthClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('../auth/oauth-outlook', () => ({
  getOutlookAuthClient: vi.fn().mockResolvedValue({ accessToken: 'outlook-token' }),
}));

vi.mock('googleapis', () => ({
  google: {
    people: vi.fn(() => ({
      people: { searchContacts: vi.fn().mockResolvedValue({ data: { results: [] } }) },
    })),
    gmail: vi.fn(() => ({
      users: { messages: { list: vi.fn().mockResolvedValue({ data: { messages: [] } }) } },
    })),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { lookupContact } from './contacts';

function mockOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('lookupContact router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses gmail path for gmail accounts', async () => {
    const results = await lookupContact({ email: 'work@gmail.com', provider: 'gmail' }, 'alice');
    // gmail path uses googleapis (no fetch), so fetch should not be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses outlook path for outlook accounts', async () => {
    mockFetch.mockResolvedValue(mockOk({ value: [] }));
    await lookupContact({ email: 'me@outlook.com', provider: 'outlook' }, 'alice');
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('outlookLookupContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns contacts from People API', async () => {
    mockFetch.mockResolvedValue(mockOk({
      value: [{
        displayName: 'Alice Smith',
        scoredEmailAddresses: [{ address: 'alice@example.com' }],
      }],
    }));
    const results = await lookupContact({ email: 'me@outlook.com', provider: 'outlook' }, 'alice');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ name: 'Alice Smith', email: 'alice@example.com', source: 'contacts' });
  });

  it('falls back to email history when People API returns empty', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOk({ value: [] })) // People API empty
      .mockResolvedValueOnce(mockOk({               // email history
        value: [{
          from: { emailAddress: { name: 'Alice Smith', address: 'alice@example.com' } },
          toRecipients: [],
        }],
      }));
    const results = await lookupContact({ email: 'me@outlook.com', provider: 'outlook' }, 'alice');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('email_history');
  });

  it('skips self in email history fallback', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOk({ value: [] }))
      .mockResolvedValueOnce(mockOk({
        value: [{
          from: { emailAddress: { name: 'Me', address: 'me@outlook.com' } },
          toRecipients: [],
        }],
      }));
    const results = await lookupContact({ email: 'me@outlook.com', provider: 'outlook' }, 'me');
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/providers/contacts.test.ts
```

Expected: FAIL (contacts.ts doesn't export provider-aware `lookupContact` yet)

- [ ] **Step 3: Update `src/providers/contacts.ts`**

Replace the entire file:

```typescript
import { google } from 'googleapis';
import { getGmailAuthClient } from '../auth/oauth-gmail';
import { getOutlookAuthClient } from '../auth/oauth-outlook';
import { AccountConfig } from './interface';

export interface Contact {
  name: string;
  email: string;
  source: 'contacts' | 'email_history';
}

type GraphEmailAddress = { emailAddress: { name?: string; address: string } };

export async function lookupContact(acc: AccountConfig, query: string): Promise<Contact[]> {
  if (acc.provider === 'outlook') return outlookLookupContact(acc.email, query);
  return gmailLookupContact(acc.email, query);
}

async function gmailLookupContact(email: string, query: string): Promise<Contact[]> {
  const auth = await getGmailAuthClient(email);

  const people = google.people({ version: 'v1', auth });
  const res = await people.people.searchContacts({
    query,
    readMask: 'names,emailAddresses',
    pageSize: 10,
  });

  const results: Contact[] = [];
  for (const result of res.data.results ?? []) {
    const person = result.person;
    if (!person) continue;
    const name = person.names?.[0]?.displayName ?? '';
    for (const e of person.emailAddresses ?? []) {
      if (e.value) results.push({ name, email: e.value, source: 'contacts' });
    }
  }

  if (results.length > 0) return results;

  const gmail = google.gmail({ version: 'v1', auth });
  const searchRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 });

  const seen = new Set<string>();
  for (const msg of searchRes.data.messages ?? []) {
    const full = await gmail.users.messages.get({
      userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'To'],
    });
    const headers: Array<{ name: string; value: string }> = (full.data.payload?.headers ?? []) as any;
    for (const h of headers) {
      if (h.name !== 'From' && h.name !== 'To') continue;
      for (const addr of h.value.split(',')) {
        const match = addr.match(/(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?/);
        if (!match) continue;
        const name = (match[1] || '').trim();
        const emailAddr = match[2].trim().toLowerCase();
        if (emailAddr === email.toLowerCase()) continue;
        if (/^(no-?reply|noreply|notifications?|mailer-daemon|postmaster)@/i.test(emailAddr)) continue;
        if (/@(linkedin\.com|zoom\.us|glassdoor\.com|github\.com|google\.com|googlemail\.com)$/i.test(emailAddr) && !emailAddr.includes(query.toLowerCase())) continue;
        if ((name.toLowerCase().includes(query.toLowerCase()) || emailAddr.includes(query.toLowerCase())) && !seen.has(emailAddr)) {
          seen.add(emailAddr);
          results.push({ name: name || emailAddr, email: emailAddr, source: 'email_history' });
        }
      }
    }
  }

  return results;
}

async function outlookLookupContact(email: string, query: string): Promise<Contact[]> {
  const { accessToken } = await getOutlookAuthClient(email);
  const headers = { Authorization: `Bearer ${accessToken}` };

  const peopleRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/people?$search="${encodeURIComponent(query)}"&$top=10`,
    { headers }
  );
  if (!peopleRes.ok) throw new Error(`People API error: ${await peopleRes.text()}`);
  const peopleData = await peopleRes.json() as {
    value: Array<{ displayName: string; scoredEmailAddresses: Array<{ address: string }> }>;
  };

  const results: Contact[] = [];
  for (const person of peopleData.value ?? []) {
    for (const e of person.scoredEmailAddresses ?? []) {
      if (e.address) results.push({ name: person.displayName, email: e.address, source: 'contacts' });
    }
  }

  if (results.length > 0) return results;

  const msgRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=10&$select=from,toRecipients`,
    { headers }
  );
  if (!msgRes.ok) throw new Error(`Messages API error: ${await msgRes.text()}`);
  const msgData = await msgRes.json() as {
    value: Array<{ from: GraphEmailAddress; toRecipients: GraphEmailAddress[] }>;
  };

  const seen = new Set<string>();
  const queryLower = query.toLowerCase();
  for (const msg of msgData.value ?? []) {
    const addresses: GraphEmailAddress[] = [msg.from, ...(msg.toRecipients ?? [])].filter(Boolean);
    for (const addr of addresses) {
      const address = addr?.emailAddress?.address?.toLowerCase();
      const name = addr?.emailAddress?.name ?? '';
      if (!address) continue;
      if (address === email.toLowerCase()) continue;
      if (/^(no-?reply|noreply|notifications?|mailer-daemon|postmaster)@/i.test(address)) continue;
      if ((name.toLowerCase().includes(queryLower) || address.includes(queryLower)) && !seen.has(address)) {
        seen.add(address);
        results.push({ name: name || address, email: address, source: 'email_history' });
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Update `src/tools.ts` — 1-line change**

In `tools.ts`, find the `email_lookup_contact` case. Change:

```typescript
const contacts = await lookupContact(acc.email, contactName);
```

To:

```typescript
const contacts = await lookupContact(acc, contactName);
```

- [ ] **Step 5: Run all tests to verify passing**

```bash
npm test
```

Expected: all existing + new tests passing

- [ ] **Step 6: Commit**

```bash
git add src/providers/contacts.ts src/providers/contacts.test.ts src/tools.ts
git commit -m "feat: add Outlook contact lookup, make lookupContact provider-aware"
```

---

### Task 4: Wire up factory

**Files:**
- Modify: `src/factory.ts`
- Modify: `src/factory.test.ts`

- [ ] **Step 1: Update `src/factory.test.ts`**

Replace the outlook test from "throws" to "creates provider":

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./providers/gmail', () => ({
  GmailProvider: { create: vi.fn().mockResolvedValue({ _provider: 'gmail' }) },
}));

vi.mock('./providers/outlook', () => ({
  OutlookProvider: { create: vi.fn().mockResolvedValue({ _provider: 'outlook' }) },
}));

import { getProvider } from './factory';
import { GmailProvider } from './providers/gmail';
import { OutlookProvider } from './providers/outlook';

describe('getProvider', () => {
  it('returns GmailProvider for gmail accounts', async () => {
    await getProvider({ email: 'work@gmail.com', provider: 'gmail' });
    expect(GmailProvider.create).toHaveBeenCalledWith('work@gmail.com');
  });

  it('returns OutlookProvider for outlook accounts', async () => {
    await getProvider({ email: 'me@outlook.com', provider: 'outlook' });
    expect(OutlookProvider.create).toHaveBeenCalledWith('me@outlook.com');
  });

  it('throws for imap (not yet implemented)', async () => {
    await expect(
      getProvider({ email: 'me@yahoo.com', provider: 'imap' })
    ).rejects.toThrow('Provider not implemented: imap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/factory.test.ts
```

Expected: FAIL — "OutlookProvider.create is not a function" (or similar, since factory still throws)

- [ ] **Step 3: Update `src/factory.ts`**

```typescript
import { AccountConfig, EmailProvider } from './providers/interface';
import { GmailProvider } from './providers/gmail';
import { OutlookProvider } from './providers/outlook';

export async function getProvider(account: AccountConfig): Promise<EmailProvider> {
  switch (account.provider) {
    case 'gmail':
      return GmailProvider.create(account.email);
    case 'outlook':
      return OutlookProvider.create(account.email);
    case 'imap':
      throw new Error('Provider not implemented: imap (Phase 3)');
    default:
      throw new Error(`Provider not implemented: ${(account as any).provider}`);
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/factory.ts src/factory.test.ts
git commit -m "feat: wire OutlookProvider into factory"
```

---

### Task 5: `scripts/add-account.ts` — Outlook branch

**Files:**
- Modify: `scripts/add-account.ts`

No automated test for this task — it's an interactive CLI. Verified manually.

- [ ] **Step 1: Update `scripts/add-account.ts`**

Replace the entire file:

```typescript
import { program } from 'commander';
import { select, input } from '@inquirer/prompts';
import { loadConfig, saveConfig } from '../src/config';
import { runGmailOAuthFlow } from '../src/auth/oauth-gmail';
import { runOutlookOAuthFlow } from '../src/auth/oauth-outlook';

program
  .option('--provider <provider>', 'gmail | outlook | imap')
  .option('--nickname <nickname>', 'Short alias for this account')
  .option('--email <email>', 'Email address (IMAP only)')
  .option('--host <host>', 'IMAP server hostname (IMAP only)')
  .option('--port <port>', 'IMAP port (default 993)', '993')
  .parse(process.argv);

const opts = program.opts<{
  provider?: string;
  nickname?: string;
  email?: string;
  host?: string;
  port?: string;
}>();

async function main() {
  const provider = opts.provider ?? await select({
    message: 'Which email provider?',
    choices: [
      { name: 'Gmail', value: 'gmail' },
      { name: 'Outlook', value: 'outlook' },
      { name: 'IMAP / Yahoo / Fastmail (coming soon)', value: 'imap' },
    ],
  });

  let email: string;

  if (provider === 'gmail') {
    email = await runGmailOAuthFlow();
  } else if (provider === 'outlook') {
    email = await runOutlookOAuthFlow();
  } else {
    console.error(`${provider} support is not yet implemented.`);
    process.exit(1);
  }

  const nickname = opts.nickname ?? await input({
    message: 'Nickname for this account (e.g. "work"):',
    default: email,
  });

  const config = loadConfig();
  config.accounts[nickname] = { email, provider: provider as 'gmail' | 'outlook' };
  saveConfig(config);

  console.log(`\nAccount registered: ${nickname} (${email})`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: clean build, no errors

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests passing

- [ ] **Step 4: Commit**

```bash
git add scripts/add-account.ts
git commit -m "feat: add Outlook support to add-account CLI"
```

---

## Manual Smoke Test (after all tasks complete)

To verify end-to-end before shipping:

1. Set up `credentials/outlook.json` (see Azure App Registration steps in the spec)
2. Run `npm run add-account -- --provider outlook --nickname outlook-test`
3. Browser opens → authorize → terminal shows "Authorized: you@outlook.com"
4. Run `npm run build`
5. Restart Claude Code (MCP server reloads)
6. Ask Claude: "Search my outlook-test account for emails from last week"
7. Ask Claude: "Draft a test email from my outlook account to yourself"
8. Approve and send
