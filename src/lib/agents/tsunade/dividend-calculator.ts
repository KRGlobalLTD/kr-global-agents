import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type DividendStatus = 'calculated' | 'approved' | 'paid';

export interface DividendCalculation {
  id:                         string;
  quarter:                    number;
  year:                       number;
  revenue:                    number;
  expenses:                   number;
  gross_profit:               number;
  corporation_tax_rate:       number;
  corporation_tax:            number;
  profit_after_tax:           number;
  retained_earnings_rate:     number;
  retained_earnings_required: number;
  distributable_profit:       number;
  karim_share:                number;
  raphael_share:              number;
  currency:                   string;
  status:                     DividendStatus;
  approved_at:                string | null;
  paid_at:                    string | null;
  notes:                      string | null;
  created_at:                 string;
}

export interface DividendResult {
  calculation:         DividendCalculation;
  distributable:       boolean;
  slackAlertSent:      boolean;
}

// ---- Dates trimestrielles ----

function quarterDateRange(quarter: 1 | 2 | 3 | 4, year: number): { from: string; to: string } {
  const starts = [0, 3, 6, 9];       // index de mois (0-based) de début
  const startMonth = starts[quarter - 1];
  const from = new Date(year, startMonth, 1).toISOString();
  const to   = new Date(year, startMonth + 3, 1).toISOString();
  return { from, to };
}

// ---- Corporation Tax UK 2023+ (taux sur profit annualisé) ----
// Small profits rate : 19 % ≤ 50 000 £
// Main rate          : 25 % ≥ 250 000 £
// Marginal relief    : entre 50 000 £ et 250 000 £

function computeAnnualCorpTax(annualProfit: number): number {
  if (annualProfit <= 0)         return 0;
  if (annualProfit <= 50_000)    return annualProfit * 0.19;
  if (annualProfit >= 250_000)   return annualProfit * 0.25;
  // Marginal relief : 25 % - (3/200 × (250 000 - profit))
  return 0.25 * annualProfit - (3 / 200) * (250_000 - annualProfit);
}

function computeQuarterlyTax(quarterlyProfit: number): { tax: number; effectiveRate: number } {
  if (quarterlyProfit <= 0) return { tax: 0, effectiveRate: 0.19 };
  const annualized    = quarterlyProfit * 4;
  const annualTax     = computeAnnualCorpTax(annualized);
  const quarterlyTax  = annualTax / 4;
  const effectiveRate = annualTax / annualized;
  return { tax: quarterlyTax, effectiveRate };
}

// ---- Fetch transactions du trimestre ----

interface TransactionRow {
  amount:   number;
  category: string;
}

async function fetchQuarterTransactions(
  quarter: 1 | 2 | 3 | 4,
  year:    number
): Promise<TransactionRow[]> {
  const { from, to } = quarterDateRange(quarter, year);

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, category')
    .gte('date', from)
    .lt('date', to);

  if (error) throw new Error(`Erreur lecture transactions Q${quarter} ${year} : ${error.message}`);
  return (data ?? []) as unknown as TransactionRow[];
}

function aggregateQuarter(rows: TransactionRow[]): { revenue: number; expenses: number } {
  let revenue  = 0;
  let expenses = 0;
  let refunds  = 0;

  for (const row of rows) {
    switch (row.category) {
      case 'REVENU_STRIPE':
      case 'REVENU_GUMROAD':
      case 'REVENU_AUTRE':
        revenue += row.amount;
        break;
      case 'REMBOURSEMENT':
        refunds += row.amount;
        break;
      case 'SAAS':
      case 'IA':
      case 'PUBLICITE':
      case 'FREELANCE':
      case 'FRAIS_STRIPE':
        expenses += row.amount;
        break;
    }
  }

  revenue = Math.max(0, revenue - refunds);
  return { revenue, expenses };
}

// ---- Alerte Slack #general ----

