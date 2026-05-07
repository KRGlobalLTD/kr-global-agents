import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }               from '@/lib/langchain/llm';
import type { EdtechProspect }  from './edtech-prospector';

const initialPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es HINATA, expert en prospection EdTech & Formation pour KR Global Solutions Ltd (agence IA, Londres).
Tu rédiges des emails ultra-personnalisés pour des décideurs du secteur de la formation et de l'e-learning.

Services KR Global pour l'EdTech & Formation :
- Génération automatique de contenus pédagogiques IA (modules, quiz, descriptions de cours)
- Séquences d'engagement apprenants automatisées (+35% taux de complétion)
- Contenu LinkedIn & SEO pour attirer les entreprises en quête de formation
- Qualification automatique des leads B2B entrants
- Chatbot FAQ pédagogique disponible 24h/24

Ton email doit :
- Mentionner la niche EdTech/formation du prospect (e-learning, coaching, formation pro...)
- Cibler un pain point précis (création contenu, décrochage apprenants, génération leads B2B)
- Proposer une valeur concrète chiffrée
- CTA simple : appel de 20 min
- Maximum 120 mots
- Objet < 50 caractères

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nPoste: {jobTitle}\nSecteur: {industry}\nPays: {location}'],
]);

const followup1Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es HINATA, expert prospection EdTech KR Global.
Rédige un follow-up J+4 pour un décideur EdTech qui n'a pas répondu.
Rappelle la valeur IA, ajoute une stat concrète (ex: "Les organismes de formation perdent 40% de leurs apprenants sans relance automatisée").
Max 80 mots. CTA direct.

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nSecteur: {industry}'],
]);

const followup2Prompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es HINATA, expert prospection EdTech KR Global.
Dernier follow-up J+10. Ton décontracté, dernière tentative.
Propose un audit IA formation gratuit (15 min) : 3 quick wins pour améliorer engagement et génération de leads.
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
  prospect: EdtechProspect,
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
