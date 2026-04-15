import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccount, listAccounts } from './config';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns default config with permissions when file does not exist', async () => {
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
    expect(config.permissions).toEqual({
      emailWrite: 'confirm',
      contactWrite: 'auto',
      labelWrite: 'auto',
    });
    expect(config.accounts).toEqual({});
    expect((config as any).sendMode).toBeUndefined();
  });

  it('migrates old sendMode to permissions', async () => {
    const oldConfig = JSON.stringify({
      sendMode: 'auto',
      defaultMaxResults: 20,
      accounts: {},
    });
    let savedConfig: string | undefined;
    vi.doMock('./paths', () => ({
      getConfigPath: () => '/tmp/evo-email-mcp-migrate-test.json',
      ensureConfigHome: vi.fn(),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: () => true,
        readFileSync: () => oldConfig,
        writeFileSync: (_path: string, data: string) => { savedConfig = data; },
      };
    });
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.permissions.emailWrite).toBe('auto');
    expect(config.permissions.contactWrite).toBe('auto');
    expect(config.permissions.labelWrite).toBe('auto');
    expect((config as any).sendMode).toBeUndefined();
    expect(savedConfig).toBeDefined();
    const saved = JSON.parse(savedConfig!);
    expect(saved.sendMode).toBeUndefined();
    expect(saved.permissions).toBeDefined();
  });
});

describe('getAccount', () => {
  const config = {
    permissions: { emailWrite: 'confirm' as const, contactWrite: 'auto' as const, labelWrite: 'auto' as const },
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
      permissions: { emailWrite: 'confirm' as const, contactWrite: 'auto' as const, labelWrite: 'auto' as const },
      defaultMaxResults: 20,
      accounts: { work: { email: 'work@gmail.com', provider: 'gmail' as const } },
    };
    const accounts = listAccounts(config);
    expect(accounts[0].nickname).toBe('work');
    expect(accounts[0].email).toBe('work@gmail.com');
  });
});
