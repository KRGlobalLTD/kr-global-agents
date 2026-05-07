import { createClient }      from '@supabase/supabase-js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { getLLM }             from '@/lib/langchain/llm';
import { type UpsellCandidate } from './opportunity-detector';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SYSTEM = `Tu es JIRAIYA, expert en upsell et croissance de KR Global Solutions Ltd (agence IA, Londres UK).
Tu écris des emails d'upsell personnalisés, convaincants et non-agressifs.

Packages KR Global :
- Starter £1500/mois — 2 posts/semaine, 50 leads/mois
- Growth £3000/mois — 5 posts/semaine, 200 leads/mois, veille concurrentielle, support dédié
- Enterprise £6000/mois — illimité, agents dédiés, intégrations CRM/ERP, account manager

Style : professionnel mais chaleureux, axé valeur concrète (ROI, temps économisé, leads additionnels).
Longueur : 150-200 mots. Pas de pression, juste les faits et la valeur.
Langue : français (sauf si le client est UK uniquement).

Retourne UNIQUEMENT du HTML email valide (pas de markdown, pas d'explication).`;

const pitchChain = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(false)).pipe(new StringOutputParser());

export interface GeneratedPitch {
  opportunity_id: string;
  subject:        string;
  html:           string;
}

export async function generatePitch(candidate: UpsellCandidate): Promise<GeneratedPitch> {
  const firstName = candidate.client_name.includes(' ')
    ? candidate.client_name.split(' ')[0]
    : candidate.client_name;

  const subject = candidate.target_package === 'enterprise'
    ? `${firstName}, vous êtes prêt pour le niveau Enterprise`
    : `${firstName}, découvrez ce que le plan Growth peut changer pour vous`;

  const html = await pitchChain.invoke({
    input: `Écris un email d'upsell pour :
Prénom : ${firstName}
Package actuel : ${candidate.current_package} (£${candidate.current_mrr}/mois)
Package proposé : ${candidate.target_package} (£${candidate.target_mrr}/mois)
Raison de l'éligibilité : ${candidate.reason}
Objet de l'email : "${subject}"

L'email doit commencer par "Bonjour ${firstName}," et se terminer par la signature "L'équipe KR Global Solutions Ltd".`,
  });

  // Persist the opportunity
  const { data, error } = await supabase
    .from('upsell_opportunities')
    .insert({
      client_id:       candidate.client_id,
      current_package: candidate.current_package,
      target_package:  candidate.target_package,
      current_mrr:     candidate.current_mrr,
      target_mrr:      candidate.target_mrr,
      mrr_delta:       candidate.mrr_delta,
      pitch_subject:   subject,
      pitch_body:      html,
      status:          'detected',
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { opportunity_id: data['id'] as string, subject, html };
}
