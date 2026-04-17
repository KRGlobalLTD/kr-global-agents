import { createClient } from '@supabase/supabase-js';
import type { Entity } from './cost-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

interface RevenueBySource {
  stripe: number;
  gumroad: number;
  other: number;
  total: number;
}

interface ExpenseByCategory {
  saas: number;
  ai: number;
  advertising: number;
  freelancers: number;
  stripeFees: number;
  total: number;
}

interface MonthlyComparison {
  previousRevenue: number;
  previousExpenses: number;
  previousMargin: number;
  revenueTrend: number;  // variation en %
  marginTrend: number;
}

interface MonthProjection {
  projectedRevenue: number;
  projectedExpenses: number;
  projectedMargin: number;
}

export interface PnLReport {
  month: number;
  year: number;
  revenue: RevenueBySource;
  expenses: ExpenseByCategory;
  netMargin: number;
  marginPercent: number;
  comparison: MonthlyComparison;
  projection: MonthProjection;
  generatedAt: string;
}

// ---- Helpers ----

async function fetchMonthTransactions(
  month: number,
  year: number,
  entity?: Entity
): Promise<{ amount: number; category: string; date: string }[]> {
  const from = new Date(year, month - 1, 1).toISOString();
  const to = new Date(year, month, 1).toISOString();

  let query = supabase
    .from('transactions')
    .select('amount, category, date')
    .gte('date', from)
    .lt('date', to);

  if (entity) query = query.eq('entity', entity);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture transactions : ${error.message}`);
  return (data ?? []) as { amount: number; category: string; date: string }[];
}

function aggregate(rows: { amount: number; category: string }[]): {
  revenue: RevenueBySource;
  expenses: ExpenseByCategory;
} {
  const revenue: RevenueBySource = { stripe: 0, gumroad: 0, other: 0, total: 0 };
  const expenses: ExpenseByCategory = { saas: 0, ai: 0, advertising: 0, freelancers: 0, stripeFees: 0, total: 0 };

  let refunds = 0;

  for (const row of rows) {
    switch (row.category) {
      case 'REVENU_STRIPE':   revenue.stripe    += row.amount; break;
      case 'REVENU_GUMROAD':  revenue.gumroad   += row.amount; break;
      case 'REVENU_AUTRE':    revenue.other     += row.amount; break;
      case 'REMBOURSEMENT':   refunds           += row.amount; break;
      case 'FRAIS_STRIPE':    expenses.stripeFees  += row.amount; break;
      case 'SAAS':            expenses.saas        += row.amount; break;
      case 'IA':              expenses.ai          += row.amount; break;
      case 'PUBLICITE':       expenses.advertising += row.amount; break;
      case 'FREELANCE':       expenses.freelancers += row.amount; break;
    }
  }

  // Les remboursements réduisent les revenus Stripe
  revenue.stripe = Math.max(0, revenue.stripe - refunds);
  revenue.total  = revenue.stripe + revenue.gumroad + revenue.other;
  expenses.total = expenses.saas + expenses.ai + expenses.advertising + expenses.freelancers + expenses.stripeFees;

  return { revenue, expenses };
}

function computeProjection(
  revenue: RevenueBySource,
  expenses: ExpenseByCategory,
  currentDay: number,
  totalDays: number
): MonthProjection {
  const ratio = totalDays / Math.max(1, currentDay);
  return {
    projectedRevenue:  revenue.total  * ratio,
    projectedExpenses: expenses.total * ratio,
    projectedMargin:   (revenue.total - expenses.total) * ratio,
  };
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

// ---- Core ----

export async function generateMonthlyReport(month: number, year: number): Promise<PnLReport> {
  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const currentDay  = isCurrentMonth ? now.getDate() : getDaysInMonth(month, year);
  const totalDays   = getDaysInMonth(month, year);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;

  const [currentRows, prevRows] = await Promise.all([
    fetchMonthTransactions(month, year),
    fetchMonthTransactions(prevMonth, prevYear),
  ]);

  const { revenue, expenses }           = aggregate(currentRows);
  const { revenue: prevRevenue, expenses: prevExpenses } = aggregate(prevRows);

  const netMargin    = revenue.total - expenses.total;
  const marginPercent = revenue.total > 0 ? (netMargin / revenue.total) * 100 : 0;
  const prevMargin   = prevRevenue.total - prevExpenses.total;

  const comparison: MonthlyComparison = {
    previousRevenue:  prevRevenue.total,
    previousExpenses: prevExpenses.total,
    previousMargin:   prevMargin,
    revenueTrend: prevRevenue.total > 0
      ? ((revenue.total - prevRevenue.total) / prevRevenue.total) * 100
      : 0,
    marginTrend: prevMargin !== 0
      ? ((netMargin - prevMargin) / Math.abs(prevMargin)) * 100
      : 0,
  };

  const projection = isCurrentMonth
    ? computeProjection(revenue, expenses, currentDay, totalDays)
    : { projectedRevenue: revenue.total, projectedExpenses: expenses.total, projectedMargin: netMargin };

  return {
    month,
    year,
    revenue,
    expenses,
    netMargin,
    marginPercent,
    comparison,
    projection,
    generatedAt: now.toISOString(),
  };
}

function formatReport(r: PnLReport): string {
  const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const sign = (v: number) => (v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`);

  return (
    `💼 *Rapport P&L ZORO — ${MONTHS[r.month - 1]} ${r.year}*\n\n` +
    `💰 *Revenus totaux : ${r.revenue.total.toFixed(2)}€* (${sign(r.comparison.revenueTrend)} vs mois précédent)\n` +
    `  • Stripe : ${r.revenue.stripe.toFixed(2)}€\n` +
    `  • Gumroad : ${r.revenue.gumroad.toFixed(2)}€\n` +
    `  • Autres : ${r.revenue.other.toFixed(2)}€\n\n` +
    `📉 *Dépenses totales : ${r.expenses.total.toFixed(2)}€*\n` +
    `  • Outils SaaS : ${r.expenses.saas.toFixed(2)}€\n` +
    `  • Coûts IA : ${r.expenses.ai.toFixed(2)}€\n` +
    `  • Publicité : ${r.expenses.advertising.toFixed(2)}€\n` +
    `  • Freelances : ${r.expenses.freelancers.toFixed(2)}€\n` +
    `  • Frais Stripe : ${r.expenses.stripeFees.toFixed(2)}€\n\n` +
    `📊 *Marge nette : ${r.netMargin.toFixed(2)}€ (${r.marginPercent.toFixed(1)}%)* (${sign(r.comparison.marginTrend)} vs mois précédent)\n\n` +
    `🔮 *Projection fin de mois*\n` +
    `  Revenus : ${r.projection.projectedRevenue.toFixed(2)}€\n` +
    `  Dépenses : ${r.projection.projectedExpenses.toFixed(2)}€\n` +
    `  Marge : ${r.projection.projectedMargin.toFixed(2)}€`
  );
}

