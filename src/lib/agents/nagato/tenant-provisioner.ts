import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface TenantInput {
  company_name:        string;
  owner_email:         string;
  plan:                'starter' | 'growth' | 'enterprise';
  stripe_customer_id?: string;
}

export interface Tenant {
  id:                  string;
  company_name:        string;
  owner_email:         string;
  plan:                string;
  status:              string;
  mrr_gbp:             number;
  stripe_customer_id?: string;
  trial_ends_at?:      string;
  created_at:          string;
}

const PLAN_MRR: Record<string, number> = {
  starter:    99,
  growth:     299,
  enterprise: 799,
};

const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'basic_agents',
    'email_support',
  ],
  growth: [
    'basic_agents',
    'email_support',
    'advanced_analytics',
    'priority_support',
    'custom_branding',
  ],
  enterprise: [
    'basic_agents',
    'email_support',
    'advanced_analytics',
    'priority_support',
    'custom_branding',
    'white_label',
    'dedicated_support',
    'api_access',
    'custom_integrations',
  ],
};

export async function provisionTenant(input: TenantInput): Promise<Tenant> {
  const mrr = PLAN_MRR[input.plan] ?? 99;
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const { data, error } = await supabase
    .from('tenants')
    .insert({
      company_name:       input.company_name,
      owner_email:        input.owner_email,
      plan:               input.plan,
      status:             'trial',
      mrr_gbp:            mrr,
      stripe_customer_id: input.stripe_customer_id ?? null,
      trial_ends_at:      trialEndsAt.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const tenant = data as Tenant;

  const featureRows = (PLAN_FEATURES[input.plan] ?? PLAN_FEATURES['starter'])
    .map(f => ({ tenant_id: tenant.id, feature: f, enabled: true }));
  await supabase.from('tenant_features').insert(featureRows);

  return tenant;
}

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const { data } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();
  return (data as Tenant) ?? null;
}

export async function upgradePlan(tenantId: string, newPlan: 'starter' | 'growth' | 'enterprise'): Promise<void> {
  const mrr = PLAN_MRR[newPlan] ?? 99;
  await supabase
    .from('tenants')
    .update({ plan: newPlan, mrr_gbp: mrr, updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  await supabase.from('tenant_features').delete().eq('tenant_id', tenantId);
  const featureRows = (PLAN_FEATURES[newPlan] ?? PLAN_FEATURES['starter'])
    .map(f => ({ tenant_id: tenantId, feature: f, enabled: true }));
  await supabase.from('tenant_features').insert(featureRows);
}

export async function listTenants(status?: string): Promise<Tenant[]> {
  let query = supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query;
  return (data as Tenant[]) ?? [];
}
