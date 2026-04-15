import { program } from 'commander';
import { select, input } from '@inquirer/prompts';
import { loadConfig, saveConfig } from '../src/config';
import { runGmailOAuthFlow } from '../src/auth/oauth-gmail';

program
  .option('--provider <provider>', 'gmail | outlook | imap')
  .option('--nickname <nickname>', 'Short alias for this account')
  .option('--email <email>', 'Email address (IMAP only)')
  .option('--host <host>', 'IMAP server hostname (IMAP only)')
  .option('--port <port>', 'IMAP port (default 993)', '993')
  .parse(process.argv);

const opts = program.opts<{
  provider?: string;
  nickname?: string;
  email?: string;
  host?: string;
  port?: string;
}>();

async function main() {
  const provider = opts.provider ?? await select({
    message: 'Which email provider?',
    choices: [
      { name: 'Gmail', value: 'gmail' },
      { name: 'Outlook (coming soon)', value: 'outlook' },
      { name: 'IMAP / Yahoo / Fastmail (coming soon)', value: 'imap' },
    ],
  });

  let email: string;

  if (provider === 'gmail') {
    email = await runGmailOAuthFlow();
  } else {
    console.error(`${provider} support is not yet implemented.`);
    process.exit(1);
  }

  const nickname = opts.nickname ?? await input({
    message: 'Nickname for this account (e.g. "work"):',
    default: email,
  });

  const config = loadConfig();
  config.accounts[nickname] = { email, provider: 'gmail' };
  saveConfig(config);

  console.log(`\nAccount registered: ${nickname} (${email})`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
