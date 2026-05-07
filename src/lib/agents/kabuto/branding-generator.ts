import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }               from '@/lib/langchain/llm';
import type { WhitelabelConfig } from './whitelabel-configurator';

const welcomePrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu génères des emails de bienvenue entièrement brandés pour des clients d'agences IA.
Le client final NE SAIT PAS que KR Global opère en coulisses — il croit recevoir un email de l'agence partenaire.
L'email doit :
- Être chaleureux et professionnel
- Mentionner la marque de l'agence partenaire, pas KR Global
- Expliquer les prochaines étapes de l'onboarding (accès plateforme, call de démarrage, support)
- Donner un contact email de support (celui fourni par le partenaire ou un générique)
- Maximum 200 mots
- Couleur principale de la marque : {primaryColor}

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<p>...</p>"}}`],
  ['human', 'Marque partenaire: {brandName}\nClient: {clientName}\nPlan: {plan}\nEmail support: {supportEmail}'],
]);

const reportPrompt = ChatPromptTemplate.fromMessages([
  ['system', `Tu génères des rapports mensuels de performance entièrement brandés pour des clients d'une agence IA.
Le rapport est envoyé par l'agence partenaire à son client final — KR Global n'est pas mentionné.
Le rapport doit :
- Être structuré et professionnel (HTML lisible)
- Résumer les performances du mois (agents actifs, tâches complétées, métriques clés)
- Inclure des recommandations pour le mois suivant
- Terminer par un CTA pour renouveler ou upgrader

Retourne UNIQUEMENT du JSON valide :
{{"subject": "...", "html": "<div>...</div>"}}`],
  ['human', 'Marque partenaire: {brandName}\nClient: {clientName}\nPlan: {plan}\nMois: {month}\nMétriques: {metrics}'],
]);

const parser = new StringOutputParser();
const welcomeChain = welcomePrompt.pipe(getLLM(false)).pipe(parser);
const reportChain  = reportPrompt.pipe(getLLM(false)).pipe(parser);

export async function generateWelcomeEmail(
  config: WhitelabelConfig,
  clientName: string,
  plan: string,
): Promise<{ subject: string; html: string }> {
  const raw = await welcomeChain.invoke({
    brandName:    config.brand_name,
    primaryColor: config.primary_color,
    clientName,
    plan,
    supportEmail: config.email_from ?? `support@${config.brand_name.toLowerCase().replace(/\s+/g, '')}.com`,
  });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON introuvable dans la réponse LLM');
  return JSON.parse(match[0]) as { subject: string; html: string };
}

export async function generateMonthlyReport(
  config: WhitelabelConfig,
  clientName: string,
  plan: string,
  month: string,
  metrics: Record<string, unknown>,
): Promise<{ subject: string; html: string }> {
  const raw = await reportChain.invoke({
    brandName: config.brand_name,
    clientName,
    plan,
    month,
    metrics:   JSON.stringify(metrics),
  });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON introuvable dans la réponse LLM');
  return JSON.parse(match[0]) as { subject: string; html: string };
}
