import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/oauth-gmail', () => ({
  getGmailAuthClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('../auth/oauth-outlook', () => ({
  getOutlookAuthClient: vi.fn().mockResolvedValue({ accessToken: 'outlook-token' }),
}));

const mockSearchContacts = vi.fn().mockResolvedValue({ data: { results: [] } });
const mockCreateContact = vi.fn().mockResolvedValue({});
const mockUpdateContact = vi.fn().mockResolvedValue({});
const mockGet = vi.fn().mockResolvedValue({ data: { etag: 'etag123' } });
const mockConnectionsList = vi.fn().mockResolvedValue({ data: { connections: [] } });

vi.mock('googleapis', () => ({
  google: {
    people: vi.fn(() => ({
      people: {
        searchContacts: mockSearchContacts,
        createContact: mockCreateContact,
        updateContact: mockUpdateContact,
        get: mockGet,
        connections: { list: mockConnectionsList },
      },
    })),
    gmail: vi.fn(() => ({
      users: { messages: { list: vi.fn().mockResolvedValue({ data: { messages: [] } }) } },
    })),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { lookupContact, createContact, updateContact } from './contacts';

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

describe('updateContact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds contact by email via connections.list and updates for gmail accounts', async () => {
    mockConnectionsList.mockResolvedValueOnce({
      data: {
        connections: [{
          resourceName: 'people/123',
          names: [{ displayName: 'Alice', givenName: 'Alice' }],
          emailAddresses: [{ value: 'alice@example.com' }],
        }],
      },
    });

    await updateContact({ email: 'work@gmail.com', provider: 'gmail' }, {
      query: 'alice@example.com',
      name: 'Alice Updated',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('finds contact by name via connections.list and updates for gmail accounts', async () => {
    mockConnectionsList.mockResolvedValueOnce({
      data: {
        connections: [{
          resourceName: 'people/456',
          names: [{ displayName: 'Bob Smith', givenName: 'Bob' }],
          emailAddresses: [{ value: 'bob@example.com' }],
        }],
      },
    });

    await updateContact({ email: 'work@gmail.com', provider: 'gmail' }, {
      query: 'Bob',
      title: 'CTO',
    });
    expect(mockUpdateContact).toHaveBeenCalled();
  });

  it('calls Graph API PATCH /me/contacts/{id} for outlook accounts', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOk({ value: [{ id: 'contact-123' }] })) // search
      .mockResolvedValueOnce(mockOk({})); // patch
    await updateContact({ email: 'me@outlook.com', provider: 'outlook' }, {
      query: 'alice@example.com',
      name: 'Alice Updated',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://graph.microsoft.com/v1.0/me/contacts/contact-123',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('finds outlook contact by name', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOk({ value: [{ id: 'contact-456' }] })) // search by name
      .mockResolvedValueOnce(mockOk({})); // patch
    await updateContact({ email: 'me@outlook.com', provider: 'outlook' }, {
      query: 'Alice',
      title: 'VP',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('displayName');
  });

  it('throws when no contact found for outlook update', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ value: [] }));
    await expect(
      updateContact({ email: 'me@outlook.com', provider: 'outlook' }, {
        query: 'unknown@example.com',
        name: 'Nobody',
      })
    ).rejects.toThrow('No contact found matching "unknown@example.com"');
  });
});
