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
