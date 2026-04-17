import { createClient } from '@supabase/supabase-js';
import { getAllAgentStatuses, AgentStatus } from './supervisor';
import { sendDailyReport } from './slack-notifier';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RevenueData {
  yesterday: number;
  currentMonth: number;
}

interface AlertSummary {
  level: string;
  agent_name: string;
  message: string;
  created_at: string;
}

interface AiSpending {
  total: number;
  currency: string;
}

interface ReportContent {
  date: string;
  revenue: RevenueData;
  agents: { agent_name: string; status: AgentStatus; last_run: string; errors: string | null }[];
  activeAlerts: AlertSummary[];
  aiSpending: AiSpending;
}

async function fetchRevenue(): Promise<RevenueData> {
  const now = new Date();
  const parisOffset = getParisDSTOffset(now);
  const parisNow = new Date(now.getTime() + parisOffset * 60 * 1000);

  const todayParis = parisNow.toISOString().split('T')[0];
  const firstOfMonth = `${todayParis.slice(0, 7)}-01`;

  const yesterday = new Date(parisNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data: yesterdayData } = await supabase
    .from('daily_reports')
    .select('content')
    .eq('date', yesterdayStr)
    .maybeSingle();

  const { data: monthData } = await supabase
    .from('daily_reports')
    .select('content')
    .gte('date', firstOfMonth)
    .lte('date', todayParis);

  const yesterdayRevenue =
    (yesterdayData?.content as { revenue?: number } | null)?.revenue ?? 0;

  const monthRevenue = (monthData ?? []).reduce((sum, row) => {
    const content = row.content as { revenue?: number } | null;
    return sum + (content?.revenue ?? 0);
  }, 0);

  return { yesterday: yesterdayRevenue, currentMonth: monthRevenue };
}

async function fetchActiveAlerts(): Promise<AlertSummary[]> {
  const { data, error } = await supabase
    .from('alerts')
    .select('level, agent_name, message, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(`Impossible de récupérer les alertes : ${error.message}`);
  return (data ?? []) as AlertSummary[];
}

async function fetchAiSpendingToday(): Promise<AiSpending> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('alerts')
    .select('message')
    .eq('agent_name', 'HASHIRAMA')
    .like('message', 'Dépense IA%')
    .gte('created_at', `${today}T00:00:00Z`);

  if (error) throw new Error(`Impossible de récupérer les dépenses IA : ${error.message}`);

  const total = (data ?? []).reduce((sum, row) => {
    const match = (row.message as string).match(/(\d+(?:\.\d+)?)€/);
    return sum + (match ? parseFloat(match[1]) : 0);
  }, 0);

  return { total, currency: 'EUR' };
}

function getParisDSTOffset(date: Date): number {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = date.getTimezoneOffset() < Math.max(jan, jul);
  return isDST ? 120 : 60;
}

function formatReportText(content: ReportContent): string {
  const agentLines = content.agents
    .map((a) => {
      const icon = a.status === 'OK' ? '✅' : a.status === 'ERREUR' ? '❌' : '⚠️';
      return `  ${icon} ${a.agent_name} — ${a.status}`;
    })
    .join('\n');

  const alertLines =
    content.activeAlerts.length === 0
      ? '  Aucune alerte active.'
      : content.activeAlerts
          .map((a) => `  [${a.level}] ${a.agent_name} : ${a.message}`)
          .join('\n');

  return (
    `📊 *Rapport quotidien HASHIRAMA — ${content.date}*\n\n` +
    `💰 *Revenus*\n` +
    `  Hier : ${content.revenue.yesterday.toFixed(2)}€\n` +
    `  Mois en cours : ${content.revenue.currentMonth.toFixed(2)}€\n\n` +
    `🤖 *Statut des agents*\n${agentLines}\n\n` +
    `🚨 *Alertes actives*\n${alertLines}\n\n` +
    `🧠 *Dépenses IA aujourd'hui*\n` +
    `  ${content.aiSpending.total.toFixed(4)}${content.aiSpending.currency}`
  );
}

/**
 * Génère et envoie le rapport quotidien.
 * À appeler à 7h heure de Paris via un cron.
 */
export async function generateAndSendDailyReport(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const [revenue, agents, activeAlerts, aiSpending] = await Promise.all([
    fetchRevenue(),
    getAllAgentStatuses(),
    fetchActiveAlerts(),
    fetchAiSpendingToday(),
  ]);

  const content: ReportContent = {
    date: today,
    revenue,
    agents,
    activeAlerts,
    aiSpending,
  };

  const { error: upsertError } = await supabase
    .from('daily_reports')
    .upsert({ date: today, content }, { onConflict: 'date' });

  if (upsertError) {
    throw new Error(`Impossible de sauvegarder le rapport : ${upsertError.message}`);
  }

  const reportText = formatReportText(content);
  await sendDailyReport(reportText);

  await supabase
    .from('daily_reports')
    .update({ sent_at: new Date().toISOString() })
    .eq('date', today);

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message: `Rapport quotidien généré et envoyé pour le ${today}`,
  });
}
