import crypto           from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── R2 upload via AWS Sig V4 (même pattern que ZORO invoice-generator) ───────

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
  const ct        = 'image/jpeg';

  const now      = new Date();
  const dateISO  = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStr  = dateISO.slice(0, 8);
  const bodyHash = sha256Hex(body);

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

  const kDate     = hmac(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStr);
  const kRegion   = hmac(kDate, region);
  const kService  = hmac(kRegion, 's3');
  const kSigning  = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}/${bucket}/${key}`, {
    method: 'PUT',
    headers: {
      Authorization:         authorization,
      'Content-Type':        ct,
      'Content-Length':      String(body.length),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date':          dateISO,
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`R2 upload ${response.status}: ${err}`);
  }

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// ─── Replicate flux-pro ───────────────────────────────────────────────────────

interface ReplicatePrediction {
  id:      string;
  status:  'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?:  string;
}

async function startPrediction(prompt: string): Promise<string> {
  const res = await fetch(
    'https://api.replicate.com/v1/models/black-forest-labs/flux-pro/predictions',
    {
      method:  'POST',
      headers: {
        Authorization:  `Token ${process.env.REPLICATE_API_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'wait',
      },
      body: JSON.stringify({
        input: {
          prompt,
          width:            1024,
          height:           1024,
          output_format:    'jpg',
          output_quality:   90,
          safety_tolerance: 2,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate start ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as ReplicatePrediction;

  // "Prefer: wait" peut résoudre directement
  if (data.status === 'succeeded') {
    const out = Array.isArray(data.output) ? data.output[0] : data.output;
    if (out) return `__resolved__${out}`;
  }

  return data.id;
}

async function pollPrediction(predictionId: string, maxWaitMs = 120_000): Promise<string> {
  if (predictionId.startsWith('__resolved__')) {
    return predictionId.slice('__resolved__'.length);
  }

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));

    const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${process.env.REPLICATE_API_KEY}` },
    });

    if (!res.ok) throw new Error(`Replicate poll ${res.status}`);

    const data = (await res.json()) as ReplicatePrediction;

    if (data.status === 'succeeded') {
      const out = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!out) throw new Error('Replicate: output vide');
      return out;
    }

    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Replicate: ${data.status} — ${data.error ?? ''}`);
    }
  }

  throw new Error('Replicate: timeout image dépassé (120s)');
}

// ─── Export principal ─────────────────────────────────────────────────────────

export async function generateAndUploadImage(
  prompt:    string,
  contentId: string
): Promise<string> {
  const predictionId = await startPrediction(prompt);
  const imageUrl     = await pollPrediction(predictionId);

  // Télécharger l'image depuis Replicate
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Téléchargement image ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Upload vers R2
  const key       = `social-images/${contentId}-${Date.now()}.jpg`;
  const publicUrl = await uploadToR2(key, buffer);

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:    `Image générée (flux-pro) et uploadée R2 : ${key}`,
  });

  return publicUrl;
}