export async function sendMonthlyReport(): Promise<void> {
  const now = new Date();

  // Le 1er du mois → rapport du mois précédent, sinon mois en cours
  const isFirstOfMonth = now.getDate() === 1;
  const rawMonth = now.getMonth() + 1;
  const month = isFirstOfMonth ? (rawMonth === 1 ? 12 : rawMonth - 1) : rawMonth;
  const year  = isFirstOfMonth && rawMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();

  const report = await generateMonthlyReport(month, year);
  const text   = formatReport(report);

  const { error: upsertError } = await supabase
    .from('monthly_reports')
    .upsert(
      {
        month:    report.month,
        year:     report.year,
        revenue:  report.revenue.total,
        expenses: report.expenses.total,
        content:  report,
      },
      { onConflict: 'month,year' }
    );

  if (upsertError) {
    throw new Error(`Erreur sauvegarde rapport mensuel : ${upsertError.message}`);
  }

  const response = await fetch(process.env.SLACK_WEBHOOK_GENERAL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'ZORO', icon_emoji: ':moneybag:' }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook général échoué : ${response.status}`);
  }

  await supabase
    .from('monthly_reports')
    .update({ sent_at: now.toISOString() })
    .eq('month', report.month)
    .eq('year', report.year);

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Rapport mensuel P&L envoyé pour ${report.month}/${report.year}`,
  });
}
