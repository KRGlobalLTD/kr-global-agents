import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

type DeadlineType = 'CONFIRMATION_STATEMENT' | 'ANNUAL_ACCOUNTS' | 'CORPORATION_TAX' | 'VAT';

interface UkDeadline {
  id: string;
  title: string;
  deadline_type: DeadlineType;
  due_date: string;          // YYYY-MM-DD
  entity: string;
  alert_sent_30d: string | null;
  alert_sent_14d: string | null;
  alert_sent_7d: string | null;
  completed_at: string | null;
  notes: string | null;
}

const DEADLINE_LABELS: Record<DeadlineType, string> = {
  CONFIRMATION_STATEMENT: 'Confirmation Statement (Companies House)',
  ANNUAL_ACCOUNTS:        'Annual Accounts (Companies House)',
  CORPORATION_TAX:        'Corporation Tax Return (HMRC)',
  VAT:                    'Déclaration TVA (HMRC VAT)',
};

const DEADLINE_PENALTIES: Record<DeadlineType, string> = {
  CONFIRMATION_STATEMENT: 'Risque de dissolution administrative',
  ANNUAL_ACCOUNTS:        'Amende £150 à £1,500 + dissolution potentielle',
  CORPORATION_TAX:        'Amende £100 + intérêts HMRC',
  VAT:                    'Pénalités HMRC + intérêts',
};

// ---- Envoi Slack ----

async function sendDeadlineAlert(
  deadline: UkDeadline,
  daysLeft: number
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_ALERTES!;
  const isUrgent   = daysLeft <= 7;

  const prefix = isUrgent ? '<!channel> 🚨 *URGENT* ' : '⚠️ ';
  const label  = DEADLINE_LABELS[deadline.deadline_type];
  const penalty = DEADLINE_PENALTIES[deadline.deadline_type];

  const text =
    `${prefix}*ZORO — Échéance UK dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}*\n` +
    `Type : ${label}\n` +
    `Entité : ${deadline.entity}\n` +
    `Date limite : ${deadline.due_date}\n` +
    `Conséquences : ${penalty}\n` +
    (deadline.notes ? `Notes : ${deadline.notes}\n` : '');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username: 'ZORO',
      icon_emoji: isUrgent ? ':rotating_light:' : ':calendar:',
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook alertes échoué : ${response.status}`);
  }
}

// ---- Logique principale ----

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}

type AlertThreshold = 30 | 14 | 7;

interface AlertConfig {
  days: AlertThreshold;
  column: 'alert_sent_30d' | 'alert_sent_14d' | 'alert_sent_7d';
  sentField: keyof Pick<UkDeadline, 'alert_sent_30d' | 'alert_sent_14d' | 'alert_sent_7d'>;
}

const ALERT_CONFIGS: AlertConfig[] = [
  { days: 30, column: 'alert_sent_30d', sentField: 'alert_sent_30d' },
  { days: 14, column: 'alert_sent_14d', sentField: 'alert_sent_14d' },
  { days: 7,  column: 'alert_sent_7d',  sentField: 'alert_sent_7d'  },
];

export async function checkDeadlines(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Toutes les échéances non complétées
  const { data, error } = await supabase
    .from('uk_deadlines')
    .select('id, title, deadline_type, due_date, entity, alert_sent_30d, alert_sent_14d, alert_sent_7d, completed_at, notes')
    .is('completed_at', null)
    .gte('due_date', today.toISOString().split('T')[0]); // ignorer les passées

  if (error) throw new Error(`Erreur lecture uk_deadlines : ${error.message}`);

  const deadlines = (data ?? []) as UkDeadline[];
  let alertsSent  = 0;

  for (const dl of deadlines) {
    const dueDate  = new Date(dl.due_date);
    const daysLeft = daysBetween(today, dueDate);

    for (const cfg of ALERT_CONFIGS) {
      if (daysLeft > cfg.days) continue;            // pas encore la fenêtre
      if (dl[cfg.sentField] !== null) continue;     // déjà envoyé

      try {
        await sendDeadlineAlert(dl, daysLeft);

        await supabase
          .from('uk_deadlines')
          .update({ [cfg.column]: new Date().toISOString() })
          .eq('id', dl.id);

        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: daysLeft <= 7 ? 'WARNING' : 'INFO',
          message: `Alerte échéance J-${cfg.days} envoyée : ${dl.deadline_type} — ${dl.entity}`,
        });

        alertsSent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'URGENT',
          message: `Échec alerte échéance ${dl.deadline_type} : ${msg.slice(0, 120)}`,
        });
      }
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Vérification échéances UK : ${deadlines.length} examinées, ${alertsSent} alertes envoyées`,
  });
}

// ---- Utilitaires ----

export async function markDeadlineCompleted(id: string): Promise<void> {
  const { error } = await supabase
    .from('uk_deadlines')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`Erreur mise à jour échéance : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Échéance marquée complétée : id=${id}`,
  });
}

export async function getUpcomingDeadlines(daysAhead = 60): Promise<UkDeadline[]> {
  const today  = new Date();
  const cutoff = new Date(today.getTime() + daysAhead * 86_400_000);

  const { data, error } = await supabase
    .from('uk_deadlines')
    .select('*')
    .is('completed_at', null)
    .gte('due_date', today.toISOString().split('T')[0])
    .lte('due_date', cutoff.toISOString().split('T')[0])
    .order('due_date', { ascending: true });

  if (error) throw new Error(`Erreur lecture échéances : ${error.message}`);

  return (data ?? []) as UkDeadline[];
}
