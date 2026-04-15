import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccount, listAccounts } from './config';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns default config when file does not exist', async () => {
    vi.doMock('./paths', () => ({
      getConfigPath: () => '/tmp/evo-email-mcp-nonexistent-test.json',
      ensureConfigHome: vi.fn(),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, existsSync: () => false, writeFileSync: vi.fn() };
    });
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.sendMode).toBe('confirm');
    expect(config.accounts).toEqual({});
  });
});

describe('getAccount', () => {
  const config = {
    sendMode: 'confirm' as const,
    defaultMaxResults: 20,
    accounts: { work: { email: 'work@gmail.com', provider: 'gmail' as const } },
  };

  it('resolves by nickname', () => {
    expect(getAccount(config, 'work').email).toBe('work@gmail.com');
  });

  it('resolves by email address', () => {
    expect(getAccount(config, 'work@gmail.com').email).toBe('work@gmail.com');
  });

  it('throws when not found', () => {
    expect(() => getAccount(config, 'unknown')).toThrow('Account not found: unknown');
  });
});

describe('listAccounts', () => {
  it('returns accounts with nickname attached', () => {
    const config = {
      sendMode: 'confirm' as const,
      defaultMaxResults: 20,
      accounts: { work: { email: 'work@gmail.com', provider: 'gmail' as const } },
    };
    const accounts = listAccounts(config);
    expect(accounts[0].nickname).toBe('work');
    expect(accounts[0].email).toBe('work@gmail.com');
  });
});
