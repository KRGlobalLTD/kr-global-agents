import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ExecutiveKPIs {
  period:             string;
  // Revenue
  mrr_gbp:            number;
  revenue_mtd_gbp:    number;
  revenue_ytd_gbp:    number;
  target_5k_gap_gbp:  number;
  // Clients
  active_clients:     number;
  new_clients_mtd:    number;
  churned_clients_mtd: number;
  // Pipeline
  prospects_total:    number;
  prospects_hot:      number;
  pipeline_value_gbp: number;
  // Content & Social
  content_published_mtd: number;
  content_pending:    number;
  // Partners & White Label
  active_partners:    number;
  wl_mrr_gbp:         number;
  // Campaigns
  active_campaigns:   number;
  emails_sent_mtd:    number;
  reply_rate_pct:     number;
  // Infrastructure
  agents_healthy:     number;
  agents_total:       number;
  alerts_24h:         number;
}

export async function buildExecutiveDashboard(period?: string): Promise<ExecutiveKPIs> {
  const now       = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearStart  = new Date(now.getFullYear(), 0, 1).toISOString();
  const p          = period ?? now.toISOString().slice(0, 7);

  const [
    revMtd, revYtd,
    activeClients, newClients,
    prospectsAll,
    contentPub, contentPending,
    activePartners,
    wlClients,
    campaigns,
    agentStatuses,
    alerts24h,
  ] = await Promise.all([
    supabase.from('transactions').select('amount').gte('created_at', monthStart).eq('type', 'income'),
    supabase.from('transactions').select('amount').gte('created_at', yearStart).eq('type', 'income'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('clients').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('prospects').select('status'),
    supabase.from('content').select('id', { count: 'exact', head: true }).gte('created_at', monthStart).eq('status', 'published'),
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('partners').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('whitelabel_clients').select('mrr_gbp').eq('status', 'active'),
    supabase.from('campaigns').select('emails_sent, replies_received').eq('status', 'active'),
    supabase.from('agents_status').select('status'),
    supabase.from('alerts').select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
      .eq('level', 'WARNING'),
  ]);

  const mrrGbp = (wlClients.data ?? []).reduce((s, c) => s + ((c['mrr_gbp'] as number) ?? 0), 0);
  const revMtdGbp = (revMtd.data ?? []).reduce((s, c) => s + ((c['amount'] as number) ?? 0), 0);
  const revYtdGbp = (revYtd.data ?? []).reduce((s, c) => s + ((c['amount'] as number) ?? 0), 0);

  const prospectsData = prospectsAll.data ?? [];
  const hotCount      = prospectsData.filter(p => p['status'] === 'CHAUD').length;
  const pipelineValue = hotCount * 2000; // avg deal estimate

  const totalEmails   = (campaigns.data ?? []).reduce((s, c) => s + ((c['emails_sent']      as number) ?? 0), 0);
  const totalReplies  = (campaigns.data ?? []).reduce((s, c) => s + ((c['replies_received'] as number) ?? 0), 0);
  const replyRate     = totalEmails > 0 ? Math.round((totalReplies / totalEmails) * 1000) / 10 : 0;

  const agentData      = agentStatuses.data ?? [];
  const healthyAgents  = agentData.filter(a => a['status'] === 'active').length;

  return {
    period:              p,
    mrr_gbp:             Math.round(mrrGbp * 100) / 100,
    revenue_mtd_gbp:     Math.round(revMtdGbp * 100) / 100,
    revenue_ytd_gbp:     Math.round(revYtdGbp * 100) / 100,
    target_5k_gap_gbp:   Math.max(0, Math.round((5000 - mrrGbp) * 100) / 100),
    active_clients:      activeClients.count ?? 0,
    new_clients_mtd:     newClients.count ?? 0,
    churned_clients_mtd: 0,
    prospects_total:     prospectsData.length,
    prospects_hot:       hotCount,
    pipeline_value_gbp:  pipelineValue,
    content_published_mtd: contentPub.count ?? 0,
    content_pending:     contentPending.count ?? 0,
    active_partners:     activePartners.count ?? 0,
    wl_mrr_gbp:          mrrGbp,
    active_campaigns:    campaigns.data?.length ?? 0,
    emails_sent_mtd:     totalEmails,
    reply_rate_pct:      replyRate,
    agents_healthy:      healthyAgents,
    agents_total:        agentData.length,
    alerts_24h:          alerts24h.count ?? 0,
  };
}
