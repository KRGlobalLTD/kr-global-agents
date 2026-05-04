const BASE = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
const KEY  = process.env.QDRANT_API_KEY ?? '';

export async function qdrant<T = unknown>(
  method: string,
  path:   string,
  body?:  unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'api-key':      KEY,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Qdrant ${method} ${path} → ${res.status}: ${text}`);

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function ping(): Promise<string> {
  const data = await qdrant<{ version: string }>('GET', '/');
  return data.version;
}
