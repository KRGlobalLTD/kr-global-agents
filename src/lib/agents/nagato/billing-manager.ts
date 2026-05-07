import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface PlatformRevenue {
  total_mrr_gbp:  number;
  trial_count:    number;
  active_count:   number;
  churned_count:  number;
  mrr_by_plan:    Record<string, number>;
  arr_gbp:        number;
  target_gap_gbp: number;
}

export async function getPlatformRevenue(): Promise<PlatformRevenue> {
  const { data } = await supabase
    .from('tenants')
    .select('plan, status, mrr_gbp');

  const tenants = (data as { plan: string; status: string; mrr_gbp: number }[]) ?? [];
  const active  = tenants.filter(t => t.status === 'active');
  const trials  = tenants.filter(t => t.status === 'trial');
  const churned = tenants.filter(t => t.status === 'churned');

  const totalMrr  = active.reduce((s, t) => s + t.mrr_gbp, 0);
  const mrrByPlan: Record<string, number> = {};
  for (const t of active) {
    mrrByPlan[t.plan] = (mrrByPlan[t.plan] ?? 0) + t.mrr_gbp;
  }

  return {
    total_mrr_gbp:  Math.round(totalMrr * 100) / 100,
    trial_count:    trials.length,
    active_count:   active.length,
    churned_count:  churned.length,
    mrr_by_plan:    mrrByPlan,
    arr_gbp:        Math.round(totalMrr * 12 * 100) / 100,
    target_gap_gbp: Math.max(0, 5000 - totalMrr),
  };
}

export async function activateTenant(tenantId: string): Promise<void> {
  await supabase
    .from('tenants')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  const { data } = await supabase
    .from('tenants')
    .select('company_name, plan, mrr_gbp')
    .eq('id', tenantId)
    .single();

  if (data) {
    const t = data as { company_name: string; plan: string; mrr_gbp: number };
    void fetch(process.env.SLACK_WEBHOOK_REVENUS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `NAGATO -- Nouveau tenant actif : ${t.company_name} (${t.plan}) -- +GBP${t.mrr_gbp}/mois`,
      }),
    });
  }
}

export async function churnTenant(tenantId: string, reason: string): Promise<void> {
  await supabase
    .from('tenants')
    .update({ status: 'churned', updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  await supabase.from('alerts').insert({
    agent_name: 'NAGATO',
    level:      'WARNING',
    message:    `Tenant churne : ${tenantId} -- ${reason}`,
  });
}
