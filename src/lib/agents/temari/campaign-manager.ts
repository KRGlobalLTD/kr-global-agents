import { createClient }       from '@supabase/supabase-js';
import { findImmoProspects,
         getImmoProspects }   from './immo-prospector';
import { writeOutreach }       from './outreach-writer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface CampaignStats {
  campaign_id: string;
  name:        string;
  prospects:   number;
  contacted:   number;
  replies:     number;
  conversions: number;
  created_at:  string;
}

export async function getOrCreateImmoCampaign(): Promise<string> {
  const name = `TEMARI — Immobilier — ${new Date().toISOString().slice(0, 7)}`;

  const { data: existing } = await supabase
    .from('campaigns')
    .select('id')
    .eq('name', name)
    .maybeSingle();

  if (existing) return existing['id'] as string;

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, status: 'active', target_count: 200, agent_name: 'TEMARI' })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data['id'] as string;
}

export async function runImmoCampaignCycle(): Promise<{
  campaign_id:  string;
  found:        number;
  skipped:      number;
  sample_email: { subject: string; html: string } | null;
}> {
  const campaignId = await getOrCreateImmoCampaign();

  const { saved, skipped, prospects } = await findImmoProspects(campaignId);

  let sampleEmail = null;
  if (prospects.length > 0) {
    try { sampleEmail = await writeOutreach(prospects[0], 'initial'); }
    catch { /* non-blocking */ }
  }

  void supabase.from('alerts').insert({
    agent_name: 'TEMARI',
    level:      'INFO',
    message:    `Cycle Immobilier : +${saved} prospects trouvés, ${skipped} ignorés (campaign ${campaignId})`,
  });

  if (saved > 0) {
    void fetch(process.env.SLACK_WEBHOOK_PROSPECTS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `🏠 TEMARI — ${saved} nouveaux prospects immobilier\nCampagne : ${campaignId}` }),
    });
  }

  return { campaign_id: campaignId, found: saved, skipped, sample_email: sampleEmail };
}

export async function getImmoCampaignStats(): Promise<CampaignStats[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, created_at')
    .eq('agent_name', 'TEMARI')
    .order('created_at', { ascending: false })
    .limit(6);
  if (error) throw new Error(error.message);

  const stats: CampaignStats[] = [];
  for (const c of data ?? []) {
    const { count: prospects } = await supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('campaign_id', c['id']);
    const { count: contacted } = await supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('campaign_id', c['id']).eq('status', 'CONTACTE');
    const { count: replies }   = await supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('campaign_id', c['id']).eq('status', 'REPONDU');

    stats.push({
      campaign_id: c['id']         as string,
      name:        c['name']       as string,
      prospects:   prospects ?? 0,
      contacted:   contacted ?? 0,
      replies:     replies   ?? 0,
      conversions: 0,
      created_at:  c['created_at'] as string,
    });
  }
  return stats;
}
