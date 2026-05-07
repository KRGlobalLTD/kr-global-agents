import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }               from '@/lib/langchain/llm';
import type { ImmoProspect }    from './immo-prospector';

const initialPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es TEMARI, expert en prospection immobilière pour KR Global Solutions Ltd (agence IA, Londres).
Tu rédiges des emails ultra-personnalisés pour des décideurs du secteur immobilier.

Services KR Global pour l'immobilier :
- Génération automatique de descriptions de biens IA (100+ biens SEO-optimisés en minutes)
- Séquences de nurturing automatisées post-demande de visite (+40% conversion)
- Contenu social IA pour présenter les biens (LinkedIn, Instagram)
- Analyse de marché et veille tarifaire concurrentielle en temps réel
- Qualification automatique des leads entrants

Ton email doit :
- Mentionner le segment immobilier du prospect (agence, promoteur, gestion locative...)
- Cibler un pain point précis (descriptions biens, suivi leads, contenu social)
- Proposer une valeur concrète chiffrée
- CTA simple : appel de 20 min
- Maximum 120 mots
- Objet < 50 caractères

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nPoste: {jobTitle}\nSecteur: {industry}\nPays: {location}'],
]);

const followup1Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es TEMARI, expert prospection immobilière KR Global.
Rédige un follow-up J+4 pour un décideur immobilier qui n'a pas répondu.
Rappelle la valeur IA, ajoute une stat concrète (ex: "Les agences perdent 60% de leurs leads faute de suivi rapide").
Max 80 mots. CTA direct.

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nSecteur: {industry}'],
]);

const followup2Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es TEMARI, expert prospection immobilière KR Global.
Dernier follow-up J+10. Ton décontracté, dernière tentative.
Propose un audit IA immobilier gratuit (15 min) : identifier les 3 quick wins pour leur agence.
Max 60 mots.

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}'],
]);

const parser = new StringOutputParser();
const initialChain   = initialPrompt.pipe(getLLM(false)).pipe(parser);
const followup1Chain = followup1Prompt.pipe(getLLM(false)).pipe(parser);
const followup2Chain = followup2Prompt.pipe(getLLM(false)).pipe(parser);

export async function writeOutreach(
  prospect: ImmoProspect,
  type: 'initial' | 'followup1' | 'followup2' = 'initial',
): Promise<{ subject: string; html: string }> {
  const firstName = (prospect.name ?? '').split(' ')[0] || 'Bonjour';

  let raw: string;
  if (type === 'initial') {
    raw = await initialChain.invoke({
      firstName,
      company:  prospect.company,
      jobTitle: prospect.job_title,
      industry: prospect.industry,
      location: prospect.location,
    });
  } else if (type === 'followup1') {
    raw = await followup1Chain.invoke({
      firstName,
      company:  prospect.company,
      industry: prospect.industry,
    });
  } else {
    raw = await followup2Chain.invoke({
      firstName,
      company: prospect.company,
    });
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON introuvable dans la réponse LLM');
  return JSON.parse(match[0]) as { subject: string; html: string };
}
