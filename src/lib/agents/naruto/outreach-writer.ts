import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }               from '@/lib/langchain/llm';
import type { EcomProspect }    from './ecom-prospector';

const initialPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es NARUTO, expert en prospection e-commerce pour KR Global Solutions Ltd (agence IA, Londres).
Tu rédiges des emails de prospection ultra-personnalisés pour des décideurs e-commerce.

Services KR Global pour l'e-commerce :
- Génération de fiches produits IA à grande échelle (100s de SKUs en minutes)
- Automatisation emails abandon panier + séquences post-achat
- Personnalisation client & optimisation LTV (+35%)
- Création de contenu social pour lancements produits
- Analyse prédictive des ventes

Ton email doit :
- Mentionner la verticale retail/e-commerce du prospect
- Cibler un pain point précis (contenu produit, rétention, panier abandonné)
- Proposer une valeur concrète chiffrée
- CTA simple : call de 20 min
- Maximum 120 mots
- Objet < 50 caractères

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nPoste: {jobTitle}\nSecteur: {industry}\nPays: {location}'],
]);

const followup1Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es NARUTO, expert prospection e-commerce KR Global.
Rédige un follow-up J+4 court et percutant pour un décideur e-commerce qui n'a pas répondu.
Rappelle la valeur IA, ajoute une stat concrète (ex: "En moyenne 80% des paniers abandonnés ne sont jamais récupérés").
Max 80 mots. CTA direct.

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nSecteur: {industry}'],
]);

const followup2Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es NARUTO, expert prospection e-commerce KR Global.
Dernier follow-up J+10. Ton décontracté, dernière tentative.
Propose un audit IA e-commerce gratuit (15 min) pour identifier les quick wins.
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
  prospect: EcomProspect,
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
