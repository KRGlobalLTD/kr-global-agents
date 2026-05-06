import { createClient } from '@supabase/supabase-js';
import { remember, recall, getMemory } from '@/lib/qdrant/memory';
import { ensureCollection, COLLECTIONS } from '@/lib/qdrant/collections';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type KnowledgeCategory = 'procedures' | 'templates' | 'decisions' | 'prompts' | 'guides';

export interface KnowledgeDocument {
  id:         string;
  title:      string;
  content:    string;
  category:   KnowledgeCategory;
  tags:       string[];
  qdrant_id:  string | null;
  version:    number;
  created_at: string;
  updated_at: string;
}

export interface SearchHit {
  id:       string;
  title:    string;
  category: string;
  score:    number;
  excerpt:  string;
  tags:     string[];
}

// ── Add a document to Supabase + Qdrant ──────────────────────────────────────

export async function addDocument(
  content:  string,
  category: KnowledgeCategory,
  title:    string,
  tags:     string[] = [],
): Promise<KnowledgeDocument> {
  await ensureCollection(COLLECTIONS.knowledge);

  const qdrantId = crypto.randomUUID();

  await remember(COLLECTIONS.knowledge, {
    id:   qdrantId,
    text: `${title}\n\n${content}`,
    payload: { title, category, tags, source: 'brook' },
  });

  const { data, error } = await supabase
    .from('knowledge_documents')
    .insert({
      title,
      content,
      category,
      tags,
      qdrant_id:  qdrantId,
      agent_name: 'BROOK',
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert knowledge_documents: ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'BROOK',
    level:      'INFO',
    message:    `Document ajouté : [${category}] "${title}" → Qdrant ${qdrantId}`,
  });

  return data as KnowledgeDocument;
}

// ── Semantic search ───────────────────────────────────────────────────────────

export async function searchKnowledge(
  query:    string,
  limit     = 5,
  category?: KnowledgeCategory,
): Promise<SearchHit[]> {
  await ensureCollection(COLLECTIONS.knowledge);

  const filter = category
    ? { must: [{ key: 'category', match: { value: category } }] }
    : undefined;

  const results = await recall(COLLECTIONS.knowledge, query, { limit, filter, minScore: 0.3 });

  return results.map(r => ({
    id:       r.id,
    title:    String(r.payload['title']    ?? 'Sans titre'),
    category: String(r.payload['category'] ?? 'guides'),
    score:    Math.round(r.score * 100) / 100,
    excerpt:  r.text.slice(0, 300),
    tags:     (r.payload['tags'] as string[]) ?? [],
  }));
}

// ── Get a document by id (Supabase) ──────────────────────────────────────────

export async function getDocument(id: string): Promise<KnowledgeDocument | null> {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data as KnowledgeDocument;
}

// ── List documents by category ────────────────────────────────────────────────

export async function listDocuments(
  category?: KnowledgeCategory,
  limit     = 20,
): Promise<Pick<KnowledgeDocument, 'id' | 'title' | 'category' | 'tags' | 'version' | 'updated_at'>[]> {
  let query = supabase
    .from('knowledge_documents')
    .select('id, title, category, tags, version, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) throw new Error(`Supabase list knowledge_documents: ${error.message}`);
  return data ?? [];
}

// ── Answer a question using RAG ───────────────────────────────────────────────

export async function ragContext(query: string, limit = 4): Promise<string> {
  const hits = await searchKnowledge(query, limit);
  if (!hits.length) return '';

  return hits
    .map((h, i) => `[${i + 1}] **${h.title}** (${h.category}, score ${h.score})\n${h.excerpt}`)
    .join('\n\n---\n\n');
}

// ── Qdrant health check ───────────────────────────────────────────────────────

export async function pingKdrant(): Promise<{ ok: boolean; version?: string }> {
  try {
    const { ping } = await import('@/lib/qdrant/client');
    const version  = await ping();
    return { ok: true, version };
  } catch {
    return { ok: false };
  }
}
