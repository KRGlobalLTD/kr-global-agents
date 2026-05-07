import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }               from '@/lib/langchain/llm';

const pitchPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es KIBA, expert en développement partenariats pour KR Global Solutions Ltd (agence IA, Londres).
Tu rédiges des emails de partenariat percutants pour des dirigeants d'agences et studios digitaux.

Programme partenaires KR Global :
- Commission 15% (standard) ou 20% (premium 3+ clients) sur la valeur contractuelle
- KR Global gère tout : livraison, support, facturation
- Le partenaire ajoute simplement l'IA à son offre et génère des revenus récurrents
- Formation et matériaux co-marketing inclus

Ton email doit :
- Valoriser l'opportunité de revenus récurrents sans travail supplémentaire
- Mentionner le type d'entreprise du prospect (agence, studio, cabinet)
- Donner un exemple concret de revenu potentiel (ex: 3 clients × 1500£ × 15% = 675£/mois passifs)
- CTA simple : appel de 30 min pour découvrir le programme
- Maximum 130 mots, objet < 55 caractères

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nType: {companyType}\nSecteur: {industry}\nPays: {location}'],
]);

const followupPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es KIBA, expert partenariats KR Global.
Rédige un follow-up J+5 pour un dirigeant d'agence qui n'a pas répondu à ta proposition de partenariat.
Ajoute une urgence douce (ex: "nous ouvrons 3 places partenaires ce mois-ci dans votre région").
Max 90 mots. CTA direct.

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Prénom: {firstName}\nEntreprise: {company}\nPays: {location}'],
]);

const proposalPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu es KIBA, expert partenariats KR Global.
Génère un résumé de proposition de partenariat structuré (pas un email, un document de 3-4 paragraphes).
Inclure : opportunité marché IA, notre programme (commission, support, formation), revenus potentiels sur 12 mois, prochaines étapes.
Ton professionnel mais accessible.`],
  ['human', 'Partenaire: {company}\nType: {companyType}\nMarchés cibles: {markets}\nNombre clients estimé: {estimatedClients}'],
]);

const parser = new StringOutputParser();
const pitchChain    = pitchPrompt.pipe(getLLM(false)).pipe(parser);
const followupChain = followupPrompt.pipe(getLLM(false)).pipe(parser);
const proposalChain = proposalPrompt.pipe(getLLM(false)).pipe(parser);

export interface PartnerInput {
  name:         string;
  company:      string;
  company_type: string;
  industry:     string;
  location:     string;
}

export async function writePitch(
  partner: PartnerInput,
  type: 'initial' | 'followup' = 'initial',
): Promise<{ subject: string; html: string }> {
  const firstName = (partner.name ?? '').split(' ')[0] || 'Bonjour';

  let raw: string;
  if (type === 'initial') {
    raw = await pitchChain.invoke({
      firstName,
      company:     partner.company,
      companyType: partner.company_type,
      industry:    partner.industry,
      location:    partner.location,
    });
  } else {
    raw = await followupChain.invoke({
      firstName,
      company:  partner.company,
      location: partner.location,
    });
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON introuvable dans la réponse LLM');
  return JSON.parse(match[0]) as { subject: string; html: string };
}

export async function generateProposal(
  company:          string,
  companyType:      string,
  markets:          string,
  estimatedClients: number,
): Promise<string> {
  return proposalChain.invoke({
    company,
    companyType,
    markets,
    estimatedClients: String(estimatedClients),
  });
}
