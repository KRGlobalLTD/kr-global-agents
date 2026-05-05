export interface SecretValidationResult {
  missing:   string[];
  present:   string[];
  allPresent: boolean;
}

const REQUIRED_SECRETS: string[] = [
  'OPENROUTER_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'ZOHO_CLIENT_ID',
  'ZOHO_REFRESH_TOKEN',
  'QDRANT_URL',
  'QDRANT_API_KEY',
  'N8N_API_KEY',
  'JINA_API_KEY',
  'SLACK_WEBHOOK',
  'INTERNAL_API_TOKEN',
  'RESEND_API_KEY',
  'OPENROUTER_MODEL',
];

export function validateSecrets(): SecretValidationResult {
  const missing: string[] = [];
  const present: string[] = [];

  for (const key of REQUIRED_SECRETS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
    } else {
      present.push(key);
    }
  }

  return { missing, present, allPresent: missing.length === 0 };
}
