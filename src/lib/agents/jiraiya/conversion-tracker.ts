import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface OpportunitySummary {
  id:              string;
  client_id:       string;
  client_name:     string;
  current_package: string;
  target_package:  string;
  mrr_delta:       number;
  status:          string;
  sent_at:         string | null;
  converted_at:    string | null;
  created_at:      string;
}

export interface MrrImpact {
  total_potential_mrr:   number;
  total_converted_mrr:   number;
  conversion_rate_pct:   number;
  by_status:             Record<string, { count: number; mrr: number }>;
}

export async function markConverted(opportunityId: string): Promise<void> {
  await supabase
    .from('upsell_opportunities')
    .update({ status: 'converted', converted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', opportunityId);

  const { data } = await supabase
    .from('upsell_opportunities')
    .select('mrr_delta, client_id, clients(name)')
    .eq('id', opportunityId)
    .single();

  if (data) {
    const name = (data['clients'] as unknown as Record<string, unknown>)?.['name'] as string ?? 'client';
    void fetch(process.env.SLACK_WEBHOOK_REVENUS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `🎉 JIRAIYA — Upsell converti ! ${name} → +£${data['mrr_delta'] as number}/mois de MRR additionnel`,
      }),
    });
  }
}

export async function markInterested(opportunityId: string): Promise<void> {
  await supabase
    .from('upsell_opportunities')
    .update({ status: 'interested', updated_at: new Date().toISOString() })
    .eq('id', opportunityId);
}

export async function getOpportunities(status?: string): Promise<OpportunitySummary[]> {
  let q = supabase
    .from('upsell_opportunities')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    id:              r['id'] as string,
    client_id:       r['client_id'] as string,
    client_name:     (r['clients'] as unknown as Record<string, unknown>)?.['name'] as string ?? 'Inconnu',
    current_package: r['current_package'] as string,
    target_package:  r['target_package']  as string,
    mrr_delta:       r['mrr_delta']       as number,
    status:          r['status']          as string,
    sent_at:         r['sent_at']         as string | null,
    converted_at:    r['converted_at']    as string | null,
    created_at:      r['created_at']      as string,
  }));
}

export async function getMrrImpact(): Promise<MrrImpact> {
  const { data, error } = await supabase
    .from('upsell_opportunities')
    .select('status, mrr_delta');
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const byStatus: Record<string, { count: number; mrr: number }> = {};

  for (const r of rows) {
    const s = r['status'] as string;
    const d = r['mrr_delta'] as number;
    byStatus[s] ??= { count: 0, mrr: 0 };
    byStatus[s].count++;
    byStatus[s].mrr += d;
  }

  const potentialMrr  = rows.filter(r => r['status'] !== 'declined').reduce((a, r) => a + (r['mrr_delta'] as number), 0);
  const convertedMrr  = (byStatus['converted']?.mrr ?? 0);
  const totalPitched  = rows.filter(r => ['pitched','interested','converted','declined'].includes(r['status'] as string)).length;
  const convRate      = totalPitched > 0 ? Math.round(((byStatus['converted']?.count ?? 0) / totalPitched) * 100) : 0;

  return { total_potential_mrr: potentialMrr, total_converted_mrr: convertedMrr, conversion_rate_pct: convRate, by_status: byStatus };
}
