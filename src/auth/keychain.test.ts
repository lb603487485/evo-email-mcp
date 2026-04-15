import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

import keytar from 'keytar';
import { getToken, setToken, deleteToken } from './keychain';

const mock = keytar as {
  getPassword: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
};

describe('keychain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getToken reads and parses from keychain', async () => {
    mock.getPassword.mockResolvedValue(JSON.stringify({ access_token: 'abc' }));
    const token = await getToken('gmail', 'work@gmail.com');
    expect(token).toEqual({ access_token: 'abc' });
    expect(mock.getPassword).toHaveBeenCalledWith('evo-email-mcp', 'gmail:work@gmail.com');
  });

  it('getToken returns null when not found', async () => {
    mock.getPassword.mockResolvedValue(null);
    expect(await getToken('gmail', 'work@gmail.com')).toBeNull();
  });

  it('setToken serializes and stores', async () => {
    await setToken('gmail', 'work@gmail.com', { access_token: 'abc' });
    expect(mock.setPassword).toHaveBeenCalledWith(
      'evo-email-mcp', 'gmail:work@gmail.com', JSON.stringify({ access_token: 'abc' })
    );
  });

  it('deleteToken removes the entry', async () => {
    await deleteToken('gmail', 'work@gmail.com');
    expect(mock.deletePassword).toHaveBeenCalledWith('evo-email-mcp', 'gmail:work@gmail.com');
  });
});
