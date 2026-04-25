import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export interface BackupResult {
  success:      boolean;
  r2Key?:       string;
  sizeBytes?:   number;
  durationMs?:  number;
  tablesBackup: string[];
  rowsExported: number;
  error?:       string;
}

// ---- Tables à sauvegarder (toutes les tables critiques du système) ----

const BACKUP_TABLES: Array<{ name: string; limit: number }> = [
  // Infrastructure
  { name: 'agents_status',      limit: 0     },
  { name: 'tool_status',        limit: 1000  },
  { name: 'backups',            limit: 500   },
  // Audit (logs récents seulement)
  { name: 'alerts',             limit: 2000  },
  { name: 'daily_reports',      limit: 100   },
  // Finance (ZORO)
  { name: 'transactions',       limit: 0     },
  { name: 'monthly_reports',    limit: 0     },
  { name: 'invoices',           limit: 0     },
  { name: 'tool_costs',         limit: 0     },
  { name: 'uk_deadlines',       limit: 0     },
  // Clients (NAMI)
  { name: 'clients',            limit: 0     },
  // Prospects (LUFFY / KILLUA)
  { name: 'prospects',          limit: 0     },
  { name: 'campaigns',          limit: 0     },
  // Contenu (ITACHI)
  { name: 'content',            limit: 0     },
  { name: 'content_metrics',    limit: 5000  },
  { name: 'couts_par_entite',   limit: 5000  },
  // Réseaux sociaux (SANJI)
  { name: 'social_publications', limit: 0   },
  { name: 'social_mentions',    limit: 2000  },
  // Support (ROBIN)
  { name: 'tickets',            limit: 0     },
  // RH (CHOPPER)
  { name: 'freelances',         limit: 0     },
  { name: 'missions',           limit: 0     },
  { name: 'contracts',          limit: 0     },
];

// ---- Export d'une table ----

async function exportTable(
  tableName: string,
  limit: number
): Promise<{ rows: unknown[]; error?: string }> {
  try {
    let query = supabase.from(tableName).select('*').order('created_at', { ascending: false });
    if (limit > 0) query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      // Table absente ou non accessible → on skip sans planter
      return { rows: [], error: error.message };
    }
    return { rows: data ?? [] };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : 'Erreur inconnue' };
  }
}

// ---- AWS Signature V4 pour Cloudflare R2 ----

function hmac(key: Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function signingKey(
  secretKey: string,
  dateStamp: string,
  region:    string,
  service:   string
): Buffer {
  return hmac(
    hmac(
      hmac(
        hmac(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStamp),
        region
      ),
      service
    ),
    'aws4_request'
  );
}

async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  const accountId  = process.env.R2_ACCOUNT_ID!;
  const accessKey  = process.env.R2_ACCESS_KEY_ID!;
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY!;
  const bucketName = process.env.R2_BUCKET_NAME!;

  if (!accountId || !accessKey || !secretKey || !bucketName) {
    throw new Error('Variables R2 manquantes (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)');
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const region   = 'auto';
  const service  = 's3';

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256hex(body);
  const host        = `${accountId}.r2.cloudflarestorage.com`;

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    'PUT',
    `/${bucketName}/${encodedKey}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign    = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join('\n');

  const sigKey   = signingKey(secretKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', sigKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${endpoint}/${bucketName}/${encodedKey}`, {
    method:  'PUT',
    headers: {
      'Content-Type':         contentType,
      'x-amz-date':           amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization:          authorization,
      'Content-Length':       String(body.length),
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 upload ${res.status}: ${err}`);
  }
}

// ---- Orchestrateur principal ----

export async function runBackup(): Promise<BackupResult> {
  const startedAt = Date.now();

  // Créer un enregistrement "running" en base
  const { data: backupRow, error: insertError } = await supabase
    .from('backups')
    .insert({
      type:   'supabase_tables',
      status: 'running',
    })
    .select('id')
    .single();

  if (insertError) throw new Error(`Impossible de créer l'enregistrement backup : ${insertError.message}`);
  const backupId = (backupRow as { id: string }).id;

  const backedTables:  string[] = [];
  const skippedTables: string[] = [];
  let   totalRows = 0;

  // Exporter toutes les tables
  const exportedData: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    const { rows, error } = await exportTable(table.name, table.limit);
    if (error) {
      skippedTables.push(table.name);
    } else {
      exportedData[table.name] = rows;
      backedTables.push(table.name);
      totalRows += rows.length;
    }
  }

  // Construire le JSON de backup
  const backupPayload = {
    backup_at:      new Date().toISOString(),
    agent:          'OROCHIMARU',
    kr_global:      'KR Global Solutions Ltd',
    tables_backed:  backedTables,
    tables_skipped: skippedTables,
    total_rows:     totalRows,
    data:           exportedData,
  };

  const jsonBuffer  = Buffer.from(JSON.stringify(backupPayload), 'utf8');
  const gzipBuffer  = gzipSync(jsonBuffer);
  const sizeBytes   = gzipBuffer.length;

  // Clé R2 : backups/supabase/YYYY/MM/backup-<timestamp>.json.gz
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ts    = now.toISOString().replace(/[:.]/g, '-');
  const r2Key = `backups/supabase/${year}/${month}/backup-${ts}.json.gz`;

  try {
    await uploadToR2(r2Key, gzipBuffer, 'application/gzip');
  } catch (uploadErr) {
    const errMsg = uploadErr instanceof Error ? uploadErr.message : 'Erreur upload R2';

    await supabase
      .from('backups')
      .update({
        status:        'failed',
        error_message: errMsg,
        duration_ms:   Date.now() - startedAt,
        tables_backed: backedTables,
        rows_exported: totalRows,
      })
      .eq('id', backupId);

    await supabase.from('alerts').insert({
      agent_name: 'OROCHIMARU',
      level:      'URGENT',
      message:    `Backup ÉCHEC — upload R2 : ${errMsg.slice(0, 200)}`,
    });

    return {
      success:      false,
      tablesBackup: backedTables,
      rowsExported: totalRows,
      error:        errMsg,
    };
  }

  const durationMs = Date.now() - startedAt;

  // Marquer le backup comme réussi
  await supabase
    .from('backups')
    .update({
      status:        'success',
      r2_key:        r2Key,
      size_bytes:    sizeBytes,
      duration_ms:   durationMs,
      tables_backed: backedTables,
      rows_exported: totalRows,
    })
    .eq('id', backupId);

  await supabase.from('alerts').insert({
    agent_name: 'OROCHIMARU',
    level:      'INFO',
    message:
      `Backup réussi : ${backedTables.length} tables, ${totalRows} lignes, ` +
      `${(sizeBytes / 1024).toFixed(1)} Ko gzip, ${durationMs}ms → ${r2Key}`,
  });

  return {
    success:      true,
    r2Key,
    sizeBytes,
    durationMs,
    tablesBackup: backedTables,
    rowsExported: totalRows,
  };
}

// ---- Dernier backup ----

export async function getLastBackup(): Promise<{
  created_at: string;
  status:     string;
  r2_key:     string | null;
  size_bytes: number | null;
  rows_exported: number | null;
} | null> {
  const { data } = await supabase
    .from('backups')
    .select('created_at, status, r2_key, size_bytes, rows_exported')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data as {
    created_at: string; status: string; r2_key: string | null;
    size_bytes: number | null; rows_exported: number | null;
  } | null;
}
