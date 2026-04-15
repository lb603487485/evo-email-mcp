import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { loadConfig, getAccount, listAccounts } from './config';

const TEST_CONFIG = '/tmp/email-mcp-test-config.json';

describe('loadConfig', () => {
  it('parses config from file', () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      sendMode: 'auto',
      defaultMaxResults: 10,
      accounts: { work: { email: 'work@gmail.com', provider: 'gmail' } },
    }));
    const config = loadConfig(TEST_CONFIG);
    expect(config.sendMode).toBe('auto');
    expect(config.accounts.work.email).toBe('work@gmail.com');
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
