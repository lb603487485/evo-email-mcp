#!/usr/bin/env node
import { program } from 'commander';
import { select } from '@inquirer/prompts';
import { loadConfig, saveConfig, listAccounts } from '../config';
import { deleteToken } from '../auth/keychain';

program
  .option('--nickname <nickname>', 'Nickname of the account to remove')
  .parse(process.argv);

const opts = program.opts<{ nickname?: string }>();

async function main() {
  const config = loadConfig();
  const accounts = listAccounts(config);

  if (accounts.length === 0) {
    console.error('No accounts registered.');
    process.exit(1);
  }

  const nickname = opts.nickname ?? await select({
    message: 'Which account to remove?',
    choices: accounts.map(a => ({
      name: `${a.nickname} (${a.email} / ${a.provider})`,
      value: a.nickname,
    })),
  });

  const account = config.accounts[nickname];
  if (!account) {
    console.error(`Account not found: ${nickname}`);
    process.exit(1);
  }

  // Remove token from Keychain
  await deleteToken(account.provider, account.email);

  // Remove from config
  delete config.accounts[nickname];
  saveConfig(config);

  console.log(`\nRemoved: ${nickname} (${account.email})`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
