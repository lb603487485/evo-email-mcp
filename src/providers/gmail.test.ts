import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessages = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  modify: vi.fn(),
  attachments: { get: vi.fn() },
}));
const mockDrafts = vi.hoisted(() => ({ create: vi.fn() }));
const mockLabels = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../auth/oauth-gmail', () => ({
  getGmailAuthClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    gmail: vi.fn(() => ({
      users: { messages: mockMessages, drafts: mockDrafts, labels: mockLabels },
    })),
    oauth2: vi.fn(() => ({ userinfo: { get: vi.fn() } })),
  },
}));

import { GmailProvider } from './gmail';

describe('GmailProvider.search', () => {
  let provider: GmailProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await GmailProvider.create('work@gmail.com');
  });

  it('returns empty array when no messages', async () => {
    mockMessages.list.mockResolvedValue({ data: { messages: [] } });
    expect(await provider.search({ q: 'from:nobody' })).toEqual([]);
  });

  it('passes query and maxResults to Gmail API', async () => {
    mockMessages.list.mockResolvedValue({ data: { messages: [] } });
    await provider.search({ q: 'is:unread', maxResults: 5 });
    expect(mockMessages.list).toHaveBeenCalledWith({ userId: 'me', q: 'is:unread', maxResults: 5 });
  });
});

describe('GmailProvider.send', () => {
  let provider: GmailProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await GmailProvider.create('work@gmail.com');
  });

  it('calls Gmail send with base64url MIME message', async () => {
    mockMessages.send.mockResolvedValue({ data: {} });
    await provider.send({ from: 'work@gmail.com', to: 'alice@example.com', subject: 'Hi', body: 'Hello' });
    expect(mockMessages.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'me', requestBody: expect.objectContaining({ raw: expect.any(String) }) })
    );
  });

  it('accepts array of recipients', async () => {
    mockMessages.send.mockResolvedValue({ data: {} });
    await provider.send({ from: 'work@gmail.com', to: ['a@x.com', 'b@x.com'], subject: 'Hi', body: 'Hello' });
    expect(mockMessages.send).toHaveBeenCalled();
  });
});

describe('GmailProvider.listLabels', () => {
  let provider: GmailProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = await GmailProvider.create('work@gmail.com');
  });

  it('returns labels from API', async () => {
    mockLabels.list.mockResolvedValue({
      data: { labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'Label_1', name: 'Work' }] },
    });
    const labels = await provider.listLabels();
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({ id: 'INBOX', name: 'INBOX' });
  });
});
