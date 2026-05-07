import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface NpsRecord {
  client_id: string;
  score:     number;  // 0-10
  comment?:  string;
}

export interface NpsSummary {
  total_responses: number;
  avg_score:       number;
  promoters:       number;  // 9-10
  passives:        number;  // 7-8
  detractors:      number;  // 0-6
  nps_index:       number;  // % promoters - % detractors
}

export async function recordNps(input: NpsRecord): Promise<void> {
  await supabase.from('client_health_scores').upsert(
    {
      client_id:   input.client_id,
      nps_score:   input.score,
      updated_at:  new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  );

  void supabase.from('alerts').insert({
    agent_name: 'KAKASHI',
    level:      input.score <= 6 ? 'WARNING' : 'INFO',
    message:    `NPS ${input.score}/10 reçu — client_id=${input.client_id}${input.comment ? ` — "${input.comment}"` : ''}`,
  });

  // Alert Karim on detractors
  if (input.score <= 6) {
    const { data } = await supabase.from('clients').select('name, email').eq('id', input.client_id).single();
    void fetch(process.env.SLACK_WEBHOOK_ALERTES!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `🚨 KAKASHI — Détracteur NPS ${input.score}/10 : ${(data?.['name'] as string) ?? input.client_id}\n${input.comment ? `"${input.comment}"` : ''}`,
      }),
    });
  }
}

export async function getNpsSummary(): Promise<NpsSummary> {
  const { data, error } = await supabase
    .from('client_health_scores')
    .select('nps_score')
    .not('nps_score', 'is', null);
  if (error) throw new Error(error.message);

  const scores = (data ?? []).map(r => r['nps_score'] as number);
  if (scores.length === 0) return { total_responses: 0, avg_score: 0, promoters: 0, passives: 0, detractors: 0, nps_index: 0 };

  const promoters  = scores.filter(s => s >= 9).length;
  const passives   = scores.filter(s => s >= 7 && s <= 8).length;
  const detractors = scores.filter(s => s <= 6).length;
  const avg        = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  const npsIndex   = Math.round(((promoters - detractors) / scores.length) * 100);

  return { total_responses: scores.length, avg_score: avg, promoters, passives, detractors, nps_index: npsIndex };
}
