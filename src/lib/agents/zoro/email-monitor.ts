import { createClient } from '@supabase/supabase-js';
import { googleGet, googlePost } from './google-auth';
import { extractInvoiceFromText } from './invoice-extractor';
import { upsertProvider }         from './provider-registry';
import { organizeDriveFile }      from './drive-organizer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const FINANCE_KEYWORDS = [
  'invoice', 'receipt', 'billing', 'payment', 'tax', 'vat', 'gst',
  'subscription', 'renewal', 'order', 'transaction', 'facture', 'reçu',
  'purchase', 'charge', 'statement', 'due', 'paid', 'confirmation',
];

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailMessage { id: string; threadId: string }
interface GmailListResponse { messages?: GmailMessage[]; nextPageToken?: string }

interface GmailPart {
  mimeType: string;
  filename?: string;
  body: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

interface GmailFullMessage {
  id: string;
  payload: GmailPart & { headers: { name: string; value: string }[] };
  labelIds?: string[];
}

export interface MonitorResult {
  scanned:   number;
  processed: number;
  errors:    number;
}

function buildGmailQuery(): string {
  const kw = FINANCE_KEYWORDS.join(' OR ');
  return `is:unread (${kw}) -from:noreply -category:promotions`;
}

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractTextParts(part: GmailPart): string[] {
  const texts: string[] = [];
  if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body.data) {
    const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
    texts.push(decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  for (const sub of part.parts ?? []) {
    texts.push(...extractTextParts(sub));
  }
  return texts;
}

function extractAttachments(part: GmailPart): Array<{ filename: string; attachmentId: string; mimeType: string }> {
  const attachments: Array<{ filename: string; attachmentId: string; mimeType: string }> = [];
  if (part.filename && part.body.attachmentId) {
    attachments.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType });
  }
  for (const sub of part.parts ?? []) {
    attachments.push(...extractAttachments(sub));
  }
  return attachments;
}

async function downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await googleGet<{ data: string }>(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`
  );
  return Buffer.from(data.data, 'base64');
}

async function markAsRead(messageId: string): Promise<void> {
  await googlePost(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    removeLabelIds: ['UNREAD'],
  });
}

async function processMessage(msg: GmailFullMessage): Promise<boolean> {
  const subject = getHeader(msg.payload.headers, 'subject');
  const from    = getHeader(msg.payload.headers, 'from');
  const date    = getHeader(msg.payload.headers, 'date');

  const isFinance = FINANCE_KEYWORDS.some(kw =>
    subject.toLowerCase().includes(kw) ||
    from.toLowerCase().includes(kw)
  );
  if (!isFinance) return false;

  // Check already processed
  const { data: existing } = await supabase
    .from('finance_invoices')
    .select('id')
    .eq('gmail_message_id', msg.id)
    .maybeSingle();
  if (existing) return false;

  const textParts   = extractTextParts(msg.payload);
  const emailText   = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${textParts.join('\n')}`;
  const attachments = extractAttachments(msg.payload);

  const extracted = await extractInvoiceFromText(emailText);
  if (!extracted) return false;

  // Upsert provider
  const provider = await upsertProvider({
    name:     extracted.provider_name,
    category: extracted.category,
    currency: extracted.currency,
  });

  // Process PDF attachments
  let driveFileId:  string | null = null;
  let driveFileUrl: string | null = null;

  const pdfAttachment = attachments.find(a =>
    a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
  );

  if (pdfAttachment) {
    try {
      const buffer = await downloadAttachment(msg.id, pdfAttachment.attachmentId);
      const result = await organizeDriveFile({
        buffer,
        filename:     pdfAttachment.filename,
        provider:     extracted.provider_name,
        category:     extracted.category,
        amount:       extracted.amount,
        currency:     extracted.currency,
        invoiceDate:  extracted.invoice_date,
      });
      driveFileId  = result.fileId;
      driveFileUrl = result.fileUrl;
    } catch {
      // Non-blocking — log only
      void supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'WARNING',
        message: `Drive upload échoué pour pièce jointe ${pdfAttachment.filename}`,
      });
    }
  }

  // Save to finance_invoices
  await supabase.from('finance_invoices').insert({
    provider_id:      provider?.id ?? null,
    provider_name:    extracted.provider_name,
    invoice_number:   extracted.invoice_number ?? null,
    amount:           extracted.amount,
    currency:         extracted.currency,
    invoice_date:     extracted.invoice_date,
    due_date:         extracted.due_date ?? null,
    category:         extracted.category,
    source:           'gmail',
    gmail_message_id: msg.id,
    drive_file_id:    driveFileId,
    drive_file_url:   driveFileUrl,
    raw_text:         emailText.slice(0, 2000),
    is_recurring:     extracted.is_recurring,
    vat_amount:       extracted.vat_amount ?? null,
    payment_method:   extracted.payment_method ?? null,
    status:           'pending',
  });

  await markAsRead(msg.id);
  return true;
}

export async function runEmailMonitor(): Promise<MonitorResult> {
  const query = buildGmailQuery();
  let scanned = 0; let processed = 0; let errors = 0;
  let pageToken: string | undefined;

  do {
    const url = `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=20${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const list = await googleGet<GmailListResponse>(url);
    const messages = list.messages ?? [];
    pageToken = list.nextPageToken;

    for (const msg of messages) {
      scanned++;
      try {
        const full = await googleGet<GmailFullMessage>(`${GMAIL_BASE}/messages/${msg.id}?format=full`);
        const ok   = await processMessage(full);
        if (ok) processed++;
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        void supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'WARNING',
          message: `Email monitor erreur (id=${msg.id}): ${message.slice(0, 150)}`,
        });
      }
    }
  } while (pageToken && scanned < 100);

  void supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Email monitor: ${scanned} scannés, ${processed} traités, ${errors} erreurs`,
  });

  return { scanned, processed, errors };
}
