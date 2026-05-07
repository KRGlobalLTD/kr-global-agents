import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type PartnerStatus = 'prospect' | 'contacted' | 'meeting' | 'agreement' | 'active' | 'inactive';

export async function updatePartnerStatus(
  partnerId: string,
  status:    PartnerStatus,
  notes?:    string,
): Promise<void> {
  const update: Record<string, unknown> = { status, last_contact: new Date().toISOString() };
  if (notes) update['notes'] = notes;

  const { error } = await supabase.from('partners').update(update).eq('id', partnerId);
  if (error) throw new Error(error.message);

  if (status === 'active') {
    void fetch(process.env.SLACK_WEBHOOK_REVENUS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `🤝 KIBA — Nouveau partenaire ACTIF ! ID: ${partnerId}` }),
    });
  }

  void supabase.from('alerts').insert({
    agent_name: 'KIBA',
    level:      'INFO',
    message:    `Partner ${partnerId} → ${status}`,
  });
}

export async function recordReferral(partnerId: string, revenueGbp: number): Promise<void> {
  const { data, error } = await supabase
    .from('partners')
    .select('referred_clients, total_revenue, commission_rate')
    .eq('id', partnerId)
    .single();

  if (error) throw new Error(error.message);

  const newClients = ((data['referred_clients'] as number) ?? 0) + 1;
  const newRevenue = ((data['total_revenue'] as number) ?? 0) + revenueGbp;
  // Upgrade to premium rate if 3+ clients
  const newRate    = newClients >= 3 ? 20 : (data['commission_rate'] as number);

  await supabase.from('partners').update({
    referred_clients: newClients,
    total_revenue:    newRevenue,
    commission_rate:  newRate,
  }).eq('id', partnerId);

  void supabase.from('alerts').insert({
    agent_name: 'KIBA',
    level:      'INFO',
    message:    `Referral recorded for partner ${partnerId} — £${revenueGbp} (total: £${newRevenue})`,
  });
}

export interface PipelineStats {
  prospect:   number;
  contacted:  number;
  meeting:    number;
  agreement:  number;
  active:     number;
  inactive:   number;
  total_revenue_gbp:      number;
  total_commission_gbp:   number;
  avg_commission_rate:    number;
}

export async function getPipelineStats(): Promise<PipelineStats> {
  const { data, error } = await supabase.from('partners').select('status, total_revenue, commission_rate');
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = { prospect: 0, contacted: 0, meeting: 0, agreement: 0, active: 0, inactive: 0 };
  let totalRevenue = 0;
  let totalCommission = 0;
  let rateSum = 0;
  const rows = data ?? [];

  for (const r of rows) {
    const s = r['status'] as string;
    counts[s] = (counts[s] ?? 0) + 1;
    const rev  = (r['total_revenue']   as number) ?? 0;
    const rate = (r['commission_rate'] as number) ?? 15;
    totalRevenue    += rev;
    totalCommission += rev * rate / 100;
    rateSum         += rate;
  }

  return {
    prospect:              counts['prospect']  ?? 0,
    contacted:             counts['contacted'] ?? 0,
    meeting:               counts['meeting']   ?? 0,
    agreement:             counts['agreement'] ?? 0,
    active:                counts['active']    ?? 0,
    inactive:              counts['inactive']  ?? 0,
    total_revenue_gbp:     Math.round(totalRevenue * 100) / 100,
    total_commission_gbp:  Math.round(totalCommission * 100) / 100,
    avg_commission_rate:   rows.length > 0 ? Math.round((rateSum / rows.length) * 10) / 10 : 15,
  };
}
