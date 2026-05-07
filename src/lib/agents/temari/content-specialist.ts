import { createClient } from '@supabase/supabase-js';
import { temariChain }  from '@/lib/langchain/chains/temari-chain';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const IMMO_TOPICS = [
  "Comment automatiser les descriptions de biens immobiliers avec l'IA",
  "5 façons dont l'IA transforme la prospection immobilière en 2026",
  "Immobilier : comment ne plus perdre de leads grâce à l'automatisation",
  "Agences immobilières : publiez 5x plus de contenu sans effort supplémentaire",
  "L'IA analyse 1000 biens en 10 minutes — ce que ça change pour les promoteurs",
  "Comment nos clients immobiliers convertissent 40% de leads en plus",
  "Veille tarifaire IA : comment rester compétitif sur le marché immobilier",
];

export async function generateImmoContent(topic?: string, platform = 'linkedin'): Promise<string> {
  const t = topic ?? IMMO_TOPICS[new Date().getDay() % IMMO_TOPICS.length];

  const content = await temariChain.invoke({
    context: `Verticale: immobilier / real estate. Plateforme: ${platform}.`,
    input:   `Rédige un post ${platform} engageant sur ce sujet : ${t}`,
  });

  await supabase.from('content').insert({
    platform,
    content,
    status:     'draft',
    agent_name: 'TEMARI',
    title:      t,
  });

  return content;
}

export async function generateImmoContentBatch(count = 3): Promise<string[]> {
  const contents: string[] = [];
  for (let i = 0; i < count; i++) {
    const topic = IMMO_TOPICS[i % IMMO_TOPICS.length];
    const c = await generateImmoContent(topic);
    contents.push(c);
  }

  void fetch(process.env.SLACK_WEBHOOK_CONTENU!, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: `🏠 TEMARI — ${contents.length} contenus immobilier générés (validation requise)` }),
  });

  return contents;
}
