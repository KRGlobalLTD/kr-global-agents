import { createClient } from '@supabase/supabase-js';
import { getAllAgentStatuses, type AgentStatus } from './supervisor';
import { sendDailyReport } from './slack-notifier';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

interface DailyRevenue {
  stripe: number;
  gumroad: number;
  other: number;
  total: number;
}

interface HotProspect {
  name: string;
  contact_name: string | null;
  estimated_value: number | null;
}

interface AgentSnapshot {
  agent_name: string;
  status: AgentStatus;
  last_run: string;
  errors: string | null;
}

interface DailyReportData {
  date: string;
  revenue: DailyRevenue;
  hotProspects: HotProspect[];
  agents: AgentSnapshot[];
  unresolvedAlerts: number;
}

// ---- Collecte des données ----

async function fetchTodayRevenue(): Promise<DailyRevenue> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, category')
    .in('category', ['REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE', 'REMBOURSEMENT'])
    .gte('date', todayStart.toISOString());

  if (error) throw new Error(`Erreur lecture revenus du jour : ${error.message}`);

  const revenue: DailyRevenue = { stripe: 0, gumroad: 0, other: 0, total: 0 };
  let refunds = 0;

  for (const row of data ?? []) {
    switch (row.category) {
      case 'REVENU_STRIPE':  revenue.stripe  += row.amount as number; break;
      case 'REVENU_GUMROAD': revenue.gumroad += row.amount as number; break;
      case 'REVENU_AUTRE':   revenue.other   += row.amount as number; break;
      case 'REMBOURSEMENT':  refunds         += row.amount as number; break;
    }
  }

  revenue.stripe = Math.max(0, revenue.stripe - refunds);
  revenue.total  = revenue.stripe + revenue.gumroad + revenue.other;

  return revenue;
}

async function fetchHotProspects(): Promise<HotProspect[]> {
  // Table optionnelle — pas encore créée si pipeline CRM absent
  const { data, error } = await supabase
    .from('prospects')
    .select('name, contact_name, estimated_value')
    .eq('status', 'CHAUD')
    .order('estimated_value', { ascending: false })
    .limit(5);

  if (error) {
    // Table inexistante ou vide — on ne bloque pas le rapport
    await supabase.from('alerts').insert({
      agent_name: 'HASHIRAMA',
      level: 'INFO',
      message: 'Table prospects inaccessible — section omise du rapport',
    });
    return [];
  }

  return (data ?? []) as HotProspect[];
}

async function fetchUnresolvedAlertCount(): Promise<number> {
  const { count, error } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .is('resolved_at', null)
    .in('level', ['WARNING', 'URGENT']);

  if (error) return 0;
  return count ?? 0;
}

// ---- Formatage ----

function formatReport(data: DailyReportData): string {
  const date = new Date(data.date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const agentLines = data.agents.length > 0
    ? data.agents.map((a) => {
        const icon = a.status === 'OK' ? '✅' : a.status === 'ERREUR' ? '❌' : '⚠️';
        return `  ${icon} ${a.agent_name} — ${a.status}`;
      }).join('\n')
    : '  Aucun agent enregistré.';

  const prospectLines = data.hotProspects.length > 0
    ? data.hotProspects.map((p) => {
        const val = p.estimated_value != null ? ` (${p.estimated_value.toFixed(0)}€)` : '';
        const contact = p.contact_name ? ` · ${p.contact_name}` : '';
        return `  🔥 ${p.name}${val}${contact}`;
      }).join('\n')
    : '  Aucun prospect chaud en cours.';

  const alertBadge = data.unresolvedAlerts > 0
    ? `⚠️ ${data.unresolvedAlerts} alerte${data.unresolvedAlerts > 1 ? 's' : ''} non résolue${data.unresolvedAlerts > 1 ? 's' : ''}`
    : '✅ Aucune alerte active';

  return (
    `📊 *Rapport quotidien HASHIRAMA — ${date}*\n\n` +
    `💰 *Revenus du jour*\n` +
    `  • Stripe : ${data.revenue.stripe.toFixed(2)}€\n` +
    `  • Gumroad : ${data.revenue.gumroad.toFixed(2)}€\n` +
    `  • Autres : ${data.revenue.other.toFixed(2)}€\n` +
    `  *Total : ${data.revenue.total.toFixed(2)}€*\n\n` +
    `🔥 *Prospects chauds*\n${prospectLines}\n\n` +
    `🤖 *Statut des agents*\n${agentLines}\n\n` +
    `🚨 *Alertes* : ${alertBadge}`
  );
}

// ---- Point d'entrée principal ----

export async function generateDailyReport(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const [revenue, hotProspects, agents, unresolvedAlerts] = await Promise.all([
    fetchTodayRevenue(),
    fetchHotProspects(),
    getAllAgentStatuses(),
    fetchUnresolvedAlertCount(),
  ]);

  const reportData: DailyReportData = {
    date: today,
    revenue,
    hotProspects,
    agents: agents as AgentSnapshot[],
    unresolvedAlerts,
  };

  // Sauvegarde dans daily_reports (upsert pour idempotence)
  await supabase
    .from('daily_reports')
    .upsert({ date: today, content: reportData }, { onConflict: 'date' });

  const text = formatReport(reportData);
  await sendDailyReport(text);

  await supabase
    .from('daily_reports')
    .update({ sent_at: new Date().toISOString() })
    .eq('date', today);

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message: `Rapport quotidien généré et envoyé (revenus=${revenue.total.toFixed(2)}€, agents=${agents.length})`,
  });
}
