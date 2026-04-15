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
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('lookupContact router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses gmail path for gmail accounts (no fetch call)', async () => {
    await lookupContact({ email: 'work@gmail.com', provider: 'gmail' }, 'alice');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses outlook path for outlook accounts (fetch is called)', async () => {
    mockFetch.mockResolvedValue(mockOk({ value: [] }));
    await lookupContact({ email: 'me@outlook.com', provider: 'outlook' }, 'alice');
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('outlookLookupContact via lookupContact', () => {
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
