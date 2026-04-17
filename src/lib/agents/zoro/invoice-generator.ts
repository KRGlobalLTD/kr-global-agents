import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

// ---- Types ----

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceClient {
  name: string;
  email: string;
  phone?: string;
  address: string;
  city: string;
  country: string;
  vatNumber?: string;
}

export interface InvoiceData {
  client: InvoiceClient;
  items: InvoiceLineItem[];
  currency: string;
  issuedAt: Date;
  dueDays: number;           // nb de jours pour payer (ex: 30)
  includesIpClause: boolean; // clause propriété intellectuelle
  vatReverseCharge: boolean; // B2B UK→FR = "VAT reverse charge applies"
}

export interface GeneratedInvoice {
  number: string;
  r2Url: string;
  dueAt: Date;
}

// ---- PDF generator (pur Node.js, sans dépendance externe) ----

function pdfStr(s: string): string {
  // Sanitise vers WinAnsi (latin1) + échappe les caractères PDF spéciaux
  const sanitised = Array.from(s)
    .map((c) => {
      const cp = c.charCodeAt(0);
      if (cp > 0xff) return '?';
      if (cp === 0x5c) return '\\\\';
      if (cp === 0x28) return '\\(';
      if (cp === 0x29) return '\\)';
      return c;
    })
    .join('');
  return `(${sanitised})`;
}

function fmt(n: number, currency: string): string {
  return `${n.toFixed(2)} ${currency}`;
}

interface PdfTextOp {
  x: number;
  y: number;
  text: string;
  font: 'F1' | 'F2'; // F1 = Helvetica, F2 = Helvetica-Bold
  size: number;
}

interface PdfLine {
  x1: number; y1: number; x2: number; y2: number;
}

function buildContentStream(
  ops: PdfTextOp[],
  lines: PdfLine[]
): Buffer {
  const parts: string[] = [];

  // Lignes horizontales (graphiques, hors bloc BT/ET)
  if (lines.length > 0) {
    parts.push('q 0.4 w');
    for (const l of lines) {
      parts.push(`${l.x1} ${l.y1} m ${l.x2} ${l.y2} l S`);
    }
    parts.push('Q');
  }

  // Bloc texte
  parts.push('BT');
  for (const op of ops) {
    parts.push(
      `/${op.font} ${op.size} Tf 1 0 0 1 ${op.x} ${op.y} Tm ${pdfStr(op.text)} Tj`
    );
  }
  parts.push('ET');

  return Buffer.from(parts.join('\n'), 'latin1');
}

