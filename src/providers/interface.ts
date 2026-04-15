export interface SearchQuery {
  q: string;
  maxResults?: number;
}

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Email {
  id: string;
  threadId: string;
  account: string;
  provider: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  body: string;
  date: Date;
  labels: string[];
  attachments: Attachment[];
}

export interface Draft {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  attachments?: string[];
}

export interface Label {
  id: string;
  name: string;
}

export interface EmailProvider {
  search(query: SearchQuery): Promise<Email[]>;
  getEmail(id: string): Promise<Email>;
  send(draft: Draft): Promise<void>;
  createDraft(draft: Draft): Promise<string>;
  updateDraft(draftId: string, draft: Draft): Promise<void>;
  sendDraft(draftId: string): Promise<void>;
  deleteDraft(draftId: string): Promise<void>;
  listLabels(): Promise<Label[]>;
  applyLabel(id: string, label: string, action: 'add' | 'remove'): Promise<void>;
  downloadAttachment(emailId: string, attachmentId: string, savePath: string): Promise<void>;
}

export type ProviderName = 'gmail' | 'outlook' | 'imap';

export interface AccountConfig {
  email: string;
  provider: ProviderName;
  nickname?: string;
  host?: string;
  port?: number;
}

export interface AppConfig {
  sendMode: 'auto' | 'confirm' | 'blocked';
  defaultMaxResults: number;
  accounts: Record<string, AccountConfig>;
}
