/**
 * Indexation Qdrant — charge les données Supabase dans les collections vectorielles.
 *
 * Mappings :
 *   prospects          → kr_prospects
 *   content            → kr_content
 *   chat_history       → kr_clients  (proxy interactions clients)
 *   research_insights  → kr_knowledge (bonus — données ROBIN)
 *
 * Usage : doppler run --project kr-global-agents --config dev -- npx tsx scripts/index-qdrant.ts
 */

import { createClient }   from '@supabase/supabase-js';
import { rememberMany }   from '../src/lib/qdrant/memory';
import { ensureCollection,
         COLLECTIONS,
         collectionInfo } from '../src/lib/qdrant/collections';
import type { MemoryPoint } from '../src/lib/qdrant/memory';
import { activeProvider }  from '../src/lib/qdrant/embeddings';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 50;

async function indexInBatches(
  collection: string,
  points:     MemoryPoint[],
): Promise<void> {
  for (let i = 0; i < points.length; i += BATCH) {
    const slice = points.slice(i, i + BATCH);
    await rememberMany(collection as Parameters<typeof rememberMany>[0], slice);
    process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(points.length / BATCH)} indexé\n`);
  }
}

// ── 1. prospects → kr_prospects ───────────────────────────────────────────────

async function indexProspects(): Promise<number> {
  await ensureCollection(COLLECTIONS.prospects);

  const { data, error } = await supabase
    .from('prospects')
    .select('id, name, contact_name, company, email, status, need, summary, source, outreach_status')
    .limit(2000);

  if (error) throw new Error(`prospects: ${error.message}`);
  if (!data?.length) return 0;

  const points: MemoryPoint[] = data.map(p => ({
    id:   p.id as string,
    text: [
      p.company,
      p.contact_name ?? p.name,
      p.need,
      p.summary,
    ].filter(Boolean).join(' — '),
    payload: {
      company:         p.company,
      contact_name:    p.contact_name ?? p.name,
      email:           p.email,
      status:          p.status,
      need:            p.need,
      outreach_status: p.outreach_status,
      source:          p.source ?? 'unknown',
    },
  }));

  await indexInBatches(COLLECTIONS.prospects, points);
  return points.length;
}

// ── 2. content → kr_content ───────────────────────────────────────────────────

async function indexContent(): Promise<number> {
  await ensureCollection(COLLECTIONS.content);

  const { data, error } = await supabase
    .from('content')
    .select('id, marque, type, sujet, contenu, titre, meta_description, statut, langue, entite_nom')
    .limit(2000);

  if (error) throw new Error(`content: ${error.message}`);
  if (!data?.length) return 0;

  const points: MemoryPoint[] = data
    .filter(c => (c.titre || c.sujet) && c.contenu)
    .map(c => ({
      id:   c.id as string,
      text: [
        c.titre,
        c.sujet,
        c.contenu,
        c.meta_description,
      ].filter(Boolean).join('\n'),
      payload: {
        marque:     c.marque,
        type:       c.type,
        sujet:      c.sujet,
        titre:      c.titre,
        statut:     c.statut,
        langue:     c.langue,
        entite_nom: c.entite_nom,
        source:     'itachi',
      },
    }));

  await indexInBatches(COLLECTIONS.content, points);
  return points.length;
}

// ── 3. chat_history → kr_clients ──────────────────────────────────────────────

async function indexClients(): Promise<number> {
  await ensureCollection(COLLECTIONS.clients);

  const { data, error } = await supabase
    .from('chat_history')
    .select('id, role, agent_name, message, task_type, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) throw new Error(`chat_history: ${error.message}`);
  if (!data?.length) return 0;

  const points: MemoryPoint[] = data
    .filter(c => c.message && c.message.length > 20)
    .map(c => ({
      id:   c.id as string,
      text: `[${c.task_type ?? 'general'}] ${c.agent_name ?? ''} — ${c.role}: ${c.message}`,
      payload: {
        role:       c.role,
        agent_name: c.agent_name,
        task_type:  c.task_type,
        created_at: c.created_at,
        source:     'chat_history',
      },
    }));

  await indexInBatches(COLLECTIONS.clients, points);
  return points.length;
}

// ── 4. research_insights → kr_knowledge (bonus) ───────────────────────────────

async function indexResearchInsights(): Promise<number> {
  await ensureCollection(COLLECTIONS.knowledge);

  const { data, error } = await supabase
    .from('research_insights')
    .select('id, agent_name, source, topic, content, relevance_score, tags')
    .order('relevance_score', { ascending: false })
    .limit(2000);

  if (error) throw new Error(`research_insights: ${error.message}`);
  if (!data?.length) return 0;

  const points: MemoryPoint[] = data
    .filter(r => r.topic && r.content)
    .map(r => ({
      id:   r.id as string,
      text: `${r.topic}\n${r.content}`,
      payload: {
        agent_name:      r.agent_name,
        source:          r.source ?? 'robin',
        topic:           r.topic,
        relevance_score: r.relevance_score,
        tags:            r.tags ?? [],
      },
    }));

  await indexInBatches(COLLECTIONS.knowledge, points);
  return points.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧠 Indexation Qdrant — KR Global\n');
  console.log(`   Provider : ${activeProvider()}`);
  console.log(`   Supabase : ${process.env.SUPABASE_URL}\n`);

  const results: { collection: string; indexed: number; status: string }[] = [];

  const tasks = [
    { name: 'prospects → kr_prospects',        fn: indexProspects },
    { name: 'content → kr_content',            fn: indexContent },
    { name: 'chat_history → kr_clients',       fn: indexClients },
    { name: 'research_insights → kr_knowledge', fn: indexResearchInsights },
  ];

  for (const task of tasks) {
    console.log(`📥 ${task.name}`);
    try {
      const count = await task.fn();
      if (count === 0) {
        console.log('  ⚠️  Aucune donnée à indexer (table vide)\n');
        results.push({ collection: task.name, indexed: 0, status: 'vide' });
      } else {
        console.log(`  ✅ ${count} enregistrements indexés\n`);
        results.push({ collection: task.name, indexed: count, status: 'ok' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Erreur : ${msg}\n`);
      results.push({ collection: task.name, indexed: 0, status: `erreur: ${msg}` });
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RÉSUMÉ INDEXATION QDRANT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'vide' ? '⚠️ ' : '❌';
    console.log(`${icon}  ${r.collection.padEnd(42)} ${r.indexed} vecteurs`);
  }
  const total = results.reduce((s, r) => s + r.indexed, 0);
  console.log(`\n   Total indexé : ${total} vecteurs\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
