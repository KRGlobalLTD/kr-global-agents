import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM   = 'KAKASHI · KR Global <agent@krglobalsolutionsltd.com>';

export interface CheckinResult {
  client_id:   string;
  client_name: string;
  sent:        boolean;
  type:        string;
}

function checkinHtml(name: string, product: string, score: number, npsLink: string): string {
  const greeting = name.includes(' ') ? name.split(' ')[0] : name;
  const health   = score >= 70 ? 'excellent' : score >= 45 ? 'satisfaisant' : 'à améliorer';
  return `
<p>Bonjour ${greeting},</p>
<p>Je fais un point mensuel sur votre progression avec KR Global Solutions.</p>
<p>📊 <strong>Statut de votre compte :</strong> ${health} (score interne ${score}/100)</p>
<p>Nous travaillons quotidiennement sur <strong>${product}</strong> grâce à nos agents IA autonomes.
Si vous avez des questions, remarques ou souhaitez ajuster notre approche, je suis disponible.</p>
<p>👉 <strong><a href="${npsLink}">Donnez-nous votre feedback (1 min)</a></strong></p>
<p>À très bientôt,<br/>L'équipe KR Global Solutions Ltd</p>
<hr/>
<p style="font-size:12px;color:#999;">
KR Global Solutions Ltd · 20-22 Wenlock Road, London, N1 7GU<br/>
Pour vous désabonner, répondez "STOP" à cet email.
</p>`;
}

function atRiskHtml(name: string, product: string): string {
  const greeting = name.includes(' ') ? name.split(' ')[0] : name;
  return `
<p>Bonjour ${greeting},</p>
<p>Je voulais vous contacter personnellement. Nos indicateurs montrent que nous pourrions mieux
servir vos besoins sur <strong>${product}</strong>.</p>
<p>Pouvez-vous prendre 10 minutes cette semaine pour qu'on discute ?
Votre satisfaction est notre priorité absolue.</p>
<p>Répondez simplement à cet email ou proposez un créneau.</p>
<p>Cordialement,<br/>Karim — KR Global Solutions Ltd</p>
<hr/>
<p style="font-size:12px;color:#999;">KR Global Solutions Ltd · 20-22 Wenlock Road, London, N1 7GU</p>`;
}

export async function sendCheckin(clientId: string): Promise<CheckinResult> {
  const [clientRes, healthRes] = await Promise.all([
    supabase.from('clients').select('name, email, product').eq('id', clientId).single(),
    supabase.from('client_health_scores').select('score, risk_level').eq('client_id', clientId).maybeSingle(),
  ]);

  if (clientRes.error || !clientRes.data) throw new Error(`Client ${clientId} introuvable`);
  const client = clientRes.data;
  const name    = client['name']    as string;
  const email   = client['email']   as string;
  const product = (client['product'] as string | null) ?? 'vos services KR Global';
  const score   = (healthRes.data?.['score'] as number | null) ?? 50;
  const risk    = (healthRes.data?.['risk_level'] as string | null) ?? 'medium';

  const isAtRisk  = risk === 'high' || risk === 'critical';
  const npsLink   = `${process.env.APP_URL}/nps?client=${clientId}`;

  const subject = isAtRisk
    ? `Un point important sur votre compte KR Global`
    : `Point mensuel — votre progression avec KR Global`;

  const html = isAtRisk
    ? atRiskHtml(name, product)
    : checkinHtml(name, product, score, npsLink);

  const { error } = await resend.emails.send({ from: FROM, to: email, subject, html });

  if (!error) {
    await supabase.from('client_health_scores')
      .update({ last_checkin_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('client_id', clientId);
    void supabase.from('alerts').insert({
      agent_name: 'KAKASHI',
      level:      'INFO',
      message:    `Check-in ${isAtRisk ? 'at-risk' : 'standard'} envoyé à ${name} (score=${score})`,
    });
  }

  return { client_id: clientId, client_name: name, sent: !error, type: isAtRisk ? 'at_risk' : 'standard' };
}

export async function sendDueCheckins(): Promise<{ sent: number; results: CheckinResult[] }> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('client_health_scores')
    .select('client_id')
    .lte('next_checkin_date', today);
  if (error) throw new Error(error.message);

  const results: CheckinResult[] = [];
  for (const row of data ?? []) {
    try {
      const r = await sendCheckin(row['client_id'] as string);
      results.push(r);
    } catch { /* skip failed */ }
  }
  return { sent: results.filter(r => r.sent).length, results };
}
