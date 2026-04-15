import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AppConfig, AccountConfig } from './providers/interface';
import { getConfigPath, ensureConfigHome } from './paths';

const DEFAULT_CONFIG: AppConfig = {
  sendMode: 'confirm',
  defaultMaxResults: 20,
  accounts: {},
};

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    ensureConfigHome();
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }
  return JSON.parse(readFileSync(configPath, 'utf-8')) as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  ensureConfigHome();
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getAccount(config: AppConfig, identifier: string): AccountConfig {
  if (config.accounts[identifier]) return config.accounts[identifier];
  const byEmail = Object.values(config.accounts).find(a => a.email === identifier);
  if (byEmail) return byEmail;
  throw new Error(`Account not found: ${identifier}`);
}

export function listAccounts(config: AppConfig): Array<AccountConfig & { nickname: string }> {
  return Object.entries(config.accounts).map(([nickname, account]) => ({
    ...account,
    nickname,
  }));
}
