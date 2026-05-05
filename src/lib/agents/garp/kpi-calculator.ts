import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type KPIPeriod = 'daily' | 'weekly' | 'monthly';

export interface KPIs {
  period:          KPIPeriod;
  period_start:    string;
  period_end:      string;
  // Financier
  revenus:         number;
  depenses:        number;
  marge_nette:     number;
  marge_pct:       number;
  cout_ia:         number;
  // Opérationnel
  nouveaux_clients:   number;
  taches_executees:   number;
  taux_succes:        number;
  // Comparaison période précédente
  revenus_prev:    number;
  depenses_prev:   number;
  clients_prev:    number;
  taches_prev:     number;
}

const REVENUE_CATEGORIES  = ['REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE'];
const EXPENSE_CATEGORIES  = ['SAAS', 'IA', 'PUBLICITE', 'FREELANCE', 'FRAIS_STRIPE', 'REMBOURSEMENT'];

function getPeriodDates(period: KPIPeriod): {
  start: Date; end: Date; prevStart: Date; prevEnd: Date;
} {
  const now = new Date();

  let start: Date;
  let prevStart: Date;
  const prevEnd = new Date();

  if (period === 'daily') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd.setTime(start.getTime());

  } else if (period === 'weekly') {
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    start = new Date(now);
    start.setDate(now.getDate() - dow + 1);
    start.setHours(0, 0, 0, 0);
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd.setTime(start.getTime());

  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd.setTime(start.getTime());
  }

  return { start, end: now, prevStart, prevEnd };
}

async function sumTransactions(
  categories: string[],
  startISO: string,
  endISO:   string
): Promise<number> {
  const { data } = await supabase
    .from('transactions')
    .select('amount')
    .in('category', categories)
    .gte('date', startISO)
    .lt('date', endISO);

  return ((data ?? []) as { amount: number }[])
    .reduce((s, r) => s + (r.amount ?? 0), 0);
}

async function sumAICosts(startISO: string, endISO: string): Promise<number> {
  const { data } = await supabase
    .from('couts_par_entite')
    .select('cout_estime')
    .gte('created_at', startISO)
    .lt('created_at', endISO);

  return ((data ?? []) as { cout_estime: number }[])
    .reduce((s, r) => s + (r.cout_estime ?? 0), 0);
}

async function countNewClients(startISO: string, endISO: string): Promise<number> {
  const { count } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startISO)
    .lt('created_at', endISO);
  return count ?? 0;
}

async function getAgentTaskStats(
  startISO: string,
  endISO:   string
): Promise<{ total: number; success: number }> {
  const { data } = await supabase
    .from('agent_tasks')
    .select('status')
    .gte('started_at', startISO)
    .lt('started_at', endISO);

  const rows = (data ?? []) as { status: string }[];
  return {
    total:   rows.length,
    success: rows.filter(r => r.status === 'completed').length,
  };
}

export async function calculateKPIs(period: KPIPeriod): Promise<KPIs> {
  const { start, end, prevStart, prevEnd } = getPeriodDates(period);

  const s  = start.toISOString();
  const e  = end.toISOString();
  const ps = prevStart.toISOString();
  const pe = prevEnd.toISOString();

  const [
    revenus, depenses, cout_ia,
    nouveaux_clients, tasks,
    revenus_prev, depenses_prev,
    clients_prev, tasks_prev,
  ] = await Promise.all([
    sumTransactions(REVENUE_CATEGORIES,  s,  e),
    sumTransactions(EXPENSE_CATEGORIES,  s,  e),
    sumAICosts(s, e),
    countNewClients(s, e),
    getAgentTaskStats(s, e),
    sumTransactions(REVENUE_CATEGORIES,  ps, pe),
    sumTransactions(EXPENSE_CATEGORIES,  ps, pe),
    countNewClients(ps, pe),
    getAgentTaskStats(ps, pe),
  ]);

  const marge_nette = revenus - depenses;
  const marge_pct   = revenus > 0 ? (marge_nette / revenus) * 100 : 0;
  const taux_succes = tasks.total > 0 ? (tasks.success / tasks.total) * 100 : 100;

  await supabase.from('alerts').insert({
    agent_name: 'GARP',
    level:      'INFO',
    message:    `KPIs calculés (${period}) : revenus=${revenus.toFixed(2)}€ marge=${marge_pct.toFixed(1)}% tâches=${tasks.total}`,
  });

  return {
    period, period_start: s, period_end: e,
    revenus, depenses, marge_nette, marge_pct, cout_ia,
    nouveaux_clients, taches_executees: tasks.total, taux_succes,
    revenus_prev, depenses_prev, clients_prev, taches_prev: tasks_prev.total,
  };
}
