import { createClient } from '@supabase/supabase-js';
import { googleGet, googlePatch } from './google-auth';
import { getAICostsByAgent }      from './ai-cost-tracker';
import { getActiveSubscriptions, getMonthlySubscriptionTotal } from './subscription-tracker';
import { getTopProvidersBySpend } from './provider-registry';
import { generateMonthlyReport } from './report-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

interface SheetValueRange {
  range:  string;
  values: (string | number)[][];
}

async function writeRange(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<void> {
  await googlePatch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: 'ROWS', values },
  );
}

async function ensureSheets(spreadsheetId: string): Promise<void> {
  const info = await googleGet<{ sheets: Array<{ properties: { title: string; sheetId: number } }> }>(
    `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`
  );

  const existing = new Set(info.sheets.map(s => s.properties.title));
  const needed   = ['Monthly P&L', 'Providers', 'Subscriptions', 'AI Costs'];

  const toAdd = needed.filter(n => !existing.has(n));
  if (toAdd.length === 0) return;

  await googlePost(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: toAdd.map(title => ({
      addSheet: { properties: { title } },
    })),
  });
}

async function googlePost<T>(url: string, body: unknown): Promise<T> {
  const token = await (await import('./google-auth')).getGoogleAccessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets POST ${res.status}`);
  return res.json() as Promise<T>;
}

export async function updateSheetsMonthlyPnL(month: number, year: number): Promise<void> {
  const id = process.env.GOOGLE_SHEETS_DASHBOARD_ID;
  if (!id) return;

  await ensureSheets(id);

  const report = await generateMonthlyReport(month, year);
  const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];

  const rows: (string | number)[][] = [
    ['Mois', 'Année', 'Revenus (€)', 'Dépenses (€)', 'Marge (€)', 'Marge %',
     'Coûts IA (€)', 'Coûts SaaS (€)', 'Coûts Freelances (€)', 'Publié le'],
    [
      MONTHS[month - 1], year,
      report.revenue.total.toFixed(2),
      report.expenses.total.toFixed(2),
      report.netMargin.toFixed(2),
      report.marginPercent.toFixed(1) + '%',
      report.expenses.ai.toFixed(2),
      report.expenses.saas.toFixed(2),
      report.expenses.freelancers.toFixed(2),
      new Date().toLocaleDateString('fr-FR'),
    ],
  ];

  // Find next available row
  const rowNum = month + 1; // row 1 = header, rows 2-13 = months
  await writeRange(id, `Monthly P&L!A${rowNum}:J${rowNum}`, [rows[1]]);
  await writeRange(id, `Monthly P&L!A1:J1`, [rows[0]]);
}

export async function updateSheetsProviders(): Promise<void> {
  const id = process.env.GOOGLE_SHEETS_DASHBOARD_ID;
  if (!id) return;

  await ensureSheets(id);

  const providers = await getTopProvidersBySpend(30);
  const header    = ['Fournisseur', 'Catégorie', 'Total dépensé', 'Devise', 'Mis à jour'];
  const rows      = providers.map(p => [
    p.name,
    p.category,
    p.total.toFixed(2),
    p.currency,
    new Date().toLocaleDateString('fr-FR'),
  ]);

  await writeRange(id, `Providers!A1:E${rows.length + 1}`, [header, ...rows]);
}

export async function updateSheetsSubscriptions(): Promise<void> {
  const id = process.env.GOOGLE_SHEETS_DASHBOARD_ID;
  if (!id) return;

  await ensureSheets(id);

  const subs  = await getActiveSubscriptions();
  const total = await getMonthlySubscriptionTotal();
  const header = ['Fournisseur', 'Plan', 'Montant', 'Devise', 'Fréquence', 'Catégorie', 'Prochain renouvellement', 'Statut'];

  const rows = subs.map(s => [
    s.provider_name,
    s.plan_name ?? '',
    s.amount.toFixed(2),
    s.currency,
    s.billing_frequency,
    s.category,
    s.next_renewal_date ?? '',
    s.status,
  ]);

  await writeRange(id, `Subscriptions!A1:H${rows.length + 1}`, [header, ...rows]);
  await writeRange(id, `Subscriptions!A${rows.length + 3}:B${rows.length + 3}`, [
    [`Total mensuel estimé (£)`, total.total_gbp.toFixed(2)],
  ]);
}

export async function updateSheetsAICosts(): Promise<void> {
  const id = process.env.GOOGLE_SHEETS_DASHBOARD_ID;
  if (!id) return;

  await ensureSheets(id);

  const costs  = await getAICostsByAgent();
  const header = ['Agent', 'Coût USD', 'Coût GBP', 'Nb requêtes', 'Coût moyen/req (USD)'];

  const rows = costs.map(c => [
    c.agent_name,
    c.total_usd.toFixed(6),
    c.total_gbp.toFixed(6),
    c.request_count,
    c.avg_per_request_usd.toFixed(6),
  ]);

  await writeRange(id, `AI Costs!A1:E${rows.length + 1}`, [header, ...rows]);
}

export async function runFullDashboardUpdate(): Promise<void> {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  await Promise.allSettled([
    updateSheetsMonthlyPnL(month, year),
    updateSheetsProviders(),
    updateSheetsSubscriptions(),
    updateSheetsAICosts(),
  ]);

  void supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Google Sheets dashboard mis à jour — ${month}/${year}`,
  });
}
