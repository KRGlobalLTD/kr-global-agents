import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SlackChannel = 'general' | 'alertes';

interface SlackPayload {
  text: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

async function sendToSlack(channel: SlackChannel, payload: SlackPayload): Promise<void> {
  const webhookUrl =
    channel === 'alertes'
      ? process.env.SLACK_WEBHOOK_ALERTES!
      : process.env.SLACK_WEBHOOK_GENERAL!;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      username: payload.username ?? 'HASHIRAMA',
      icon_emoji: payload.icon_emoji ?? ':robot_face:',
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook échoué : ${response.status}`);
  }
}

async function logNotification(channel: SlackChannel, message: string): Promise<void> {
  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message: `[Slack #${channel}] Notification envoyée`,
  });
}

export async function sendDailyReport(reportText: string): Promise<void> {
  await sendToSlack('general', {
    text: reportText,
    icon_emoji: ':bar_chart:',
  });
  await logNotification('general', 'Rapport quotidien envoyé');
}

export async function sendAlert(
  agentName: string,
  message: string,
  isUrgent: boolean
): Promise<void> {
  const prefix = isUrgent ? '<!channel> 🚨 *URGENT* ' : '⚠️ ';
  const text = `${prefix}[${agentName}] ${message}`;

  await sendToSlack('alertes', {
    text,
    icon_emoji: isUrgent ? ':rotating_light:' : ':warning:',
  });

  await supabase.from('alerts').insert({
    agent_name: agentName,
    level: isUrgent ? 'URGENT' : 'WARNING',
    message: 'Alerte envoyée sur Slack #alertes',
  });
}

export async function sendValidationRequest(
  agentName: string,
  action: string,
  amount: number
): Promise<void> {
  const text =
    `⏳ *Validation requise* — [${agentName}]\n` +
    `Action : ${action}\n` +
    `Montant : ${amount.toFixed(2)}€ (entre 50€ et 200€)\n` +
    `Répondez ✅ pour approuver ou ❌ pour refuser.`;

  await sendToSlack('alertes', { text, icon_emoji: ':hourglass:' });

  await supabase.from('alerts').insert({
    agent_name: agentName,
    level: 'WARNING',
    message: 'Demande de validation envoyée sur Slack',
  });
}