function buildInvoiceContent(
  number: string,
  issuedAt: Date,
  dueAt: Date,
  inv: InvoiceData,
  subtotal: number,
  total: number
): { ops: PdfTextOp[]; lines: PdfLine[] } {
  const ops: PdfTextOp[] = [];
  const lines: PdfLine[] = [];

  const T = (
    x: number, y: number, text: string,
    font: 'F1' | 'F2' = 'F1', size = 10
  ): void => { ops.push({ x, y, text, font, size }); };

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // En-tête société
  T(50, 800, 'KR GLOBAL SOLUTIONS LTD', 'F2', 14);
  T(50, 782, '71-75 Shelton Street, Covent Garden', 'F1', 9);
  T(50, 771, 'London WC2H 9JQ  -  United Kingdom', 'F1', 9);

  // Titre facture (droite)
  T(390, 800, 'FACTURE', 'F2', 20);
  T(390, 780, `N\xB0 ${number}`, 'F1', 11);

  lines.push({ x1: 50, y1: 763, x2: 545, y2: 763 });

  // Dates
  T(50, 748, 'Date :', 'F2', 10);
  T(105, 748, fmtDate(issuedAt), 'F1', 10);
  T(50, 735, '\xC9ch\xE9ance :', 'F2', 10);
  T(105, 735, fmtDate(dueAt), 'F1', 10);

  // Bloc client
  T(50, 713, 'FACTURER \xC0 :', 'F2', 10);
  T(50, 700, inv.client.name, 'F2', 10);
  T(50, 688, inv.client.address, 'F1', 10);
  T(50, 676, `${inv.client.city}, ${inv.client.country}`, 'F1', 10);
  if (inv.client.vatNumber) {
    T(50, 664, `N\xB0 TVA : ${inv.client.vatNumber}`, 'F1', 10);
  }

  // En-tête tableau
  const tableTop = 640;
  lines.push({ x1: 50, y1: tableTop + 2, x2: 545, y2: tableTop + 2 });
  T(50, tableTop - 10, 'DESCRIPTION', 'F2', 10);
  T(350, tableTop - 10, 'QT\xC9', 'F2', 10);
  T(400, tableTop - 10, 'PRIX UNIT.', 'F2', 10);
  T(490, tableTop - 10, 'TOTAL', 'F2', 10);
  lines.push({ x1: 50, y1: tableTop - 15, x2: 545, y2: tableTop - 15 });

  // Lignes articles
  let itemY = tableTop - 30;
  for (const item of inv.items) {
    T(50, itemY, item.description, 'F1', 10);
    T(350, itemY, String(item.quantity), 'F1', 10);
    T(400, itemY, fmt(item.unitPrice, inv.currency), 'F1', 10);
    T(490, itemY, fmt(item.total, inv.currency), 'F1', 10);
    itemY -= 15;
  }

  lines.push({ x1: 50, y1: itemY - 5, x2: 545, y2: itemY - 5 });

  // Totaux
  const totY = itemY - 22;
  T(360, totY, 'Sous-total :', 'F1', 10);
  T(470, totY, fmt(subtotal, inv.currency), 'F1', 10);

  const vatLabel = inv.vatReverseCharge ? 'TVA (autoliquidation) :' : 'TVA :';
  T(360, totY - 15, vatLabel, 'F1', 10);
  T(470, totY - 15, fmt(0, inv.currency), 'F1', 10);

  lines.push({ x1: 360, y1: totY - 22, x2: 545, y2: totY - 22 });
  T(360, totY - 34, 'TOTAL D\xDB :', 'F2', 11);
  T(460, totY - 34, fmt(total, inv.currency), 'F2', 11);

  // Notes légales
  let noteY = totY - 65;
  if (inv.vatReverseCharge) {
    T(50, noteY, 'VAT reverse charge applies (Article 283-2 du CGI / UK VAT Notice 741A).', 'F1', 8);
    noteY -= 13;
  }
  if (inv.includesIpClause) {
    T(50, noteY,
      'All intellectual property rights in the deliverables remain with KR Global Solutions Ltd',
      'F1', 8);
    noteY -= 11;
    T(50, noteY, 'until full payment is received, at which point rights transfer to the client.', 'F1', 8);
    noteY -= 11;
  }

  // Pied de page
  lines.push({ x1: 50, y1: 55, x2: 545, y2: 55 });
  T(50, 43, 'KR Global Solutions Ltd  \xB7  contact@kr-global.com  \xB7  www.kr-global.com', 'F1', 8);

  return { ops, lines };
}

