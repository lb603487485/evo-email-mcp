import { describe, it, expect, vi } from 'vitest';

vi.mock('./providers/gmail', () => ({
  GmailProvider: { create: vi.fn().mockResolvedValue({ _provider: 'gmail' }) },
}));

import { getProvider } from './factory';
import { GmailProvider } from './providers/gmail';

describe('getProvider', () => {
  it('returns GmailProvider for gmail accounts', async () => {
    await getProvider({ email: 'work@gmail.com', provider: 'gmail' });
    expect(GmailProvider.create).toHaveBeenCalledWith('work@gmail.com');
  });

  it('throws for outlook (not yet implemented)', async () => {
    await expect(
      getProvider({ email: 'me@outlook.com', provider: 'outlook' })
    ).rejects.toThrow('Provider not implemented: outlook');
  });

  it('throws for imap (not yet implemented)', async () => {
    await expect(
      getProvider({ email: 'me@yahoo.com', provider: 'imap' })
    ).rejects.toThrow('Provider not implemented: imap');
  });
});
