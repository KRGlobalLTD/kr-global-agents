import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface UsageRecord {
  tenant_id:   string;
  date:        string;
  api_calls:   number;
  agents_used: number;
  storage_mb:  number;
}

const PLAN_LIMITS: Record<string, { api_calls: number; agents: number }> = {
  starter:    { api_calls: 1000,   agents: 5 },
  growth:     { api_calls: 5000,   agents: 15 },
  enterprise: { api_calls: 999999, agents: 999 },
};

export async function recordUsage(
  tenantId:   string,
  apiCalls:   number,
  agentsUsed: number,
  storageMb:  number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('tenant_usage')
    .upsert(
      { tenant_id: tenantId, date: today, api_calls: apiCalls, agents_used: agentsUsed, storage_mb: storageMb },
      { onConflict: 'tenant_id,date' },
    );
  if (error) throw new Error(error.message);
}

export async function getTenantUsage(tenantId: string, days = 30): Promise<UsageRecord[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data } = await supabase
    .from('tenant_usage')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: false });
  return (data as UsageRecord[]) ?? [];
}

export async function checkUsageLimits(
  tenantId: string,
  plan:     string,
): Promise<{ within_limits: boolean; api_calls_today: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('tenant_usage')
    .select('api_calls')
    .eq('tenant_id', tenantId)
    .eq('date', today)
    .single();

  const apiCallsToday = (data as { api_calls: number } | null)?.api_calls ?? 0;
  const limit         = PLAN_LIMITS[plan]?.api_calls ?? 1000;

  return { within_limits: apiCallsToday < limit, api_calls_today: apiCallsToday, limit };
}

export async function getPlatformUsageSummary(): Promise<{
  total_tenants:         number;
  total_api_calls_today: number;
  avg_api_calls:         number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('tenant_usage')
    .select('api_calls')
    .eq('date', today);

  const records = (data as { api_calls: number }[]) ?? [];
  const total   = records.reduce((s, r) => s + r.api_calls, 0);

  return {
    total_tenants:         records.length,
    total_api_calls_today: total,
    avg_api_calls:         records.length > 0 ? Math.round(total / records.length) : 0,
  };
}
