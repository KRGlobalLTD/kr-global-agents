import { createClient } from '@supabase/supabase-js';
import { convertToGBP } from './currency-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Xero chart of accounts mapping
const CATEGORY_TO_XERO: Record<string, { code: string; name: string }> = {
  AI:             { code: '6100', name: 'AI & Machine Learning Costs'  },
  Infrastructure: { code: '6200', name: 'Cloud Infrastructure'          },
  Domains:        { code: '6300', name: 'Domain & DNS'                  },
  SaaS:           { code: '6400', name: 'Software & SaaS Subscriptions' },
  Banking:        { code: '6500', name: 'Banking & Transaction Fees'    },
  Marketing:      { code: '6600', name: 'Marketing & Advertising'       },
  Operations:     { code: '6700', name: 'General Operations'            },
  Taxes:          { code: '6800', name: 'Tax Payments'                  },
  Freelance:      { code: '7000', name: 'Freelancer Payments'           },
  Other:          { code: '6900', name: 'Miscellaneous Expenses'        },
  REVENU_STRIPE:  { code: '4000', name: 'Revenue — Stripe'             },
  REVENU_GUMROAD: { code: '4100', name: 'Revenue — Gumroad'            },
  REVENU_AUTRE:   { code: '4200', name: 'Revenue — Other'              },
};

export interface XeroExportRow {
  ContactName:   string;
  EmailAddress:  string;
  POAddressLine1: string;
  POCity:        string;
  POCountry:     string;
  InvoiceNumber: string;
  Reference:     string;
  InvoiceDate:   string;
  DueDate:       string;
  Total:         string;
  TaxTotal:      string;
  AccountCode:   string;
  AccountName:   string;
  Description:   string;
  Currency:      string;
  Status:        string;
}

function toCsvRow(row: XeroExportRow): string {
  return (Object.values(row) as string[])
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(',');
}

function csvHeaders(sample: XeroExportRow): string {
  return (Object.keys(sample) as (keyof XeroExportRow)[]).join(',');
}

export async function exportXeroCSV(month: number, year: number): Promise<string> {
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const to   = new Date(year, month, 0).toISOString().split('T')[0];

  const { data: invoices, error } = await supabase
    .from('finance_invoices')
    .select('*')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .order('invoice_date', { ascending: true });

  if (error) throw new Error(`Erreur export Xero : ${error.message}`);

  const rows: XeroExportRow[] = [];

  for (const inv of invoices ?? []) {
    const xeroAccount = CATEGORY_TO_XERO[inv.category as string] ?? CATEGORY_TO_XERO['Other'];
    const gbp = await convertToGBP(inv.amount as number, inv.currency as string);

    rows.push({
      ContactName:    (inv.provider_name as string) ?? '',
      EmailAddress:   '',
      POAddressLine1: '',
      POCity:         '',
      POCountry:      '',
      InvoiceNumber:  (inv.invoice_number as string) ?? '',
      Reference:      `ZORO-${(inv.id as string).slice(0, 8)}`,
      InvoiceDate:    (inv.invoice_date as string) ?? '',
      DueDate:        (inv.due_date as string) ?? (inv.invoice_date as string) ?? '',
      Total:          gbp.toFixed(2),
      TaxTotal:       ((inv.vat_amount as number | null) ?? 0).toFixed(2),
      AccountCode:    xeroAccount.code,
      AccountName:    xeroAccount.name,
      Description:    `${inv.category} — ${inv.provider_name}`,
      Currency:       'GBP',
      Status:         'AUTHORISED',
    });
  }

  if (rows.length === 0) {
    return `ContactName,InvoiceDate,Total\n(no data for ${month}/${year})`;
  }

  const header = csvHeaders(rows[0]);
  const body   = rows.map(r => toCsvRow(r)).join('\n');

  void supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Export Xero généré : ${rows.length} lignes pour ${month}/${year}`,
  });

  return `${header}\n${body}`;
}

export async function getXeroReadinessReport(): Promise<{
  ready:   boolean;
  issues:  string[];
  summary: string;
}> {
  const issues: string[] = [];

  const { data: noNumber } = await supabase
    .from('finance_invoices')
    .select('id', { count: 'exact', head: true })
    .is('invoice_number', null);

  const noNumberCount = (noNumber as unknown as { count: number } | null)?.count ?? 0;
  if (noNumberCount > 0) {
    issues.push(`${noNumberCount} factures sans numéro`);
  }

  const { data: noCategory } = await supabase
    .from('finance_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('category', 'Other');

  const noCategoryCount = (noCategory as unknown as { count: number } | null)?.count ?? 0;
  if (noCategoryCount > 5) {
    issues.push(`${noCategoryCount} factures en catégorie "Other" — à reclassifier`);
  }

  return {
    ready:   issues.length === 0,
    issues,
    summary: issues.length === 0
      ? 'Données prêtes pour synchronisation Xero'
      : `${issues.length} problème(s) à résoudre avant sync Xero`,
  };
}
