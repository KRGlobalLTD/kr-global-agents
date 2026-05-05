import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const COLLECTION = 'kr_knowledge';
const VECTOR_DIM  = 1024; // jina-embeddings-v3

function qdrantUrl(path: string): string {
  return `${process.env.QDRANT_URL}${path}`;
}

function qdrantHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.QDRANT_API_KEY) headers['api-key'] = process.env.QDRANT_API_KEY;
  return headers;
}

// ── Jina embeddings ──────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const key = process.env.JINA_API_KEY;
  if (!key) throw new Error('JINA_API_KEY manquant');

  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:  'jina-embeddings-v3',
      input:  [text.slice(0, 8192)],
      task:   'retrieval.passage',
    }),
  });

  if (!res.ok) throw new Error(`Jina embeddings ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

// ── Ensure collection exists ─────────────────────────────────────────────────

async function ensureCollection(): Promise<void> {
  const check = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    headers: qdrantHeaders(),
  });

  if (check.status === 404) {
    await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
      method:  'PUT',
      headers: qdrantHeaders(),
      body:    JSON.stringify({
        vectors: { size: VECTOR_DIM, distance: 'Cosine' },
      }),
    });
  }
}

// ── Add knowledge ────────────────────────────────────────────────────────────

export interface KnowledgePoint {
  id:      string;
  content: string;
  source:  string;
  topic:   string;
  tags:    string[];
}

export async function addKnowledge(
  content: string,
  source:  string,
  topic:   string  = 'general',
  tags:    string[] = [],
): Promise<string> {
  await ensureCollection();

  const vector = await embed(content);
  const id     = crypto.randomUUID();

  const res = await fetch(qdrantUrl(`/collections/${COLLECTION}/points`), {
    method:  'PUT',
    headers: qdrantHeaders(),
    body:    JSON.stringify({
      points: [{
        id,
        vector,
        payload: { content, source, topic, tags, created_at: new Date().toISOString() },
      }],
    }),
  });

  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);

  // Mirror dans Supabase pour recherche SQL
  await supabase.from('research_insights').insert({
    source,
    topic,
    content: content.slice(0, 2000),
    relevance_score: 0.5,
    tags,
  });

  return id;
}

// ── Search knowledge ─────────────────────────────────────────────────────────

export interface SearchResult {
  id:      string;
  score:   number;
  content: string;
  source:  string;
  topic:   string;
}

export async function searchKnowledge(query: string, limit = 5): Promise<SearchResult[]> {
  await ensureCollection();

  const vector = await embed(query);

  const res = await fetch(qdrantUrl(`/collections/${COLLECTION}/points/search`), {
    method:  'POST',
    headers: qdrantHeaders(),
    body:    JSON.stringify({
      vector,
      limit,
      with_payload: true,
    }),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
  };

  return (data.result ?? []).map(r => ({
    id:      String(r.id),
    score:   r.score,
    content: String(r.payload['content'] ?? ''),
    source:  String(r.payload['source']  ?? ''),
    topic:   String(r.payload['topic']   ?? ''),
  }));
}

// ── Batch index research results ─────────────────────────────────────────────

export async function indexResearchResults(
  results: Array<{ title: string; snippet: string; url: string; source: string }>,
  topic:   string,
): Promise<number> {
  let indexed = 0;

  for (const r of results) {
    const content = `${r.title}\n\n${r.snippet}`.trim();
    if (content.length < 30) continue;

    try {
      await addKnowledge(content, r.url || r.source, topic, [topic, r.source.split('/')[0]]);
      indexed++;
    } catch {
      // Continue even if one fails
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'INFO',
    message:    `Knowledge indexé : ${indexed}/${results.length} entrées → Qdrant ${COLLECTION}`,
  });

  return indexed;
}
