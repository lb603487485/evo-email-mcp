import { AccountConfig, EmailProvider } from './providers/interface';
import { GmailProvider } from './providers/gmail';
import { OutlookProvider } from './providers/outlook';

export async function getProvider(account: AccountConfig): Promise<EmailProvider> {
  switch (account.provider) {
    case 'gmail':
      return GmailProvider.create(account.email);
    case 'outlook':
      return OutlookProvider.create(account.email);
    case 'imap':
      throw new Error('Provider not implemented: imap (Phase 3)');
    default:
      throw new Error(`Provider not implemented: ${(account as any).provider}`);
  }
}