function buildPdf(
  number: string,
  issuedAt: Date,
  dueAt: Date,
  inv: InvoiceData,
  subtotal: number,
  total: number
): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [0, 0, 0, 0, 0];
  let pos = 0;

  function emit(s: string): void {
    const b = Buffer.from(s, 'latin1');
    chunks.push(b);
    pos += b.length;
  }

  function emitBuf(b: Buffer): void {
    chunks.push(b);
    pos += b.length;
  }

  const pad = (n: number) => n.toString().padStart(10, '0');

  emit('%PDF-1.4\n');

  offsets[1] = pos;
  emit('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = pos;
  emit('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  const { ops, lines } = buildInvoiceContent(number, issuedAt, dueAt, inv, subtotal, total);
  const contentBuf = buildContentStream(ops, lines);

  offsets[3] = pos;
  emit(
    '3 0 obj\n' +
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]\n' +
    '   /Contents 4 0 R\n' +
    '   /Resources << /Font <<\n' +
    '     /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n' +
    '     /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n' +
    '   >> >> >>\nendobj\n'
  );

  offsets[4] = pos;
  emit(`4 0 obj\n<< /Length ${contentBuf.length} >>\nstream\n`);
  emitBuf(contentBuf);
  emit('\nendstream\nendobj\n');

  const xrefStart = pos;
  emit('xref\n0 5\n');
  emit(`0000000000 65535 f \n`);
  for (let i = 1; i <= 4; i++) emit(`${pad(offsets[i])} 00000 n \n`);
  emit(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

// ---- R2 upload via S3-compatible API (AWS Sig V4) ----

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function uploadToR2(key: string, body: Buffer): Promise<string> {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const bucket    = process.env.R2_BUCKET_NAME!;
  const accessKey = process.env.R2_ACCESS_KEY_ID!;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY!;
  const host      = `${accountId}.r2.cloudflarestorage.com`;
  const region    = 'auto';

  const now      = new Date();
  const dateISO  = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStr  = dateISO.slice(0, 8);
  const bodyHash = sha256Hex(body);
  const ct       = 'application/pdf';

  const canonicalHeaders =
    `content-type:${ct}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${dateISO}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const credentialScope = `${dateStr}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateISO,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const kDate    = hmac(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStr);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}/${bucket}/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': ct,
      'Content-Length': String(body.length),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': dateISO,
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`R2 upload ${response.status}: ${err}`);
  }

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// ---- Numérotation ----

export async function getNextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `KR-${year}-`;

  const { data, error } = await supabase
    .from('invoices')
    .select('number')
    .like('number', `${prefix}%`)
    .order('number', { ascending: false })
    .limit(1);

  if (error) throw new Error(`Erreur lecture numérotation : ${error.message}`);

  const last = data?.[0]?.number as string | undefined;
  const seq  = last ? parseInt(last.slice(prefix.length), 10) + 1 : 1;

  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ---- Point d'entrée principal ----

export async function generateInvoice(inv: InvoiceData): Promise<GeneratedInvoice> {
  const number   = await getNextInvoiceNumber();
  const issuedAt = inv.issuedAt;
  const dueAt    = new Date(issuedAt.getTime() + inv.dueDays * 86_400_000);

  const subtotal = inv.items.reduce((s, i) => s + i.total, 0);
  const total    = subtotal; // TVA = 0 (reverse charge ou hors champ)

  // Génération PDF
  const pdfBuffer = buildPdf(number, issuedAt, dueAt, inv, subtotal, total);

  // Upload R2
  const r2Key = `invoices/${issuedAt.getFullYear()}/${number}.pdf`;
  const r2Url = await uploadToR2(r2Key, pdfBuffer);

  // Persister en base
  const { error: insertError } = await supabase.from('invoices').insert({
    number,
    client_name:  inv.client.name,
    client_email: inv.client.email,
    client_phone: inv.client.phone ?? null,
    amount:       total,
    currency:     inv.currency,
    issued_at:    issuedAt.toISOString().split('T')[0],
    due_at:       dueAt.toISOString().split('T')[0],
    r2_url:       r2Url,
    status:       'PENDING',
  });

  if (insertError) throw new Error(`Erreur sauvegarde facture : ${insertError.message}`);

  // Envoi par email (Resend)
  const { error: mailError } = await resend.emails.send({
    from:    'billing@kr-global.com',
    to:      inv.client.email,
    subject: `Facture ${number} - KR Global Solutions Ltd`,
    html: `
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint la facture <strong>${number}</strong> d'un montant de
         <strong>${fmt(total, inv.currency)}</strong>, échéance le
         <strong>${dueAt.toLocaleDateString('fr-FR')}</strong>.</p>
      ${inv.vatReverseCharge ? '<p><em>VAT reverse charge applies.</em></p>' : ''}
      <p>Cordialement,<br>KR Global Solutions Ltd</p>
    `,
    attachments: [
      { filename: `${number}.pdf`, content: pdfBuffer },
    ],
  });

  if (mailError) throw new Error(`Erreur envoi email facture : ${mailError.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Facture générée et envoyée : ${number} — client=${inv.client.name}`,
  });

  return { number, r2Url, dueAt };
}
