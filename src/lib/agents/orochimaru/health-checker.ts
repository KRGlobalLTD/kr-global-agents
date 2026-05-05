import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type ToolName =
  | 'supabase'
  | 'stripe'
  | 'openrouter'
  | 'resend'
  | 'qdrant'
  | 'n8n'
  | 'slack_general'
  | 'slack_alertes'
  | 'slack_erreurs';

export type ServiceStatus = 'up' | 'down' | 'degraded' | 'unknown';

export interface ToolCheckResult {
  tool:            ToolName;
  status:          ServiceStatus;
  responseTimeMs:  number;
  error?:          string;
}

export interface HealthReport {
  checkedAt:    string;
  results:      ToolCheckResult[];
  allUp:        boolean;
  criticalDown: ToolName[];
}

// Outils critiques → toujours alerter si down
const CRITICAL_TOOLS: ToolName[] = ['supabase', 'stripe', 'openrouter', 'resend', 'qdrant'];

// Seuils de dégradation
const DEGRADED_MS = 2_000;
const TIMEOUT_MS  = 10_000;

// ---- Fetch avec timeout ----

async function fetchWithTimeout(
  url:     string,
  init?:   RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function statusFromMs(ms: number, ok: boolean): ServiceStatus {
  if (!ok)         return 'down';
  if (ms > DEGRADED_MS) return 'degraded';
  return 'up';
}

// ---- Checks individuels ----

async function checkSupabase(): Promise<ToolCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase
      .from('alerts')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    const ms = Date.now() - start;
    if (error) return { tool: 'supabase', status: 'down', responseTimeMs: ms, error: error.message };
    return { tool: 'supabase', status: statusFromMs(ms, true), responseTimeMs: ms };
  } catch (err) {
    return {
      tool: 'supabase', status: 'down',
      responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Erreur inconnue',
    };
  }
}