async function alertSlackDividendes(
  quarter:     number,
  year:        number,
  karimShare:  number,
  raphaelShare: number,
  currency:    string
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_GENERAL;
  if (!webhookUrl) return;

  const fmt = (n: number) => `${n.toFixed(2)} ${currency}`;

  const text =
    `💰 *TSUNADE — Dividendes disponibles Q${quarter} ${year}*\n\n` +
    `Bénéfices distribuables calculés :\n` +
    `• Karim (50 %) : *${fmt(karimShare)}*\n` +
    `• Raphaël (50 %) : *${fmt(raphaelShare)}*\n\n` +
    `_Approbation requise avant versement. Utilisez l'API TSUNADE action=approve_dividends._`;

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'TSUNADE', icon_emoji: ':money_with_wings:' }),
  });

  if (!res.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'TSUNADE',
      level:      'WARNING',
      message:    `Slack #general webhook échoué (dividendes) : ${res.status}`,
    });
  }
}

// ---- Calcul principal ----

export async function calculateDividends(
  quarter:               1 | 2 | 3 | 4,
  year:                  number,
  retainedEarningsRate = 0.20    // 20 % de réserve de sécurité
): Promise<DividendResult> {
  const rows = await fetchQuarterTransactions(quarter, year);
  const { revenue, expenses } = aggregateQuarter(rows);

  const grossProfit = revenue - expenses;
  const { tax: corpTax, effectiveRate } = computeQuarterlyTax(grossProfit);

  const profitAfterTax           = Math.max(0, grossProfit - corpTax);
  const retainedEarningsRequired = profitAfterTax * retainedEarningsRate;
  const distributableProfit      = Math.max(0, profitAfterTax - retainedEarningsRequired);

  const karimShare   = distributableProfit * 0.5;
  const raphaelShare = distributableProfit * 0.5;

  // Upsert (recalcul possible pour le trimestre en cours)
  const { data, error } = await supabase
    .from('dividend_calculations')
    .upsert(
      {
        quarter,
        year,
        revenue:                    Math.round(revenue            * 100) / 100,
        expenses:                   Math.round(expenses           * 100) / 100,
        gross_profit:               Math.round(grossProfit        * 100) / 100,
        corporation_tax_rate:       Math.round(effectiveRate      * 10_000) / 10_000,
        corporation_tax:            Math.round(corpTax            * 100) / 100,
        profit_after_tax:           Math.round(profitAfterTax     * 100) / 100,
        retained_earnings_rate:     retainedEarningsRate,
        retained_earnings_required: Math.round(retainedEarningsRequired * 100) / 100,
        distributable_profit:       Math.round(distributableProfit * 100) / 100,
        karim_share:                Math.round(karimShare          * 100) / 100,
        raphael_share:              Math.round(raphaelShare        * 100) / 100,
        currency:                   'EUR',
        status:                     'calculated',
      },
      { onConflict: 'quarter,year' }
    )
    .select('*')
    .single();

  if (error) throw new Error(`Erreur sauvegarde dividendes : ${error.message}`);

  const calculation = data as unknown as DividendCalculation;
  const distributable = distributableProfit > 0;
  let slackAlertSent = false;

  if (distributable) {
    await alertSlackDividendes(quarter, year, karimShare, raphaelShare, 'EUR');
    slackAlertSent = true;
  }

  await supabase.from('alerts').insert({
    agent_name: 'TSUNADE',
    level:      'INFO',
    message:
      `Dividendes Q${quarter} ${year} : bénéfice brut=${grossProfit.toFixed(2)}€, ` +
      `distribuable=${distributableProfit.toFixed(2)}€ ` +
      `(Karim=${karimShare.toFixed(2)}€, Raphaël=${raphaelShare.toFixed(2)}€)`,
  });

  return { calculation, distributable, slackAlertSent };
}

// ---- Approbation et paiement ----

export async function approveDividends(calculationId: string): Promise<void> {
  const { error } = await supabase
    .from('dividend_calculations')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', calculationId);

  if (error) throw new Error(`Erreur approbation dividendes : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'TSUNADE',
    level:      'INFO',
    message:    `Dividendes id=${calculationId} approuvés`,
  });
}

export async function markDividendsPaid(calculationId: string, notes?: string): Promise<void> {
  const { error } = await supabase
    .from('dividend_calculations')
    .update({
      status:  'paid',
      paid_at: new Date().toISOString(),
      notes:   notes ?? null,
    })
    .eq('id', calculationId);

  if (error) throw new Error(`Erreur marquage paiement dividendes : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'TSUNADE',
    level:      'INFO',
    message:    `Dividendes id=${calculationId} marqués comme payés`,
  });
}
