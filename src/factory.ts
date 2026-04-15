import { AccountConfig, EmailProvider } from './providers/interface';
import { GmailProvider } from './providers/gmail';

export async function getProvider(account: AccountConfig): Promise<EmailProvider> {
  switch (account.provider) {
    case 'gmail':
      return GmailProvider.create(account.email);
    case 'outlook':
      throw new Error('Provider not implemented: outlook (Phase 2)');
    case 'imap':
      throw new Error('Provider not implemented: imap (Phase 3)');
    default:
      throw new Error(`Provider not implemented: ${(account as any).provider}`);
  }
}
