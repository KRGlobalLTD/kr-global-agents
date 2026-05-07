import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Xero CSV ──────────────────────────────────────────────────────────────────

export async function exportXeroInvoices(monthStr?: string): Promise<string> {
  const month = monthStr ?? new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const end   = new Date(new Date(start).setMonth(new Date(start).getMonth() + 1)).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .gte('created_at', start)
    .lt('created_at', end);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const header = 'ContactName,EmailAddress,InvoiceNumber,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,Currency\n';
  const lines  = rows.map(r => [
    `"${(r['client_name'] as string) ?? ''}"`,
    `"${(r['client_email'] as string) ?? ''}"`,
    `"${(r['invoice_number'] as string) ?? r['id']}"`,
    String((r['created_at'] as string)?.slice(0, 10) ?? ''),
    String((r['due_date']   as string)?.slice(0, 10) ?? ''),
    `"AI Services — ${month}"`,
    '1',
    String((r['amount'] as number) ?? 0),
    '200',
    'OUTPUT2',
    'GBP',
  ].join(',')).join('\n');

  return header + lines;
}

// ── QuickBooks IIF ────────────────────────────────────────────────────────────

export async function exportQuickBooksIIF(monthStr?: string): Promise<string> {
  const month = monthStr ?? new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const end   = new Date(new Date(start).setMonth(new Date(start).getMonth() + 1)).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('transactions')
    .select('*')
    .gte('created_at', start)
    .lt('created_at', end);

  const rows = data ?? [];
  const header = '!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!ENDTRNS\n';
  const lines  = rows.map(r => {
    const date    = String((r['created_at'] as string)?.slice(0, 10) ?? '');
    const amount  = (r['amount'] as number) ?? 0;
    const type    = (r['type']   as string) === 'income' ? 'INVOICE' : 'BILL';
    const name    = `"${(r['description'] as string) ?? 'KR Global'}"`;
    return `TRNS\t${type}\t${date}\tAccounts Receivable\t${name}\t${amount}\tKR Global\nSPL\t${type}\t${date}\tSales\t${name}\t${-amount}\tAI Services\nENDTRNS`;
  }).join('\n');

  return header + lines;
}

// ── Odoo JSON ─────────────────────────────────────────────────────────────────

export async function exportOdooJSON(monthStr?: string): Promise<Record<string, unknown>[]> {
  const month = monthStr ?? new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const end   = new Date(new Date(start).setMonth(new Date(start).getMonth() + 1)).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('transactions')
    .select('*')
    .gte('created_at', start)
    .lt('created_at', end);

  return (data ?? []).map(r => ({
    name:          (r['description'] as string) ?? `TX-${r['id']}`,
    date:          (r['created_at']  as string)?.slice(0, 10),
    amount:        r['amount'],
    move_type:     (r['type'] as string) === 'income' ? 'out_invoice' : 'in_invoice',
    currency:      'GBP',
    partner_name:  (r['description'] as string) ?? '',
    journal_id:    'Sales',
    account_id:    'Revenue',
  }));
}
