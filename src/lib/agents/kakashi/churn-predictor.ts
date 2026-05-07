import { createClient }               from '@supabase/supabase-js';
import { ChatPromptTemplate }         from '@langchain/core/prompts';
import { StringOutputParser }         from '@langchain/core/output_parsers';
import { getLLM }                     from '@/lib/langchain/llm';
import { type ClientHealth }          from './health-scorer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SYSTEM = `Tu es KAKASHI, expert client success de KR Global Solutions Ltd (agence IA, Londres UK).
Tu analyses les données clients et proposes des plans d'action concrets pour retenir les clients à risque et maximiser leur satisfaction.
Réponds en français, de façon concise et actionnable.`;

const adviceChain = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(false)).pipe(new StringOutputParser());

export interface ChurnRisk {
  client_id:      string;
  client_name:    string;
  risk_level:     string;
  score:          number;
  risk_factors:   string[];
  recommended_actions: string[];
  upsell_ready:   boolean;
}

export async function detectChurnRisks(): Promise<ChurnRisk[]> {
  const { data, error } = await supabase
    .from('client_health_scores')
    .select('*, clients(name, email, product, onboarded_at, amount_paid)')
    .in('risk_level', ['medium', 'high', 'critical'])
    .order('score', { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => {
    const factors: string[]  = [];
    const actions: string[]  = [];
    const f = r['factors'] as Record<string, number>;

    if ((f['payment'] ?? 30) < 15) { factors.push('Factures en retard'); actions.push('Appeler Karim pour relance personnalisée'); }
    if ((f['support'] ?? 25) < 10) { factors.push('Tickets support élevés'); actions.push('Escalader tickets ouverts — résolution prioritaire'); }
    if ((f['activity'] ?? 10) < 5) { factors.push('Client inactif'); actions.push('Envoyer check-in personnalisé'); }
    if ((f['tenure'] ?? 20) < 8)   { factors.push('Nouveau client (< 3 mois)'); actions.push('Renforcer l\'onboarding — vérifier satisfaction'); }
    if ((f['nps'] ?? 8) < 6)       { factors.push('NPS faible'); actions.push('Appel Karim urgent — recueillir feedback détaillé'); }

    return {
      client_id:           r['client_id'] as string,
      client_name:         (r['clients'] as Record<string, unknown>)?.['name'] as string ?? 'Inconnu',
      risk_level:          r['risk_level'] as string,
      score:               r['score'] as number,
      risk_factors:        factors.length > 0 ? factors : ['Signaux faibles multiples'],
      recommended_actions: actions.length > 0 ? actions : ['Planifier call de suivi'],
      upsell_ready:        (r['score'] as number) >= 60 && (f['nps'] ?? 8) >= 8,
    };
  });
}

export async function detectUpsellOpportunities(): Promise<{ client_id: string; client_name: string; current_product: string; suggested_upgrade: string; reason: string }[]> {
  const { data, error } = await supabase
    .from('client_health_scores')
    .select('client_id, score, nps_score, clients(name, product, amount_paid)')
    .gte('score', 65)
    .order('score', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter(r => {
      const nps = r['nps_score'] as number | null;
      return nps === null || nps >= 7;
    })
    .map(r => {
      const client  = r['clients'] as unknown as Record<string, unknown>;
      const product = (client?.['product'] as string | null) ?? 'Starter';
      const amount  = (client?.['amount_paid'] as number | null) ?? 0;
      return {
        client_id:         r['client_id'] as string,
        client_name:       (client?.['name'] as string) ?? 'Inconnu',
        current_product:   product,
        suggested_upgrade: amount < 2000 ? 'Growth (£3000/mois)' : 'Enterprise (£6000/mois)',
        reason:            `Score santé ${r['score'] as number}/100 — client satisfait, potentiel d'expansion`,
      };
    });
}

export async function generateClientReport(clientId: string): Promise<string> {
  const [clientRes, healthRes, invoicesRes, ticketsRes] = await Promise.all([
    supabase.from('clients').select('name, product, onboarded_at, amount_paid').eq('id', clientId).single(),
    supabase.from('client_health_scores').select('*').eq('client_id', clientId).maybeSingle(),
    supabase.from('invoices').select('status, amount, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(3),
    supabase.from('tickets').select('status, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(5),
  ]);

  const client  = clientRes.data;
  const health  = healthRes.data;

  const report = await adviceChain.invoke({
    input: `Génère un rapport de succès client pour :
Nom : ${client?.['name']}
Produit : ${client?.['product']}
Client depuis : ${client?.['onboarded_at']}
Score santé : ${health?.['score'] ?? 'N/A'}/100 (${health?.['risk_level'] ?? 'N/A'})
NPS : ${health?.['nps_score'] ?? 'Non collecté'}/10
Factures récentes : ${JSON.stringify(invoicesRes.data ?? [])}
Tickets récents : ${JSON.stringify(ticketsRes.data ?? [])}

Inclure : résumé situation, points positifs, points d'amélioration, actions recommandées (30 jours).`,
  });

  return report;
}
