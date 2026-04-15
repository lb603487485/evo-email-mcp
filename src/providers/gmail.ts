import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import { getGmailAuthClient } from '../auth/oauth-gmail';
import { Email, EmailProvider, SearchQuery, Draft, Label } from './interface';
import { buildMimeMessage } from './mime';

export class GmailProvider implements EmailProvider {
  private gmail: ReturnType<typeof google.gmail>;
  private email: string;

  private constructor(gmail: ReturnType<typeof google.gmail>, email: string) {
    this.gmail = gmail;
    this.email = email;
  }

  static async create(email: string): Promise<GmailProvider> {
    const auth = await getGmailAuthClient(email);
    return new GmailProvider(google.gmail({ version: 'v1', auth }), email);
  }

  async search(query: SearchQuery): Promise<Email[]> {
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: query.q,
      maxResults: query.maxResults ?? 20,
    });
    const messages = res.data.messages ?? [];
    if (messages.length === 0) return [];
    return Promise.all(messages.map(m => this.getEmail(m.id!)));
  }

  async getEmail(id: string): Promise<Email> {
    const res = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return this.parseMessage(res.data);
  }

  async send(draft: Draft): Promise<void> {
    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildMimeMessage(draft) },
    });
  }

  async createDraft(draft: Draft): Promise<string> {
    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: buildMimeMessage(draft) } },
    });
    return res.data.id!;
  }

  async updateDraft(draftId: string, draft: Draft): Promise<void> {
    await this.gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: { message: { raw: buildMimeMessage(draft) } },
    });
  }

  async sendDraft(draftId: string): Promise<void> {
    await this.gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: draftId },
    });
  }

  async listLabels(): Promise<Label[]> {
    const res = await this.gmail.users.labels.list({ userId: 'me' });
    return (res.data.labels ?? []).map(l => ({ id: l.id!, name: l.name! }));
  }

  async applyLabel(id: string, label: string, action: 'add' | 'remove'): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: {
        addLabelIds: action === 'add' ? [label] : [],
        removeLabelIds: action === 'remove' ? [label] : [],
      },
    });
  }

  async downloadAttachment(emailId: string, attachmentId: string, savePath: string): Promise<void> {
    const res = await this.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: emailId,
      id: attachmentId,
    });
    writeFileSync(savePath, Buffer.from(res.data.data!, 'base64'));
  }

  private parseMessage(msg: any): Email {
    const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    return {
      id: msg.id,
      threadId: msg.threadId,
      account: this.email,
      provider: 'gmail',
      from: parseAddress(header('From')),
      to: header('To').split(',').map((a: string) => parseAddress(a.trim())).filter(a => a.email),
      subject: header('Subject'),
      body: extractBody(msg.payload),
      date: new Date(parseInt(msg.internalDate)),
      labels: msg.labelIds ?? [],
      attachments: extractAttachments(msg.payload),
    };
  }
}

function parseAddress(raw: string): { name?: string; email: string } {
  const match = raw.match(/^"?([^"<]*)"?\s*<?([^>]+)>?$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    return name ? { name, email } : { email };
  }
  return { email: raw.trim() };
}

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return '';
}

function extractAttachments(payload: any): Email['attachments'] {
  if (!payload?.parts) return [];
  return payload.parts
    .filter((p: any) => p.filename && p.body?.attachmentId)
    .map((p: any) => ({
      id: p.body.attachmentId,
      filename: p.filename,
      mimeType: p.mimeType,
      size: p.body.size ?? 0,
    }));
}
