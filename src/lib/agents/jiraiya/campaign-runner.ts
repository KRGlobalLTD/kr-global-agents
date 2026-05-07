import { createClient }         from '@supabase/supabase-js';
import { Resend }                from 'resend';
import { detectOpportunities }   from './opportunity-detector';
import { generatePitch }         from './pitch-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM   = 'JIRAIYA · KR Global <agent@krglobalsolutionsltd.com>';

export interface PitchResult {
  client_id:      string;
  client_name:    string;
  opportunity_id: string;
  sent:           boolean;
  subject:        string;
  mrr_delta:      number;
}

export async function sendPitch(
  opportunityId: string,
  clientEmail:   string,
  subject:       string,
  html:          string,
): Promise<boolean> {
  const { error } = await resend.emails.send({ from: FROM, to: clientEmail, subject, html });
  if (error) return false;

  await supabase
    .from('upsell_opportunities')
    .update({ status: 'pitched', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', opportunityId);

  return true;
}

export async function runCampaign(): Promise<{ pitched: number; potential_mrr: number; results: PitchResult[] }> {
  const candidates = await detectOpportunities();
  const results: PitchResult[] = [];

  for (const candidate of candidates) {
    try {
      const pitch = await generatePitch(candidate);
      const sent  = await sendPitch(pitch.opportunity_id, candidate.client_email, pitch.subject, pitch.html);

      results.push({
        client_id:      candidate.client_id,
        client_name:    candidate.client_name,
        opportunity_id: pitch.opportunity_id,
        sent,
        subject:        pitch.subject,
        mrr_delta:      candidate.mrr_delta,
      });
    } catch { /* skip failed */ }
  }

  const pitched      = results.filter(r => r.sent).length;
  const potentialMrr = results.filter(r => r.sent).reduce((acc, r) => acc + r.mrr_delta, 0);

  if (pitched > 0) {
    void fetch(process.env.SLACK_WEBHOOK_REVENUS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `💰 JIRAIYA — ${pitched} pitch(es) upsell envoyé(s)\nMRR potentiel additionnel : £${potentialMrr}/mois\n${results.filter(r => r.sent).map(r => `• ${r.client_name} → £+${r.mrr_delta}/mois`).join('\n')}`,
      }),
    });
  }

  return { pitched, potential_mrr: potentialMrr, results };
}
