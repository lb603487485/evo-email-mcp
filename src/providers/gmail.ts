import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import { getGmailAuthClient } from '../auth/oauth-gmail';
import { Email, EmailProvider, SearchQuery, Draft, Label } from './interface';

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

  async createDraft(draft: Draft): Promise<Draft> {
    await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: buildMimeMessage(draft) } },
    });
    return draft;
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

function markdownToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    // Headings
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h3>${h3[1]}</h3>`); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h2>${h2[1]}</h2>`); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { if (inList) { html.push('</ul>'); inList = false; } html.push(`<h1>${h1[1]}</h1>`); continue; }

    // Bullet points
    const bullet = line.match(/^[\-\*]\s+(.+)/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${applyInline(bullet[1])}</li>`);
      continue;
    }

    // Close list if we're no longer in bullets
    if (inList) { html.push('</ul>'); inList = false; }

    // Empty line = paragraph break
    if (line.trim() === '') { html.push('<br>'); continue; }

    // Regular text
    html.push(`<p>${applyInline(line)}</p>`);
  }

  if (inList) html.push('</ul>');

  return html.join('\n');
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function encodeHeader(value: string): string {
  // If all ASCII, return as-is
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // RFC 2047 Base64 encoding for non-ASCII
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function buildMimeMessage(draft: Draft): string {
  const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
  const boundary = `boundary_${Date.now()}`;
  const htmlBody = markdownToHtml(draft.body);

  const mime = [
    `From: ${draft.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(draft.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    draft.body,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    `<html><body style="font-family: sans-serif; font-size: 14px; line-height: 1.5; color: #333;">`,
    htmlBody,
    `</body></html>`,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
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
