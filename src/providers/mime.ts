import { Draft } from './interface';

export function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

// Detect if body contains HTML tags
function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

// Strip HTML tags to produce a plain text fallback
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMimeMessage(draft: Draft): string {
  const to = Array.isArray(draft.to) ? draft.to.join(', ') : draft.to;
  const subject = encodeHeader(draft.subject);

  if (!isHtml(draft.body)) {
    // Plain text — send as-is
    const mime = [
      `From: ${draft.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      draft.body,
    ].join('\r\n');
    return Buffer.from(mime).toString('base64url');
  }

  // HTML body — send both plain text fallback and HTML
  const boundary = `boundary_${Date.now()}`;
  const plainText = stripHtml(draft.body);

  const mime = [
    `From: ${draft.from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    plainText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    draft.body,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
