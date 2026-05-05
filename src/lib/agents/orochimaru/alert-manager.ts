import { createClient } from '@supabase/supabase-js';
import type { HealthReport } from './health-checker';
import type { SecretValidationResult } from './secret-validator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function postSlack(webhook: string, text: string): Promise<void> {
  await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, username: 'OROCHIMARU', icon_emoji: ':snake:' }),
  }).catch(() => undefined);
}

export async function logInfrastructure(
  service: string,
  status:  string,
  latencyMs?: number,
  error?:     string,
): Promise<void> {
  await supabase.from('infrastructure_logs').insert({
    service,
    status,
    latency_ms: latencyMs ?? null,
    error:      error ?? null,
  }).then();
}

export async function sendHealthAlert(report: HealthReport): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_ERREURS;
  if (!webhook || report.criticalDown.length === 0) return;

  const lines = [
    `:rotating_light: *OROCHIMARU — Infrastructure DOWN*`,
    '',
    ...report.criticalDown.map(tool => {
      const r = report.results.find(x => x.tool === tool);
      return `• *${tool}* : ${r?.status.toUpperCase()} (${r?.responseTimeMs}ms)${r?.error ? ` — ${r.error}` : ''}`;
    }),
    '',
    `_${new Date().toLocaleString('fr-FR')}_`,
  ];

  await postSlack(webhook, lines.join('\n'));

  await supabase.from('alerts').insert({
    agent_name: 'OROCHIMARU',
    level:      'URGENT',
    message:    `Services DOWN : ${report.criticalDown.join(', ')}`,
  });
}

export async function sendDailyHealthReport(report: HealthReport): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK;
  if (!webhook) return;

  const up       = report.results.filter(r => r.status === 'up').length;
  const total    = report.results.length;
  const emoji    = report.allUp ? ':white_check_mark:' : ':warning:';
  const avgMs    = Math.round(
    report.results.reduce((s, r) => s + r.responseTimeMs, 0) / total,
  );

  const lines = [
    `${emoji} *OROCHIMARU — Rapport infrastructure quotidien*`,
    '',
    `• Services : *${up}/${total}* opérationnels`,
    `• Latence moyenne : *${avgMs}ms*`,
    report.criticalDown.length > 0
      ? `• :red_circle: Down : ${report.criticalDown.join(', ')}`
      : `• :green_circle: Tous les services critiques sont UP`,
    '',
    ...report.results.map(r => {
      const dot = r.status === 'up' ? ':green_circle:' : r.status === 'degraded' ? ':yellow_circle:' : ':red_circle:';
      return `${dot} ${r.tool} — ${r.responseTimeMs}ms`;
    }),
    '',
    `_${new Date().toLocaleString('fr-FR')}_`,
  ];

  await postSlack(webhook, lines.join('\n'));
}

export async function sendSecretAlert(result: SecretValidationResult): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_ERREURS;
  if (!webhook || result.missing.length === 0) return;

  const lines = [
    `:key: *OROCHIMARU — Secrets manquants détectés*`,
    '',
    ...result.missing.map(k => `• \`${k}\``),
    '',
    `_${new Date().toLocaleString('fr-FR')}_`,
  ];

  await postSlack(webhook, lines.join('\n'));

  await supabase.from('alerts').insert({
    agent_name: 'OROCHIMARU',
    level:      'URGENT',
    message:    `Secrets manquants : ${result.missing.join(', ')}`,
  });
}
