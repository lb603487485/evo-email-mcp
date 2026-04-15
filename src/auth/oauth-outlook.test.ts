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
