import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }              from '@/lib/langchain/llm';
import { type SaasProspect }   from './saas-prospector';

export type OutreachType = 'initial' | 'followup1' | 'followup2';

export interface SaasEmail { subject: string; html: string }

const SYSTEM = `Tu es SASUKE, expert en prospection SaaS B2B pour KR Global Solutions Ltd (agence IA, Londres UK).
Tu écris des cold emails ultra-personnalisés pour des fondateurs et dirigeants de startups SaaS.

Problèmes SaaS que KR Global résout (avec preuves concrètes) :
- CAC élevé → prospecting IA automatisé : 200+ leads qualifiés/mois, équipe commerciale réduite de moitié
- Churn silencieux → agents customer success : détection précoce, check-ins auto, taux rétention +25%
- Onboarding lent → séquences IA J+0→J+30 : activation utilisateurs +40%
- Contenu insuffisant → machine IA : 5 posts LinkedIn/semaine + articles SEO sans effort humain
- Reporting manuel → dashboards temps réel : 0 heure de reporting, KPIs automatiques

Style : direct, 1 chiffre concret, 1 question finale, 120-150 mots max.
Objet : < 50 caractères, curiosité ou bénéfice immédiat.
NE PAS mentionner KR Global dans l'objet.
Retourne UNIQUEMENT ce JSON (sans markdown) :
{{"subject": "...", "html": "<p>...</p>"}}`;

const FOLLOWUP1 = `Tu es SASUKE. Écris un email de relance J+4 (concis, 80 mots max, question différente).
Retourne UNIQUEMENT : {{"subject": "...", "html": "<p>...</p>"}}`;

const FOLLOWUP2 = `Tu es SASUKE. Écris une dernière relance J+10 (breakup email, 60 mots max, laisse la porte ouverte).
Retourne UNIQUEMENT : {{"subject": "...", "html": "<p>...</p>"}}`;

function makeChain(system: string) {
  return ChatPromptTemplate.fromMessages([
    ['system', system],
    ['human', '{input}'],
  ]).pipe(getLLM(false)).pipe(new StringOutputParser());
}

const chains = {
  initial:   makeChain(SYSTEM),
  followup1: makeChain(FOLLOWUP1),
  followup2: makeChain(FOLLOWUP2),
};

function extractJson(raw: string): SaasEmail {
  const s = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return JSON.parse(a !== -1 && b > a ? s.slice(a, b + 1) : s) as SaasEmail;
}

export async function writeOutreach(prospect: SaasProspect, type: OutreachType = 'initial'): Promise<SaasEmail> {
  const firstName = prospect.name.split(' ')[0];
  const context   = `
Prénom : ${firstName}
Poste : ${prospect.job_title ?? 'Fondateur'} chez ${prospect.company ?? 'une startup SaaS'}
Secteur : ${prospect.industry ?? 'SaaS'}
Taille : ${prospect.employee_count ? `${prospect.employee_count} employés` : 'startup'}
Pays : ${prospect.country ?? 'UK/France'}
Type d'email : ${type}`.trim();

  const raw   = await chains[type].invoke({ input: context });
  return extractJson(raw);
}
