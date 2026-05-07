import { createClient }  from '@supabase/supabase-js';
import { narutoChain }   from '@/lib/langchain/chains/naruto-chain';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ECOM_TOPICS = [
  "Comment automatiser ses fiches produits avec l'IA en 2026",
  "5 façons d'utiliser l'IA pour récupérer les paniers abandonnés",
  "E-commerce : l'IA augmente le LTV client de 35%",
  "Personnalisation à grande échelle : le secret des e-commerces qui dominent",
  "De 0 à 10 000 fiches produits optimisées avec l'IA",
  "Comment nos clients e-commerce automatisent leur contenu social",
  "L'IA au service de votre stratégie de rétention e-commerce",
];

export async function generateEcomContent(topic?: string, platform = 'linkedin'): Promise<string> {
  const t = topic ?? ECOM_TOPICS[new Date().getDay() % ECOM_TOPICS.length];

  const content = await narutoChain.invoke({
    context: `Verticale: e-commerce / retail. Plateforme: ${platform}.`,
    input:   `Rédige un post ${platform} engageant sur ce sujet : ${t}`,
  });

  await supabase.from('content').insert({
    platform,
    content,
    status:     'draft',
    agent_name: 'NARUTO',
    title:      t,
  });

  return content;
}

export async function generateEcomContentBatch(count = 3): Promise<string[]> {
  const contents: string[] = [];
  for (let i = 0; i < count; i++) {
    const topic = ECOM_TOPICS[i % ECOM_TOPICS.length];
    const c = await generateEcomContent(topic);
    contents.push(c);
  }

  void fetch(process.env.SLACK_WEBHOOK_CONTENU!, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: `📦 NARUTO — ${contents.length} contenus e-commerce générés (validation requise)` }),
  });

  return contents;
}
