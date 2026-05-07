import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface TokenCache {
  token:     string;
  expiresAt: number; // ms timestamp
}

let _cache: TokenCache | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (_cache && Date.now() < _cache.expiresAt - 60_000) {
    return _cache.token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type:    'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth refresh failed ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  _cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };

  return _cache.token;
}

export async function googleGet<T>(url: string): Promise<T> {
  const token = await getGoogleAccessToken();
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API GET ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function googlePost<T>(url: string, body: unknown, contentType = 'application/json'): Promise<T> {
  const token = await getGoogleAccessToken();
  const res   = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body:    contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API POST ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function googlePatch<T>(url: string, body: unknown): Promise<T> {
  const token = await getGoogleAccessToken();
  const res   = await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API PATCH ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export { supabase };