async function checkStripe(): Promise<ToolCheckResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { tool: 'stripe', status: 'unknown', responseTimeMs: 0, error: 'STRIPE_SECRET_KEY absent' };

  const start = Date.now();
  try {
    const res = await fetchWithTimeout('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
    });
    const ms = Date.now() - start;
    return { tool: 'stripe', status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool: 'stripe', status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkOpenRouter(): Promise<ToolCheckResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { tool: 'openrouter', status: 'unknown', responseTimeMs: 0, error: 'OPENROUTER_API_KEY absent' };

  const start = Date.now();
  try {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const ms = Date.now() - start;
    return { tool: 'openrouter', status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool: 'openrouter', status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkResend(): Promise<ToolCheckResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { tool: 'resend', status: 'unknown', responseTimeMs: 0, error: 'RESEND_API_KEY absent' };

  const start = Date.now();
  try {
    const res = await fetchWithTimeout('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const ms = Date.now() - start;
    return { tool: 'resend', status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool: 'resend', status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkQdrant(): Promise<ToolCheckResult> {
  const url = process.env.QDRANT_URL;
  const key = process.env.QDRANT_API_KEY;
  if (!url) return { tool: 'qdrant', status: 'unknown', responseTimeMs: 0, error: 'QDRANT_URL absent' };

  const start = Date.now();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['api-key'] = key;
    const res = await fetchWithTimeout(`${url}/collections`, { headers });
    const ms  = Date.now() - start;
    return { tool: 'qdrant', status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool: 'qdrant', status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkN8n(): Promise<ToolCheckResult> {
  const url = process.env.N8N_URL;
  const key = process.env.N8N_API_KEY;
  if (!url) return { tool: 'n8n', status: 'unknown', responseTimeMs: 0, error: 'N8N_URL absent' };

  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${url}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': key ?? '' },
    });
    const ms  = Date.now() - start;
    return { tool: 'n8n', status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool: 'n8n', status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkSlackWebhook(tool: ToolName, webhookUrl: string | undefined): Promise<ToolCheckResult> {
  if (!webhookUrl) {
    return { tool, status: 'unknown', responseTimeMs: 0, error: 'Webhook URL absent' };
  }

  const start = Date.now();
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `🔍 OROCHIMARU — ping santé (${new Date().toISOString()})` }),
    });
    const ms = Date.now() - start;
    // Slack renvoie "ok" (HTTP 200) si le webhook est valide
    return { tool, status: statusFromMs(ms, res.ok), responseTimeMs: ms,
      error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { tool, status: 'down', responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Timeout' };
  }
}

// ---- Persistance des résultats ----

async function saveResults(results: ToolCheckResult[]): Promise<void> {
  const rows = results.map(r => ({
    tool_name:        r.tool,
    status:           r.status,
    response_time_ms: r.responseTimeMs,
    error_message:    r.error ?? null,
    checked_at:       new Date().toISOString(),
  }));

  await supabase.from('tool_status').insert(rows);
}

// ---- Fallbacks ----

async function activateFallback(result: ToolCheckResult): Promise<void> {
  const note = `Outil ${result.tool} ${result.status.toUpperCase()} ` +
    `(${result.responseTimeMs}ms)${result.error ? ` — ${result.error}` : ''}`;

  // Toujours logger dans Supabase si possible
  if (result.tool !== 'supabase') {
    await supabase.from('alerts').insert({
      agent_name: 'OROCHIMARU',
      level:      'URGENT',
      message:    `Fallback activé : ${note}`,
    }).then();
  }

  // Fallback spécifique par outil
  if (result.tool === 'slack_erreurs' || result.tool === 'slack_general' || result.tool === 'slack_alertes') {
    // Slack down → email de secours à Karim via Resend
    const karimEmail = process.env.KARIM_EMAIL;
    const resendKey  = process.env.RESEND_API_KEY;
    if (karimEmail && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    'OROCHIMARU · KR Global <agent@krglobalsolutionsltd.com>',
          to:      karimEmail,
          subject: `[OROCHIMARU] Slack ${result.tool} DOWN — alerte par email`,
          html:    `<p>${note}</p><p>Le webhook Slack est inaccessible. Vérification manuelle requise.</p>`,
        }),
      });
    }
  }

  if (result.tool === 'supabase') {
    // Supabase down → log console uniquement (impossible de logguer en DB)
    console.error(`[OROCHIMARU] CRITIQUE : Supabase DOWN — ${result.error ?? 'connexion refusée'}`);
  }
}

// ---- Alerte Slack #erreurs ----

async function alertSlackErreurs(criticalDown: ToolName[], results: ToolCheckResult[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_ERREURS;

  const lines = [
    `🔴 *OROCHIMARU — Outil(s) critique(s) DOWN*`,
    ``,
    ...criticalDown.map(t => {
      const r = results.find(x => x.tool === t);
      return `• *${t}* : ${r?.status.toUpperCase()} (${r?.responseTimeMs}ms)${r?.error ? ` — ${r.error}` : ''}`;
    }),
    ``,
    `Date : ${new Date().toISOString()}`,
  ];

  const body = JSON.stringify({
    text:        lines.join('\n'),
    username:    'OROCHIMARU',
    icon_emoji:  ':rotating_light:',
  });

  if (webhookUrl) {
    try {
      await fetchWithTimeout(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
    } catch {
      // Slack lui-même peut être down — le fallback est déjà géré dans activateFallback
    }
  }
}

// ---- Cycle principal ----

export async function runHealthCheck(): Promise<HealthReport> {
  const checkedAt = new Date().toISOString();

  // Tous les checks en parallèle
  const results = await Promise.all([
    checkSupabase(),
    checkStripe(),
    checkOpenRouter(),
    checkResend(),
    checkQdrant(),
    checkN8n(),
    checkSlackWebhook('slack_general',  process.env.SLACK_WEBHOOK),
    checkSlackWebhook('slack_alertes',  process.env.SLACK_WEBHOOK_ALERTES),
    checkSlackWebhook('slack_erreurs',  process.env.SLACK_WEBHOOK_ERREURS),
  ]);

  const criticalDown = results
    .filter(r => CRITICAL_TOOLS.includes(r.tool) && (r.status === 'down' || r.status === 'degraded'))
    .map(r => r.tool);

  const allUp = results.every(r => r.status === 'up');

  // Persistance (best-effort — Supabase peut être down)
  try {
    await saveResults(results);
  } catch {
    console.error('[OROCHIMARU] Impossible de sauvegarder les résultats de santé (Supabase down?)');
  }

  // Activer fallbacks pour les outils down
  for (const result of results) {
    if (result.status === 'down' || result.status === 'degraded') {
      await activateFallback(result).catch(() => undefined);
    }
  }

  // Alerte Slack si critique
  if (criticalDown.length > 0) {
    await alertSlackErreurs(criticalDown, results).catch(() => undefined);
  }

  // Log récapitulatif
  try {
    await supabase.from('alerts').insert({
      agent_name: 'OROCHIMARU',
      level:      criticalDown.length > 0 ? 'URGENT' : 'INFO',
      message:
        `Health check : ${results.filter(r => r.status === 'up').length}/${results.length} up` +
        (criticalDown.length > 0 ? ` — CRITIQUE : ${criticalDown.join(', ')}` : ''),
    });
  } catch {
    // silencieux si Supabase down
  }

  return { checkedAt, results, allUp, criticalDown };
}

// ---- Dernier statut connu par outil ----

export async function getLatestToolStatuses(): Promise<Record<ToolName, ToolCheckResult | null>> {
  const { data } = await supabase
    .from('tool_status')
    .select('tool_name, status, response_time_ms, error_message, checked_at')
    .order('checked_at', { ascending: false })
    .limit(100);

  const seen  = new Set<string>();
  const latest: Record<string, ToolCheckResult | null> = {};

  for (const row of data ?? []) {
    const name = row.tool_name as string;
    if (seen.has(name)) continue;
    seen.add(name);
    latest[name] = {
      tool:           name as ToolName,
      status:         row.status as ServiceStatus,
      responseTimeMs: row.response_time_ms as number ?? 0,
      error:          row.error_message as string ?? undefined,
    };
  }

  const allTools: ToolName[] = [
    'supabase', 'stripe', 'openrouter', 'resend',
    'qdrant', 'n8n',
    'slack_general', 'slack_alertes', 'slack_erreurs',
  ];
  for (const t of allTools) {
    if (!(t in latest)) latest[t] = null;
  }

  return latest as Record<ToolName, ToolCheckResult | null>;
}
