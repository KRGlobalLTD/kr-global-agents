import { createClient } from '@supabase/supabase-js';
import {
  sendProjectBriefEmail,
  sendStatusUpdateEmail,
  sendNpsEmail,
  type NamiClient,
} from './email-templates';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

interface ClientRow extends NamiClient {
  status: string;
  last_active_at: string | null;
  email_brief_sent: string | null;
  email_update_sent: string | null;
  email_nps_sent: string | null;
}

export interface RetentionResult {
  processed: number;
  emailsSent: number;
  atRiskDetected: number;
}

// ---- Helpers ----

function daysSince(isoDate: string): number {
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / 86_400_000);
}

async function alertProspects(client: ClientRow, reason: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_PROSPECTS!;

  const text =
    `⚠️ *NAMI — Client à risque*\n` +
    `Nom : ${client.name}\n` +
    `Email : ${client.email}\n` +
    (client.company ? `Société : ${client.company}\n` : '') +
    `Produit : ${client.product ?? 'N/A'}\n` +
    `Raison : ${reason}\n` +
    `Action recommandée : prise de contact directe.`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username: 'NAMI',
      icon_emoji: ':warning:',
    }),
  });

  if (!response.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'NAMI',
      level: 'WARNING',
      message: `Échec alerte #prospects pour client id=${client.id} (HTTP ${response.status})`,
    });
  }
}

// ---- Détection des clients à risque ----

async function detectAndFlagAtRisk(clients: ClientRow[]): Promise<number> {
  const atRisk = clients.filter((c) => {
    if (c.status !== 'ACTIVE') return false;
    const onboardedDays = daysSince(c.onboarded_at);
    if (onboardedDays < 14) return false; // trop tôt pour juger

    // Jamais été actif depuis l'onboarding
    if (!c.last_active_at) return true;

    // Inactif depuis > 14 jours
    return daysSince(c.last_active_at) > 14;
  });

  for (const client of atRisk) {
    try {
      await supabase
        .from('clients')
        .update({ status: 'AT_RISK' })
        .eq('id', client.id);

      const reason = !client.last_active_at
        ? `Aucune activité depuis l'onboarding (${daysSince(client.onboarded_at)}j)`
        : `Inactif depuis ${daysSince(client.last_active_at!)}j`;

      await alertProspects(client, reason);

      await supabase.from('alerts').insert({
        agent_name: 'NAMI',
        level: 'WARNING',
        message: `Client AT_RISK détecté : id=${client.id} — ${reason}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      await supabase.from('alerts').insert({
        agent_name: 'NAMI',
        level: 'WARNING',
        message: `Erreur flagging AT_RISK client id=${client.id} : ${msg.slice(0, 120)}`,
      });
    }
  }

  return atRisk.length;
}

// ---- Séquence emails programmés ----

async function processScheduledEmails(clients: ClientRow[]): Promise<number> {
  let sent = 0;

  for (const client of clients) {
    if (client.status === 'CHURNED' || client.status === 'COMPLETED') continue;

    const days = daysSince(client.onboarded_at);

    try {
      // J+1 : brief projet
      if (days >= 1 && !client.email_brief_sent) {
        await sendProjectBriefEmail(client);
        sent++;
        continue; // un email par cycle
      }

      // J+7 : update statut
      if (days >= 7 && !client.email_update_sent) {
        await sendStatusUpdateEmail(client);
        sent++;
        continue;
      }

      // J+30 : NPS satisfaction
      if (days >= 30 && !client.email_nps_sent) {
        await sendNpsEmail(client);
        sent++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      await supabase.from('alerts').insert({
        agent_name: 'NAMI',
        level: 'WARNING',
        message: `Erreur email séquence client id=${client.id} : ${msg.slice(0, 120)}`,
      });
    }
  }

  return sent;
}

// ---- Point d'entrée principal ----

export async function runRetentionCycle(): Promise<RetentionResult> {
  const { data, error } = await supabase
    .from('clients')
    .select(
      'id, name, email, company, product, amount_paid, currency, onboarded_at, ' +
      'status, last_active_at, email_brief_sent, email_update_sent, email_nps_sent'
    )
    .in('status', ['ACTIVE', 'AT_RISK']);

  if (error) throw new Error(`Erreur lecture clients : ${error.message}`);

  const clients = (data ?? []) as unknown as ClientRow[];

  const [emailsSent, atRiskDetected] = await Promise.all([
    processScheduledEmails(clients),
    detectAndFlagAtRisk(clients),
  ]);

  await supabase.from('alerts').insert({
    agent_name: 'NAMI',
    level: 'INFO',
    message:
      `Cycle rétention : ${clients.length} clients, ` +
      `${emailsSent} email(s) envoyé(s), ${atRiskDetected} client(s) AT_RISK`,
  });

  return { processed: clients.length, emailsSent, atRiskDetected };
}

// ---- Marquer un client comme complété ----

export async function markClientCompleted(clientId: string): Promise<void> {
  await supabase
    .from('clients')
    .update({ status: 'COMPLETED' })
    .eq('id', clientId);

  await supabase.from('alerts').insert({
    agent_name: 'NAMI',
    level: 'INFO',
    message: `Client marqué COMPLETED : id=${clientId}`,
  });
}
