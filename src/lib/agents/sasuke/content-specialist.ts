import { createClient }      from '@supabase/supabase-js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { getLLM }             from '@/lib/langchain/llm';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// SaaS content topics — rotated weekly
const SAAS_TOPICS = [
  'Comment réduire son CAC de 40% avec l\'IA (cas concret SaaS B2B)',
  '5 signaux de churn que votre équipe CS rate chaque mois',
  'Automatiser l\'onboarding utilisateur : avant/après avec des agents IA',
  'SaaS : pourquoi vos concurrents ont 10x plus de contenu que vous (et comment rattraper)',
  'Le coût réel du reporting manuel pour une startup SaaS (calcul honnête)',
  'Product-Led Growth + IA : le combo qui booste l\'activation utilisateurs',
  '3 workflows IA que toute SaaS devrait automatiser en 2026',
];

const SYSTEM = `Tu es SASUKE, expert en contenu SaaS B2B pour KR Global Solutions Ltd (agence IA, Londres UK).
Tu crées du contenu de thought leadership ciblant les fondateurs et dirigeants de startups SaaS.

Ton style :
- Data-driven : chiffres concrets, pas de généralités
- Empathie founder : tu comprends les nuits sans sommeil, les problèmes de croissance
- Actionnable : le lecteur peut appliquer quelque chose immédiatement
- Hook fort dès la 1ère ligne
- LinkedIn : 150-200 mots, emojis sparingly, CTA subtil en fin

Retourne UNIQUEMENT le texte du post (pas de JSON, pas d'instructions).`;

const contentChain = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(false)).pipe(new StringOutputParser());

export interface SaasContent {
  topic:     string;
  platform:  string;
  body:      string;
  saved_id?: string;
}

export async function generateSaasContent(topic?: string, platform = 'linkedin'): Promise<SaasContent> {
  const selectedTopic = topic ?? SAAS_TOPICS[new Date().getDay() % SAAS_TOPICS.length];

  const body = await contentChain.invoke({
    input: `Écris un post ${platform} sur ce sujet : "${selectedTopic}"\nCible : fondateurs et CMOs de startups SaaS B2B (UK/France, 5-200 employés)`,
  });

  // Save to content table
  const { data } = await supabase
    .from('content')
    .insert({
      title:      selectedTopic,
      body,
      type:       platform,
      status:     'draft',
      agent_name: 'SASUKE',
    })
    .select('id')
    .single();

  return { topic: selectedTopic, platform, body, saved_id: data?.['id'] as string | undefined };
}

export async function generateSaasContentBatch(count = 3): Promise<SaasContent[]> {
  const results: SaasContent[] = [];
  const topics = SAAS_TOPICS.slice(0, Math.min(count, SAAS_TOPICS.length));

  for (const topic of topics) {
    try {
      const content = await generateSaasContent(topic);
      results.push(content);
    } catch { /* skip */ }
  }

  if (results.length > 0) {
    void fetch(process.env.SLACK_WEBHOOK_CONTENU!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `📝 SASUKE — ${results.length} contenu(s) SaaS générés (statut: draft)\n${results.map(r => `• ${r.topic}`).join('\n')}` }),
    });
  }

  return results;
}
