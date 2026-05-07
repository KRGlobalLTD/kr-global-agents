import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type SupportedCurrency = 'GBP' | 'EUR' | 'USD' | 'MAD' | 'CAD' | 'AUD';

interface RateSnapshot {
  date:  string;
  base:  string;
  rates: Record<string, number>;
}

let _rateCache: RateSnapshot | null = null;

async function fetchFreshRates(base: SupportedCurrency = 'GBP'): Promise<Record<string, number>> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!res.ok) throw new Error(`Exchange rate API ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  return data.rates;
}

export async function getRates(base: SupportedCurrency = 'GBP'): Promise<Record<string, number>> {
  const today = new Date().toISOString().split('T')[0];

  // In-memory cache
  if (_rateCache && _rateCache.date === today && _rateCache.base === base) {
    return _rateCache.rates;
  }

  // Supabase cache
  const { data: cached } = await supabase
    .from('currency_rates')
    .select('rates')
    .eq('date', today)
    .eq('base', base)
    .maybeSingle();

  if (cached) {
    const rates = cached.rates as Record<string, number>;
    _rateCache = { date: today, base, rates };
    return rates;
  }

  // Fetch fresh
  let rates: Record<string, number>;
  try {
    rates = await fetchFreshRates(base);
  } catch {
    // Fallback hardcoded rates if API fails
    rates = { GBP: 1, USD: 1.27, EUR: 1.17, MAD: 12.7, CAD: 1.73, AUD: 1.94 };
  }

  _rateCache = { date: today, base, rates };

  void supabase.from('currency_rates').upsert({ date: today, base, rates }, { onConflict: 'date,base' });

  return rates;
}

export async function convert(
  amount: number,
  from: string,
  to: SupportedCurrency = 'GBP',
): Promise<number> {
  if (from === to) return amount;

  const rates = await getRates(to);
  const fromRate = rates[from.toUpperCase()];
  if (!fromRate) return amount; // unknown currency: return as-is

  // rates[from] = X units of `from` per 1 `to` → to convert from→to: amount / fromRate
  return Math.round((amount / fromRate) * 100) / 100;
}

export async function convertToGBP(amount: number, currency: string): Promise<number> {
  return convert(amount, currency, 'GBP');
}

export async function formatMultiCurrency(
  amount: number,
  currency: string,
): Promise<{ original: string; gbp: number; eur: number; usd: number }> {
  const [gbp, eur, usd] = await Promise.all([
    convertToGBP(amount, currency),
    convert(amount, currency, 'EUR'),
    convert(amount, currency, 'USD'),
  ]);

  return {
    original: `${amount.toFixed(2)} ${currency}`,
    gbp,
    eur,
    usd,
  };
}

export async function getMonthlySpendInGBP(): Promise<{ total: number; by_currency: Record<string, number> }> {
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from('finance_invoices')
    .select('amount, currency')
    .gte('invoice_date', firstOfMonth.split('T')[0]);

  if (error) throw new Error(`Erreur lecture dépenses : ${error.message}`);

  let total = 0;
  const by_currency: Record<string, number> = {};

  for (const row of data ?? []) {
    const gbp = await convertToGBP(row.amount as number, row.currency as string);
    total += gbp;
    by_currency[row.currency as string] = (by_currency[row.currency as string] ?? 0) + (row.amount as number);
  }

  return { total: Math.round(total * 100) / 100, by_currency };
}
