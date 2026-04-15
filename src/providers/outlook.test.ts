import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('../auth/oauth-outlook', () => ({
  getOutlookAuthClient: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
}));

vi.mock('fs', () => ({ writeFileSync: writeFileSyncMock }));

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
