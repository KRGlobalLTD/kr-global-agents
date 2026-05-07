import { createClient } from '@supabase/supabase-js';
import { googleGet, googlePost } from './google-auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const CATEGORY_ORDER = [
  'AI', 'Infrastructure', 'Domains', 'Taxes',
  'Banking', 'Marketing', 'Operations', 'SaaS', 'Other',
];

interface DriveFile { id: string; name: string }
interface DriveFileList { files: DriveFile[] }

export interface DriveUploadResult {
  fileId:  string;
  fileUrl: string;
}

interface OrganizeInput {
  buffer:      Buffer;
  filename:    string;
  provider:    string;
  category:    string;
  amount:      number;
  currency:    string;
  invoiceDate: string; // YYYY-MM-DD
}

// Ensure a named folder exists under a parent; return its ID
async function ensureFolder(name: string, parentId: string): Promise<string> {
  const q     = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list  = await googleGet<DriveFileList>(`${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);

  if (list.files.length > 0) return list.files[0].id;

  const created = await googlePost<DriveFile>(`${DRIVE_BASE}/files`, {
    name:     name,
    mimeType: 'application/vnd.google-apps.folder',
    parents:  [parentId],
  });
  return created.id;
}

async function buildFolderPath(year: string, category: string, provider: string): Promise<string> {
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const yearId     = await ensureFolder(year, rootId);
  const cat        = CATEGORY_ORDER.includes(category) ? category : 'Other';
  const categoryId = await ensureFolder(cat, yearId);
  const providerId = await ensureFolder(provider, categoryId);

  return providerId;
}

function buildFileName(provider: string, amount: number, currency: string, invoiceDate: string): string {
  const [year, month] = invoiceDate.split('-');
  const safe = provider.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const amt  = amount.toFixed(0);
  return `${year}-${month}_${safe}_${amt}_${currency}.pdf`;
}

async function uploadFileToDrive(
  buffer: Buffer,
  fileName: string,
  folderId: string,
  mimeType = 'application/pdf',
): Promise<DriveFile> {
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      metadata +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(closeDelimiter),
  ]);

  const token = (await import('./google-auth')).getGoogleAccessToken;
  const accessToken = await token();

  const res = await fetch(`${UPLOAD_BASE}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload ${res.status}: ${err.slice(0, 200)}`);
  }

  return res.json() as Promise<DriveFile>;
}

export async function organizeDriveFile(input: OrganizeInput): Promise<DriveUploadResult> {
  const year      = input.invoiceDate.split('-')[0] ?? new Date().getFullYear().toString();
  const folderId  = await buildFolderPath(year, input.category, input.provider);
  const fileName  = buildFileName(input.provider, input.amount, input.currency, input.invoiceDate);

  const file = await uploadFileToDrive(input.buffer, fileName, folderId);
  const fileUrl = `https://drive.google.com/file/d/${file.id}/view`;

  void supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Fichier Drive organisé : ${fileName} (folder: ${folderId})`,
  });

  return { fileId: file.id, fileUrl };
}

export async function ensureFinanceFolderStructure(): Promise<Record<string, string>> {
  const rootId  = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  const year    = new Date().getFullYear().toString();
  const yearId  = await ensureFolder(year, rootId);
  const folders: Record<string, string> = { root: rootId, year: yearId };

  for (const cat of CATEGORY_ORDER) {
    folders[cat] = await ensureFolder(cat, yearId);
  }

  void supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Structure Drive Finance/${year} vérifiée — ${CATEGORY_ORDER.length} dossiers`,
  });

  return folders;
}
