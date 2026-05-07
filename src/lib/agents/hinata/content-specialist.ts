import { createClient } from '@supabase/supabase-js';
import { hinataChain }  from '@/lib/langchain/chains/hinata-chain';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const EDTECH_TOPICS = [
  "Comment l'IA révolutionne la création de contenus pédagogiques en 2026",
  "Formation professionnelle : réduire le décrochage de 40% avec l'automatisation",
  "E-learning : générer des leads B2B qualifiés grâce à l'IA",
  "De 0 à 100 modules de formation optimisés avec l'IA en une semaine",
  "Comment nos clients EdTech automatisent leur pipeline de vente",
  "L'IA au service de l'expérience apprenant : personnalisation et engagement",
  "Formation en entreprise : comment vendre plus vite grâce à l'IA",
];

export async function generateEdtechContent(topic?: string, platform = 'linkedin'): Promise<string> {
  const t = topic ?? EDTECH_TOPICS[new Date().getDay() % EDTECH_TOPICS.length];

  const content = await hinataChain.invoke({
    context: `Verticale: EdTech / formation professionnelle. Plateforme: ${platform}.`,
    input:   `Rédige un post ${platform} engageant sur ce sujet : ${t}`,
  });

  await supabase.from('content').insert({
    platform,
    content,
    status:     'draft',
    agent_name: 'HINATA',
    title:      t,
  });

  return content;
}

export async function generateEdtechContentBatch(count = 3): Promise<string[]> {
  const contents: string[] = [];
  for (let i = 0; i < count; i++) {
    const topic = EDTECH_TOPICS[i % EDTECH_TOPICS.length];
    const c = await generateEdtechContent(topic);
    contents.push(c);
  }

  void fetch(process.env.SLACK_WEBHOOK_CONTENU!, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: `🎓 HINATA — ${contents.length} contenus EdTech générés (validation requise)` }),
  });

  return contents;
}
