import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface WhitelabelConfig {
  id:            string;
  partner_id:    string;
  brand_name:    string;
  primary_color: string;
  logo_url:      string | null;
  domain:        string | null;
  email_from:    string | null;
  status:        'setup' | 'active' | 'suspended';
  created_at:    string;
}

export async function setupBrand(input: {
  partner_id:    string;
  brand_name:    string;
  primary_color?: string;
  logo_url?:     string;
  domain?:       string;
  email_from?:   string;
}): Promise<WhitelabelConfig> {
  const { data, error } = await supabase
    .from('whitelabel_configs')
    .insert({
      partner_id:    input.partner_id,
      brand_name:    input.brand_name,
      primary_color: input.primary_color ?? '#0066CC',
      logo_url:      input.logo_url      ?? null,
      domain:        input.domain        ?? null,
      email_from:    input.email_from    ?? null,
      status:        'setup',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  void supabase.from('alerts').insert({
    agent_name: 'KABUTO',
    level:      'INFO',
    message:    `White label configuré : ${input.brand_name} (partner ${input.partner_id})`,
  });

  return data as WhitelabelConfig;
}

export async function activateConfig(configId: string): Promise<void> {
  const { error } = await supabase
    .from('whitelabel_configs')
    .update({ status: 'active' })
    .eq('id', configId);
  if (error) throw new Error(error.message);
}

export async function getConfig(configId: string): Promise<WhitelabelConfig | null> {
  const { data } = await supabase
    .from('whitelabel_configs')
    .select('*')
    .eq('id', configId)
    .maybeSingle();
  return data as WhitelabelConfig | null;
}

export async function getConfigByPartner(partnerId: string): Promise<WhitelabelConfig[]> {
  const { data } = await supabase
    .from('whitelabel_configs')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });
  return (data ?? []) as WhitelabelConfig[];
}

export async function listConfigs(status?: string): Promise<WhitelabelConfig[]> {
  let query = supabase.from('whitelabel_configs').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query;
  return (data ?? []) as WhitelabelConfig[];
}
