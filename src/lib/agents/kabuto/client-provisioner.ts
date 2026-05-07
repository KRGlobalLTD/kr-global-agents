import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PLAN_MRR: Record<string, number> = { starter: 1275, growth: 2550, enterprise: 5100 };

export interface WhitelabelClient {
  id:           string;
  config_id:    string;
  client_name:  string;
  client_email: string;
  plan:         string;
  status:       string;
  mrr_gbp:      number;
  created_at:   string;
}

export async function provisionClient(input: {
  config_id:    string;
  client_name:  string;
  client_email: string;
  plan:         'starter' | 'growth' | 'enterprise';
}): Promise<WhitelabelClient> {
  const mrr = PLAN_MRR[input.plan] ?? 1275;

  const { data, error } = await supabase
    .from('whitelabel_clients')
    .insert({
      config_id:    input.config_id,
      client_name:  input.client_name,
      client_email: input.client_email,
      plan:         input.plan,
      status:       'active',
      mrr_gbp:      mrr,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  void supabase.from('alerts').insert({
    agent_name: 'KABUTO',
    level:      'INFO',
    message:    `Client provisionné : ${input.client_name} (${input.plan}) → config ${input.config_id}`,
  });

  void fetch(process.env.SLACK_WEBHOOK_REVENUS!, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: `🏷️ KABUTO — Nouveau client white label : ${input.client_name} (${input.plan} — £${mrr}/mois)` }),
  });

  return data as WhitelabelClient;
}

export async function getClientsByConfig(configId: string): Promise<WhitelabelClient[]> {
  const { data } = await supabase
    .from('whitelabel_clients')
    .select('*')
    .eq('config_id', configId)
    .order('created_at', { ascending: false });
  return (data ?? []) as WhitelabelClient[];
}

export async function updateClientStatus(
  clientId: string,
  status:   'active' | 'paused' | 'churned',
): Promise<void> {
  const { error } = await supabase
    .from('whitelabel_clients')
    .update({ status })
    .eq('id', clientId);
  if (error) throw new Error(error.message);
}

export async function getWhitelabelStats(): Promise<{
  total_configs:  number;
  active_configs: number;
  total_clients:  number;
  active_clients: number;
  total_mrr_gbp:  number;
}> {
  const [configs, clients] = await Promise.all([
    supabase.from('whitelabel_configs').select('status'),
    supabase.from('whitelabel_clients').select('status, mrr_gbp'),
  ]);

  const allConfigs  = configs.data ?? [];
  const allClients  = clients.data ?? [];
  const totalMrr    = allClients
    .filter(c => c['status'] === 'active')
    .reduce((sum, c) => sum + ((c['mrr_gbp'] as number) ?? 0), 0);

  return {
    total_configs:  allConfigs.length,
    active_configs: allConfigs.filter(c => c['status'] === 'active').length,
    total_clients:  allClients.length,
    active_clients: allClients.filter(c => c['status'] === 'active').length,
    total_mrr_gbp:  Math.round(totalMrr * 100) / 100,
  };
}
