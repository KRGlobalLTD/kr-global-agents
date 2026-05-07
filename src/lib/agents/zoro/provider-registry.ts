import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ProviderRecord {
  id:                      string;
  name:                    string;
  normalized_name:         string;
  category:                string;
  is_recurring:            boolean;
  billing_frequency:       string | null;
  average_monthly_cost:    number;
  currencies:              string[];
  total_historical_spend:  number;
  drive_folder_id:         string | null;
  created_at:              string;
  updated_at:              string;
}

interface UpsertProviderInput {
  name:     string;
  category: string;
  currency: string;
  isRecurring?: boolean;
  billingFrequency?: string;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

export async function upsertProvider(input: UpsertProviderInput): Promise<ProviderRecord | null> {
  const normalized = normalizeName(input.name);

  const { data: existing } = await supabase
    .from('providers')
    .select('*')
    .eq('normalized_name', normalized)
    .maybeSingle();

  if (existing) {
    const currencies = [...new Set([...(existing.currencies as string[]), input.currency])];
    const { data: updated } = await supabase
      .from('providers')
      .update({
        currencies,
        is_recurring: input.isRecurring ?? existing.is_recurring,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    return updated as ProviderRecord | null;
  }

  const { data: created } = await supabase
    .from('providers')
    .insert({
      name:              input.name,
      normalized_name:   normalized,
      category:          input.category,
      is_recurring:      input.isRecurring ?? false,
      billing_frequency: input.billingFrequency ?? null,
      currencies:        [input.currency],
    })
    .select()
    .single();

  if (created) {
    void supabase.from('alerts').insert({
      agent_name: 'ZORO',
      level: 'INFO',
      message: `Nouveau fournisseur détecté : ${input.name} (${input.category})`,
    });
  }

  return created as ProviderRecord | null;
}

export async function updateProviderSpend(providerName: string, amount: number): Promise<void> {
  const normalized = normalizeName(providerName);
  const { data }   = await supabase
    .from('providers')
    .select('id, total_historical_spend, average_monthly_cost')
    .eq('normalized_name', normalized)
    .maybeSingle();

  if (!data) return;

  const totalSpend = (data.total_historical_spend as number) + amount;
  await supabase
    .from('providers')
    .update({
      total_historical_spend: totalSpend,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id);
}

export async function getProviders(category?: string): Promise<ProviderRecord[]> {
  let q = supabase.from('providers').select('*').order('total_historical_spend', { ascending: false });
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw new Error(`Erreur lecture providers : ${error.message}`);
  return (data ?? []) as ProviderRecord[];
}

export async function setProviderDriveFolder(providerId: string, folderId: string): Promise<void> {
  await supabase.from('providers').update({ drive_folder_id: folderId, updated_at: new Date().toISOString() }).eq('id', providerId);
}

export async function getTopProvidersBySpend(limit = 10): Promise<{ name: string; category: string; total: number; currency: string }[]> {
  const { data, error } = await supabase
    .from('finance_invoices')
    .select('provider_name, category, amount, currency')
    .eq('status', 'pending')
    .order('amount', { ascending: false })
    .limit(limit * 3);

  if (error) throw new Error(`Erreur lecture invoices : ${error.message}`);

  const agg: Record<string, { name: string; category: string; total: number; currency: string }> = {};
  for (const row of data ?? []) {
    const key = row.provider_name as string;
    if (!agg[key]) agg[key] = { name: key, category: row.category as string, total: 0, currency: row.currency as string };
    agg[key].total += row.amount as number;
  }

  return Object.values(agg)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
