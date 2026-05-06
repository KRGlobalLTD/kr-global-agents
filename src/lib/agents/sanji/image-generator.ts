import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const r2 = new S3Client({
  region:   'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

const BUCKET      = process.env.R2_BUCKET_NAME  ?? 'kr-global-invoices';
const R2_BASE_URL = process.env.R2_PUBLIC_URL   ?? '';

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
          width:          1024,
          height:         1024,
          output_format:  'jpg',
          output_quality: 90,
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
  // Résolu en une seule requête (Prefer: wait)
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

async function uploadToR2(imageUrl: string, key: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Téléchargement image ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  await r2.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: 'image/jpeg',
  }));

  return `${R2_BASE_URL}/${key}`;
}

export async function generateAndUploadImage(
  prompt:    string,
  contentId: string
): Promise<string> {
  const predictionId = await startPrediction(prompt);
  const imageUrl     = await pollPrediction(predictionId);
  const key          = `social-images/${contentId}-${Date.now()}.jpg`;
  const publicUrl    = await uploadToR2(imageUrl, key);

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:    `Image générée (flux-pro) et uploadée : ${key}`,
  });

  return publicUrl;
}
