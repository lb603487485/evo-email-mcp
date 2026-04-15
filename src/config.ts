import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { AppConfig, AccountConfig } from './providers/interface';

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

export function loadConfig(configPath = CONFIG_PATH): AppConfig {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as AppConfig;
}

export function saveConfig(config: AppConfig, configPath = CONFIG_PATH): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
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
