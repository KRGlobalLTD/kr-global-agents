import { createClient } from '@supabase/supabase-js';
import { getPlatformRevenue } from './billing-manager';
import { getPlatformUsageSummary } from './usage-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface PlatformDashboard {
  period:           string;
  revenue:          Awaited<ReturnType<typeof getPlatformRevenue>>;
  usage:            Awaited<ReturnType<typeof getPlatformUsageSummary>>;
  churn_risk_count: number;
  trial_expiring:   number;
  health_score:     number;
}

export async function buildPlatformDashboard(): Promise<PlatformDashboard> {
  const period = new Date().toISOString().slice(0, 7);

  const [revenue, usage] = await Promise.all([
    getPlatformRevenue(),
    getPlatformUsageSummary(),
  ]);

  const in3Days = new Date();
  in3Days.setDate(in3Days.getDate() + 3);
  const { count: trialExpiring } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'trial')
    .lte('trial_ends_at', in3Days.toISOString());

  const since7 = new Date();
  since7.setDate(since7.getDate() - 7);

  const [{ data: activeIds }, { data: usedIds }] = await Promise.all([
    supabase.from('tenants').select('id').eq('status', 'active'),
    supabase.from('tenant_usage')
      .select('tenant_id')
      .gte('date', since7.toISOString().slice(0, 10))
      .gt('api_calls', 0),
  ]);

  const usedSet   = new Set((usedIds ?? []).map((r: { tenant_id: string }) => r.tenant_id));
  const churnRisk = ((activeIds ?? []) as { id: string }[])
    .filter(r => !usedSet.has(r.id)).length;

  const healthScore = revenue.active_count === 0
    ? 50
    : Math.max(0, Math.min(100,
        Math.round(
          100
          - (churnRisk / Math.max(revenue.active_count, 1)) * 40
          - ((trialExpiring ?? 0) / Math.max(revenue.trial_count, 1)) * 20,
        ),
      ));

  return {
    period,
    revenue,
    usage,
    churn_risk_count: churnRisk,
    trial_expiring:   trialExpiring ?? 0,
    health_score:     healthScore,
  };
}

export async function getChurnRiskTenants(): Promise<
  { id: string; company_name: string; plan: string; mrr_gbp: number }[]
> {
  const since7 = new Date();
  since7.setDate(since7.getDate() - 7);

  const [{ data: active }, { data: used }] = await Promise.all([
    supabase.from('tenants').select('id, company_name, plan, mrr_gbp').eq('status', 'active'),
    supabase.from('tenant_usage')
      .select('tenant_id')
      .gte('date', since7.toISOString().slice(0, 10))
      .gt('api_calls', 0),
  ]);

  const usedSet = new Set((used ?? []).map((r: { tenant_id: string }) => r.tenant_id));
  return ((active ?? []) as { id: string; company_name: string; plan: string; mrr_gbp: number }[])
    .filter(t => !usedSet.has(t.id));
}
