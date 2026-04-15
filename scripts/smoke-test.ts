import { loadConfig, listAccounts } from '../src/config';
import { getProvider } from '../src/factory';

async function run() {
  const config = loadConfig();
  const accounts = listAccounts(config);

  if (accounts.length === 0) {
    console.error('No accounts registered. Run: npm run add-account');
    process.exit(1);
  }

  console.log(`\nSmoke testing ${accounts.length} account(s)...\n`);
  let allPassed = true;

  for (const account of accounts) {
    console.log(`--- ${account.nickname} (${account.email} / ${account.provider}) ---`);
    try {
      const provider = await getProvider(account);

      process.stdout.write('  search("is:unread", max 3)... ');
      const emails = await provider.search({ q: 'is:unread', maxResults: 3 });
      console.log(`✓ found ${emails.length}`);

      if (emails.length > 0) {
        process.stdout.write(`  getEmail(${emails[0].id})... `);
        const full = await provider.getEmail(emails[0].id);
        console.log(`✓ "${full.subject}" from ${full.from.email}`);
      }

      process.stdout.write('  listLabels()... ');
      const labels = await provider.listLabels();
      console.log(`✓ found ${labels.length}`);

      console.log('  ✓ PASSED\n');
    } catch (err) {
      console.error(`  ✗ FAILED: ${(err as Error).message}\n`);
      allPassed = false;
    }
  }

  if (!allPassed) process.exit(1);
  console.log('All accounts passed.');
}

run();
